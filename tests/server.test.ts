import assert from "node:assert/strict";
import test from "node:test";
import { research, writeStory } from "../lib/server/engines";
import { authorize, enforceRateLimit } from "../lib/server/security";
import { validateInput } from "../lib/validation";

const input = validateInput({ subject: "A verified historical mystery", providers: ["openai"], genres: ["Mystery"], researchDepth: "quick", researchEngines: ["tavily", "openai"] });

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
    assert.equal(result.engine, "OpenAI Web");
    assert.equal(result.sources[0]?.url, "https://example.org/archive");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousTavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previousTavily;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
  }
});

test("all search adapters merge, deduplicate, and Crawl4AI enriches top evidence", async () => {
  const previousFetch = globalThis.fetch;
  const envNames = ["TAVILY_API_KEY", "FIRECRAWL_API_KEY", "EXA_API_KEY", "PERPLEXITY_API_KEY", "OPENAI_API_KEY", "CRAWL4AI_BASE_URL"] as const;
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  for (const name of envNames) process.env[name] = name === "CRAWL4AI_BASE_URL" ? "https://crawler.test" : "test";
  globalThis.fetch = async inputValue => {
    const url = String(inputValue);
    if (url.includes("tavily")) return Response.json({ answer: "Cross-engine evidence brief.", results: [{ title: "Archive", url: "https://source.test/archive", content: "Tavily evidence" }] });
    if (url.includes("firecrawl")) return Response.json({ data: { web: [{ title: "Museum", url: "https://source.test/museum", markdown: "Firecrawl evidence" }] } });
    if (url.includes("exa.ai")) return Response.json({ results: [{ title: "Paper", url: "https://source.test/paper", highlights: ["Exa evidence"] }] });
    if (url.includes("perplexity")) return Response.json({ results: [{ title: "News", url: "https://source.test/news", snippet: "Perplexity evidence" }] });
    if (url.includes("github.com/search")) return Response.json({ items: [{ full_name: "org/archive", html_url: "https://github.com/org/archive", description: "Dataset", stargazers_count: 10 }] });
    if (url.includes("openai.com")) return Response.json({ output_text: "OpenAI evidence", output: [{ content: [{ text: "OpenAI evidence", annotations: [{ title: "Library", url: "https://source.test/library" }] }] }] });
    if (url.includes("crawler.test")) return Response.json({ results: [{ url: "https://source.test/archive", markdown: "Crawl4AI cleaned archive content" }] });
    return new Response("unexpected", { status: 500 });
  };
  try {
    const allInput = validateInput({ subject: "A verified historical mystery", providers: ["openai"], genres: ["Mystery"], researchDepth: "deep", researchEngines: ["tavily", "firecrawl", "exa", "perplexity", "github", "openai", "crawl4ai"] });
    const result = await research(allInput);
    assert.equal(result.sources.length, 6);
    assert.match(result.engine, /Tavily.*Firecrawl.*Exa.*Perplexity.*GitHub.*OpenAI Web.*Crawl4AI/);
    assert.match(result.sources[0].snippet, /Crawl4AI cleaned/);
    assert.match(result.sources[0].engine || "", /Crawl4AI/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
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
