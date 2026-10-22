import { NextResponse } from "next/server";
import { research, writeStory } from "@/lib/server/engines";
import { validateInput } from "@/lib/validation";
import type { GenerateResponse } from "@/lib/types";
import { authorize, enforceRateLimit } from "@/lib/server/security";
import { selectEditorialWinner } from "@/lib/scoring";

export const maxDuration = 300;

export async function POST(request: Request) {
  const authLimit = enforceRateLimit(request, 10, 10 * 60_000, "auth");
  if (!authLimit.allowed) return NextResponse.json({ error: "Too many access attempts. Please wait and try again." }, { status: 429, headers: { "Retry-After": String(authLimit.retryAfter) } });
  if (!authorize(request)) return NextResponse.json({ error: "Invalid studio access code." }, { status: 401 });
  const limit = enforceRateLimit(request, 3, 10 * 60_000, "generate");
  if (!limit.allowed) return NextResponse.json({ error: "Generation limit reached. Please wait before starting another run." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  try {
    const input = validateInput(await request.json());
    const researchPack = await research(input);
    const results = await Promise.all(input.providers.map(provider => writeStory(provider, input, researchPack.summary, researchPack.sources)));
    const response: GenerateResponse = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      subject: input.subject,
      researchSummary: researchPack.summary,
      sources: researchPack.sources,
      researchEngine: researchPack.engine,
      results,
      editorial: selectEditorialWinner(results),
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: /subject|select|body/i.test(message) ? 400 : 500 });
  }
}
