import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchQuery, buildWriterPrompt } from "../lib/prompt";
import { finalizeScript, selectEditorialWinner } from "../lib/scoring";
import { validateInput } from "../lib/validation";

const input = validateInput({
  subject: "The dancing plague of 1518",
  providers: ["openai", "anthropic", "kimi", "unknown"],
  genres: ["Mystery", "History", "Mystery"],
  tone: "Documentary",
  duration: "short",
  audience: "Curious adults",
  language: "English",
  hookStyle: "Cold open",
  pacing: "fast",
  factuality: "strict",
  researchDepth: "deep",
});

test("validation normalizes and de-duplicates bounded selections", () => {
  assert.deepEqual(input.providers, ["openai", "anthropic", "kimi"]);
  assert.deepEqual(input.genres, ["Mystery", "History"]);
  assert.equal(input.includeVisuals, true);
});

test("validation rejects missing creative choices", () => {
  assert.throws(() => validateInput({ subject: "A valid topic", providers: [], genres: ["Mystery"] }), /story engine/);
  assert.throws(() => validateInput({ subject: "A valid topic", providers: ["openai"], genres: [] }), /genre/);
});

test("writer prompt carries evidence, format, and factual constraints", () => {
  const prompt = buildWriterPrompt(input, "A documented event.", [{ title: "Archive", url: "https://example.org/archive", snippet: "Primary record." }], "GPT");
  assert.match(prompt, /130–170 words/);
  assert.match(prompt, /Never invent a fact/);
  assert.match(prompt, /inline source markers/);
  assert.match(prompt, /https:\/\/example.org\/archive/);
  assert.match(prompt, /Return ONLY valid JSON/);
});

test("citation coverage and editorial winner are derived consistently", () => {
  const sources = [
    { title: "Archive", url: "https://example.org/1", snippet: "Evidence" },
    { title: "Museum", url: "https://example.org/2", snippet: "Evidence" },
    { title: "Paper", url: "https://example.org/3", snippet: "Evidence" },
  ];
  const grounded = finalizeScript({ provider: "kimi", model: "test", title: "Grounded", titleIdeas: [], hook: "Hook", narration: "This first factual claim has evidence [1]. This second factual claim has evidence [2]. This third factual claim has evidence [3].", visualBeats: [], soundDesign: [], cta: "", whyItWorks: "", scores: { hook: 90, retention: 90, clarity: 90, originality: 90, factuality: 90 } }, sources);
  const uncited = finalizeScript({ provider: "openai", model: "test", title: "Uncited", titleIdeas: [], hook: "Hook", narration: "An uncited claim.", visualBeats: [], soundDesign: [], cta: "", whyItWorks: "", scores: { hook: 95, retention: 95, clarity: 95, originality: 95, factuality: 95 } }, sources);
  assert.equal(grounded.factCheck?.status, "grounded");
  assert.equal(grounded.factCheck?.coverage, 100);
  assert.equal(selectEditorialWinner([uncited, grounded]).winner, "kimi");
});

test("long-form durations request a complete 15-minute production script", () => {
  const longInput = validateInput({ ...input, duration: "fifteen" });
  const prompt = buildWriterPrompt(longInput, "A documented event.", [], "Kimi");
  assert.match(prompt, /2,100–2,400 words/);
  assert.match(prompt, /45–60 concise scene directions/);
});

test("research query requests verification and story details", () => {
  const query = buildResearchQuery(input);
  assert.match(query, /verified surprising facts/);
  assert.match(query, /misconceptions/);
});

test("final scoring clamps model ratings and derives run metadata", () => {
  const result = finalizeScript({ provider: "openai", model: "test", title: "Title", titleIdeas: [], hook: "Hook", narration: "one two three four five", visualBeats: [], soundDesign: [], cta: "", whyItWorks: "", scores: { hook: 200, retention: 80, clarity: 0, originality: 70, factuality: 90 } });
  assert.equal(result.wordCount, 5);
  assert.equal(result.scores.hook, 100);
  assert.equal(result.scores.clarity, 80);
  assert.ok(result.scores.overall > 0 && result.scores.overall <= 100);
});
