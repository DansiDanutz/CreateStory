import { NextResponse } from "next/server";
import type { Capabilities } from "@/lib/types";
import { authorize, enforceRateLimit } from "@/lib/server/security";

export async function GET(request: Request) {
  const authLimit = enforceRateLimit(request, 10, 10 * 60_000, "auth");
  if (!authLimit.allowed) return NextResponse.json({ error: "Too many access attempts. Please wait and try again." }, { status: 429, headers: { "Retry-After": String(authLimit.retryAfter) } });
  if (!authorize(request)) return NextResponse.json({ error: "Invalid studio access code." }, { status: 401 });
  const capabilities: Capabilities = {
    providers: {
      openai: { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-5" },
      anthropic: { configured: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6" },
      kimi: { configured: Boolean(process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || process.env.KIMI_MOONSHOT_API_KEY), model: process.env.KIMI_MODEL || "kimi-k2.5" },
    },
    research: {
      "Tavily Search": Boolean(process.env.TAVILY_API_KEY),
      "OpenAI Web Search": Boolean(process.env.OPENAI_API_KEY),
      "Exa Semantic Search": Boolean(process.env.EXA_API_KEY),
      Firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
      Perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
    },
    installedTools: ["Codex CLI", "Claude Code", "Kimi CLI", "Agent Reach", "GitHub CLI", "yt-dlp / YouTube", "Jina Reader", "Playwright"],
    installedPlugins: ["GitHub", "Vercel", "OpenAI Developers", "Data Analytics", "Figma", "Google Drive", "Gmail", "Slack", "Supabase", "Neon Postgres"],
    recommendedSkills: [
      { name: "agent-reach", purpose: "Cross-platform web, GitHub, and YouTube research", status: "installed" },
      { name: "ask-claude", purpose: "Independent Claude critique and drafting", status: "installed" },
      { name: "kimi-webbridge", purpose: "Kimi research and drafting lane", status: "installed" },
      { name: "last30days", purpose: "Fresh topic and trend research", status: "installed" },
      { name: "OpenMontage", purpose: "Optional open-source video-production pipeline", status: "optional" },
      { name: "SearXNG", purpose: "Optional self-hosted metasearch fallback", status: "optional" },
    ],
  };
  return NextResponse.json(capabilities);
}
