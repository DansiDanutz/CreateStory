import { buildResearchQuery, buildWriterPrompt } from "../prompt";
import { finalizeScript } from "../scoring";
import type { GenerateInput, Provider, ScriptResult, Source } from "../types";

const timeoutMs = 110_000;

async function apiFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    console.error("Upstream provider request failed", { host: new URL(url).host, status: response.status, detail: body.slice(0, 240) });
    throw new Error(response.status === 429 ? "This provider has reached its current usage limit." : "This provider is temporarily unavailable.");
  }
  return response;
}

function parseJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON script.");
  return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(provider: Provider, model: string, text: string): ScriptResult {
  const data = parseJson(text);
  if (typeof data.narration !== "string" || typeof data.title !== "string") throw new Error("The model returned an incomplete script.");
  return finalizeScript({
    provider,
    model,
    title: data.title,
    titleIdeas: asStrings(data.titleIdeas),
    hook: typeof data.hook === "string" ? data.hook : data.narration.split(/[.!?]/)[0],
    narration: data.narration,
    visualBeats: asStrings(data.visualBeats),
    soundDesign: asStrings(data.soundDesign),
    cta: typeof data.cta === "string" ? data.cta : "",
    whyItWorks: typeof data.whyItWorks === "string" ? data.whyItWorks : "",
    scores: data.scores && typeof data.scores === "object" ? data.scores as Partial<ScriptResult["scores"]> : undefined,
  });
}

export async function research(input: GenerateInput): Promise<{ summary: string; sources: Source[]; engine: string }> {
  const researchWasConfigured = Boolean(process.env.TAVILY_API_KEY || process.env.OPENAI_API_KEY);
  if (process.env.TAVILY_API_KEY) {
    try {
      const maxResults = input.researchDepth === "deep" ? 10 : input.researchDepth === "quick" ? 4 : 7;
      const response = await apiFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: buildResearchQuery(input), search_depth: input.researchDepth === "quick" ? "basic" : "advanced", max_results: maxResults, include_answer: true }),
      });
      const data = await response.json() as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
      const sources = (data.results || []).filter(item => item.url && /^https?:\/\//i.test(item.url)).map(item => ({ title: item.title || item.url!, url: item.url!, snippet: (item.content || "").slice(0, 900) }));
      if (sources.length) return { summary: data.answer || "Use the collected source notes to identify the strongest verifiable narrative.", sources, engine: "Tavily Advanced Search" };
    } catch { /* continue to the next configured research engine */ }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await apiFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5", tools: [{ type: "web_search" }], input: `Research ${buildResearchQuery(input)}. Return a concise evidence brief and include source URLs.`, max_output_tokens: 1800 }),
      });
      const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string; annotations?: Array<{ title?: string; url?: string }> }> }> };
      const blocks = data.output?.flatMap(item => item.content || []) || [];
      const sourceMap = new Map<string, Source>();
      for (const block of blocks) for (const note of block.annotations || []) if (note.url && /^https?:\/\//i.test(note.url)) sourceMap.set(note.url, { title: note.title || note.url, url: note.url, snippet: "Referenced by OpenAI web research." });
      return { summary: data.output_text || blocks.map(block => block.text || "").join("\n"), sources: [...sourceMap.values()], engine: "OpenAI Web Search" };
    } catch { /* fall through to a safe knowledge-only brief */ }
  }

  return {
    summary: researchWasConfigured
      ? "The configured web research services were temporarily unavailable. Writers must avoid unsupported precise claims and clearly qualify uncertainty."
      : "No web research credential is configured. Writers must avoid unsupported precise claims and clearly qualify uncertainty.",
    sources: [],
    engine: researchWasConfigured ? "Research unavailable — knowledge-only mode" : "Knowledge-only fallback",
  };
}

async function writeOpenAI(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const response = await apiFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: buildWriterPrompt(input, summary, sources, "GPT"), max_output_tokens: 5000 }),
  });
  const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = data.output_text || data.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  return normalize("openai", model, text);
}

async function writeAnthropic(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const response = await apiFetch(`${anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 5000, messages: [{ role: "user", content: buildWriterPrompt(input, summary, sources, "Claude") }] }),
  });
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return normalize("anthropic", model, (data.content || []).filter(item => item.type === "text").map(item => item.text || "").join(""));
}

async function writeKimi(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  const key = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || process.env.KIMI_MOONSHOT_API_KEY;
  if (!key) throw new Error("MOONSHOT_API_KEY is not configured.");
  const model = process.env.KIMI_MODEL || "kimi-k2.5";
  const response = await apiFetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 1, max_tokens: 5000, messages: [{ role: "system", content: "You are an independent, meticulous, original factual storyteller." }, { role: "user", content: buildWriterPrompt(input, summary, sources, "Kimi") }] }),
  });
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return normalize("kimi", model, data.choices?.[0]?.message?.content || "");
}

const writers = { openai: writeOpenAI, anthropic: writeAnthropic, kimi: writeKimi };

export async function writeStory(provider: Provider, input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  try {
    return await writers[provider](input, summary, sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider error";
    return finalizeScript({ provider, model: "unavailable", title: `${provider} could not complete this run`, titleIdeas: [], hook: "", narration: "", visualBeats: [], soundDesign: [], cta: "", whyItWorks: "", scores: { hook: 1, retention: 1, clarity: 1, originality: 1, factuality: 1 }, error: message });
  }
}

export const testables = { parseJson, normalize };
