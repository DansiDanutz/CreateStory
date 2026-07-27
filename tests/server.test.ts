import assert from "node:assert/strict";
import test from "node:test";
import { research, writeStory } from "../lib/server/engines";
import { authorize, enforceRateLimit } from "../lib/server/security";
import { validateInput } from "../lib/validation";

const input = validateInput({ subject: "A verified historical mystery", providers: ["openai"], genres: ["Mystery"], researchDepth: "quick" });

test("research falls back from a failed Tavily request to OpenAI web search", async () => {
  const previousFetch = globalThis.fetch;
  const previousTavily = process.env.TAVILY_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.TAVILY_API_KEY = "test";
  process.env.OPENAI_API_KEY = "test";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return Response.json({ output_text: "Verified fallback brief.", output: [{ content: [{ text: "Verified fallback brief.", annotations: [{ title: "Archive", url: "https://example.org/archive" }] }] }] });
  };
  try {
    const result = await research(input);
    assert.equal(result.engine, "OpenAI Web Search");
    assert.equal(result.sources[0]?.url, "https://example.org/archive");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousTavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previousTavily;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
  }
});

test("writer failures are isolated into a safe result", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await writeStory("openai", input, "Brief", []);
    assert.equal(result.provider, "openai");
    assert.match(result.error || "", /not configured/);
    assert.equal(result.scores.overall, 1);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("access code comparison and request rate limit protect paid routes", () => {
  const previous = process.env.STORYLAB_ACCESS_CODE;
  process.env.STORYLAB_ACCESS_CODE = "test-code";
  try {
    assert.equal(authorize(new Request("https://studio.test", { headers: { "x-storylab-access-code": "test-code" } })), true);
    assert.equal(authorize(new Request("https://studio.test", { headers: { "x-storylab-access-code": "wrong" } })), false);
    const request = new Request("https://studio.test", { headers: { "x-forwarded-for": "203.0.113.41" } });
    assert.equal(enforceRateLimit(request, 1, 60_000, "test").allowed, true);
    assert.equal(enforceRateLimit(request, 1, 60_000, "test").allowed, false);
  } finally {
    if (previous === undefined) delete process.env.STORYLAB_ACCESS_CODE; else process.env.STORYLAB_ACCESS_CODE = previous;
  }
});
