import { buildResearchQuery, buildWriterPrompt } from "../prompt";
import { finalizeScript } from "../scoring";
import type { GenerateInput, Provider, ResearchEngine, ScriptResult, Source } from "../types";

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

function normalize(provider: Provider, model: string, text: string, sources: Source[]): ScriptResult {
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
  }, sources);
}

type ResearchBatch = { engine: string; sources: Source[]; summary?: string };

const resultCount = (input: GenerateInput) => input.researchDepth === "deep" ? 7 : input.researchDepth === "quick" ? 3 : 5;
const isHttpUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\//i.test(value);
const source = (engine: string, title: unknown, url: unknown, snippet: unknown): Source | null => isHttpUrl(url) ? {
  title: typeof title === "string" && title.trim() ? title.trim() : url,
  url,
  snippet: typeof snippet === "string" ? snippet.replace(/\s+/g, " ").trim().slice(0, 1_200) : "",
  engine,
} : null;

async function searchTavily(input: GenerateInput): Promise<ResearchBatch> {
  if (!process.env.TAVILY_API_KEY) throw new Error("not configured");
  const response = await apiFetch("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: buildResearchQuery(input), search_depth: input.researchDepth === "quick" ? "basic" : "advanced", max_results: resultCount(input), include_answer: true }),
  });
  const data = await response.json() as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
  return { engine: "Tavily", summary: data.answer, sources: (data.results || []).map(item => source("Tavily", item.title, item.url, item.content)).filter((item): item is Source => Boolean(item)) };
}

async function searchFirecrawl(input: GenerateInput): Promise<ResearchBatch> {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("not configured");
  const response = await apiFetch("https://api.firecrawl.dev/v2/search", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildResearchQuery(input), limit: resultCount(input), sources: ["web"], scrapeOptions: { formats: [{ type: "markdown" }] } }),
  });
  const data = await response.json() as { data?: { web?: Array<{ title?: string; url?: string; description?: string; markdown?: string }> } };
  return { engine: "Firecrawl", sources: (data.data?.web || []).map(item => source("Firecrawl", item.title, item.url, item.markdown || item.description)).filter((item): item is Source => Boolean(item)) };
}

async function searchExa(input: GenerateInput): Promise<ResearchBatch> {
  if (!process.env.EXA_API_KEY) throw new Error("not configured");
  const response = await apiFetch("https://api.exa.ai/search", {
    method: "POST", headers: { "x-api-key": process.env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildResearchQuery(input), numResults: resultCount(input), type: input.researchDepth === "deep" ? "deep-lite" : input.researchDepth === "quick" ? "fast" : "auto", moderation: true, contents: { highlights: true } }),
  });
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; text?: string; summary?: string; highlights?: string[] }> };
  return { engine: "Exa", sources: (data.results || []).map(item => source("Exa", item.title, item.url, item.summary || item.highlights?.join(" ") || item.text)).filter((item): item is Source => Boolean(item)) };
}

async function searchPerplexity(input: GenerateInput): Promise<ResearchBatch> {
  if (!process.env.PERPLEXITY_API_KEY) throw new Error("not configured");
  const response = await apiFetch("https://api.perplexity.ai/search", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildResearchQuery(input), max_results: resultCount(input), max_tokens_per_page: 900 }),
  });
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
  return { engine: "Perplexity", sources: (data.results || []).map(item => source("Perplexity", item.title, item.url, item.snippet)).filter((item): item is Source => Boolean(item)) };
}

async function searchGitHub(input: GenerateInput): Promise<ResearchBatch> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const query = encodeURIComponent(`${input.subject} archive OR dataset OR research in:name,description,readme`);
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${resultCount(input)}`;
  let response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (response.status === 401 && headers.Authorization) {
    delete headers.Authorization;
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  }
  if (!response.ok) throw new Error("GitHub search is temporarily unavailable.");
  const data = await response.json() as { items?: Array<{ full_name?: string; html_url?: string; description?: string; stargazers_count?: number; language?: string }> };
  return { engine: "GitHub", sources: (data.items || []).map(item => source("GitHub", item.full_name, item.html_url, `${item.description || "Open-source repository"}. ${item.stargazers_count || 0} stars${item.language ? ` · ${item.language}` : ""}. Treat as a community or technical source, not primary historical evidence.`)).filter((item): item is Source => Boolean(item)) };
}

async function searchOpenAI(input: GenerateInput): Promise<ResearchBatch> {
  if (!process.env.OPENAI_API_KEY) throw new Error("not configured");
  const response = await apiFetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5", tools: [{ type: "web_search" }], input: `Research ${buildResearchQuery(input)}. Return a concise evidence brief and include source URLs.`, max_output_tokens: 1800 }),
  });
  const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string; annotations?: Array<{ title?: string; url?: string }> }> }> };
  const blocks = data.output?.flatMap(item => item.content || []) || [];
  const sources = blocks.flatMap(block => (block.annotations || []).map(note => source("OpenAI Web", note.title, note.url, "Referenced by OpenAI web research."))).filter((item): item is Source => Boolean(item));
  return { engine: "OpenAI Web", summary: data.output_text || blocks.map(block => block.text || "").join("\n"), sources };
}

async function enrichWithCrawl4AI(sources: Source[]): Promise<Source[]> {
  if (!process.env.CRAWL4AI_BASE_URL || !sources.length) return sources;
  const baseUrl = process.env.CRAWL4AI_BASE_URL.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return sources;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CRAWL4AI_API_TOKEN) headers.Authorization = `Bearer ${process.env.CRAWL4AI_API_TOKEN}`;
  const targets = sources.slice(0, 4);
  try {
    const response = await apiFetch(`${baseUrl}/crawl`, {
      method: "POST", headers,
      body: JSON.stringify({ urls: targets.map(item => item.url), browser_config: { type: "BrowserConfig", params: { headless: true } }, crawler_config: { type: "CrawlerRunConfig", params: { word_count_threshold: 20, exclude_external_links: true } } }),
    });
    const data = await response.json() as { results?: Array<{ url?: string; markdown?: string | { raw_markdown?: string }; title?: string }>; data?: Array<{ url?: string; markdown?: string | { raw_markdown?: string }; title?: string }> } | Array<{ url?: string; markdown?: string | { raw_markdown?: string }; title?: string }>;
    const crawled = Array.isArray(data) ? data : data.results || data.data || [];
    const contentByUrl = new Map(crawled.filter(item => isHttpUrl(item.url)).map(item => [item.url!, typeof item.markdown === "string" ? item.markdown : item.markdown?.raw_markdown || ""]));
    return sources.map(item => contentByUrl.get(item.url) ? { ...item, snippet: contentByUrl.get(item.url)!.replace(/\s+/g, " ").slice(0, 1_200), engine: `${item.engine} + Crawl4AI` } : item);
  } catch { return sources; }
}

const searchers: Record<Exclude<ResearchEngine, "crawl4ai">, (input: GenerateInput) => Promise<ResearchBatch>> = {
  tavily: searchTavily, firecrawl: searchFirecrawl, exa: searchExa, perplexity: searchPerplexity, github: searchGitHub, openai: searchOpenAI,
};

export async function research(input: GenerateInput): Promise<{ summary: string; sources: Source[]; engine: string }> {
  const selectedSearchers = input.researchEngines.filter((engine): engine is Exclude<ResearchEngine, "crawl4ai"> => engine !== "crawl4ai");
  const settled = await Promise.allSettled(selectedSearchers.map(engine => searchers[engine](input)));
  const batches = settled.flatMap(result => result.status === "fulfilled" && result.value.sources.length ? [result.value] : []);
  const maxSources = input.researchDepth === "deep" ? 20 : input.researchDepth === "quick" ? 8 : 14;
  const seen = new Set<string>();
  let sources: Source[] = [];
  for (let index = 0; sources.length < maxSources; index += 1) {
    let added = false;
    for (const batch of batches) {
      const item = batch.sources[index];
      if (!item) continue;
      const key = item.url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); sources.push(item); added = true;
      if (sources.length === maxSources) break;
    }
    if (!added) break;
  }
  if (input.researchEngines.includes("crawl4ai")) sources = await enrichWithCrawl4AI(sources);
  const engines = [...new Set(sources.map(item => item.engine?.replace(" + Crawl4AI", "")).filter(Boolean))];
  const synthesis = batches.map(batch => batch.summary).find((value): value is string => Boolean(value?.trim()));
  return sources.length ? {
    summary: synthesis || `${engines.join(", ")} collected ${sources.length} deduplicated sources. Compare claims across sources, prefer primary or institutional evidence, and treat GitHub repositories as supporting technical/community material only.`,
    sources,
    engine: `${engines.join(" + ")}${sources.some(item => item.engine?.includes("Crawl4AI")) ? " + Crawl4AI" : ""}`,
  } : {
    summary: "The selected research services were unavailable or not configured. Writers must avoid unsupported precise claims and clearly qualify uncertainty.",
    sources: [],
    engine: "Research unavailable — knowledge-only mode",
  };
}

function writerTokenLimit(input: GenerateInput): number {
  if (input.duration === "fifteen") return 12_000;
  if (input.duration === "ten") return 9_000;
  if (input.duration === "five") return 7_000;
  return 5_000;
}

async function writeOpenAI(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const response = await apiFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: buildWriterPrompt(input, summary, sources, "GPT"), max_output_tokens: writerTokenLimit(input) }),
  });
  const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = data.output_text || data.output?.flatMap(item => item.content || []).map(item => item.text || "").join("") || "";
  return normalize("openai", model, text, sources);
}

async function writeAnthropic(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const response = await apiFetch(`${anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: writerTokenLimit(input), messages: [{ role: "user", content: buildWriterPrompt(input, summary, sources, "Claude") }] }),
  });
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return normalize("anthropic", model, (data.content || []).filter(item => item.type === "text").map(item => item.text || "").join(""), sources);
}

async function writeKimi(input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  const key = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || process.env.KIMI_MOONSHOT_API_KEY;
  if (!key) throw new Error("MOONSHOT_API_KEY is not configured.");
  const model = process.env.KIMI_MODEL || "kimi-k2.5";
  const response = await apiFetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 1, max_tokens: writerTokenLimit(input), messages: [{ role: "system", content: "You are an independent, meticulous, original factual storyteller." }, { role: "user", content: buildWriterPrompt(input, summary, sources, "Kimi") }] }),
  });
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return normalize("kimi", model, data.choices?.[0]?.message?.content || "", sources);
}

const writers = { openai: writeOpenAI, anthropic: writeAnthropic, kimi: writeKimi };

export async function writeStory(provider: Provider, input: GenerateInput, summary: string, sources: Source[]): Promise<ScriptResult> {
  try {
    return await writers[provider](input, summary, sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider error";
    return finalizeScript({ provider, model: "unavailable", title: `${provider} could not complete this run`, titleIdeas: [], hook: "", narration: "", visualBeats: [], soundDesign: [], cta: "", whyItWorks: "", scores: { hook: 1, retention: 1, clarity: 1, originality: 1, factuality: 1 }, error: message }, sources);
  }
}

export const testables = { parseJson, normalize };
