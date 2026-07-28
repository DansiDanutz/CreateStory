import type { EditorialDecision, ScriptResult, Source } from "./types";

const clamp = (value: unknown, fallback: number) => Math.max(1, Math.min(100, Number(value) || fallback));

export function finalizeScript(result: Omit<ScriptResult, "wordCount" | "estimatedSeconds" | "scores" | "citedSourceIndexes" | "factCheck"> & { scores?: Partial<ScriptResult["scores"]> }, sources: Source[] = []): ScriptResult {
  const wordCount = result.narration.trim().split(/\s+/).filter(Boolean).length;
  const scores = {
    hook: clamp(result.scores?.hook, 78),
    retention: clamp(result.scores?.retention, 78),
    clarity: clamp(result.scores?.clarity, 80),
    originality: clamp(result.scores?.originality, 76),
    factuality: clamp(result.scores?.factuality, 80),
    overall: 0,
  };
  scores.overall = Math.round(scores.hook * .24 + scores.retention * .28 + scores.clarity * .16 + scores.originality * .14 + scores.factuality * .18);
  const citedSourceIndexes = [...new Set([...result.narration.matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1])).filter(index => index > 0 && index <= sources.length))].sort((a, b) => a - b);
  const substantiveSentences = result.narration.split(/(?<=[.!?])\s+/).filter(sentence => sentence.replace(/\[\d{1,2}\]/g, "").trim().split(/\s+/).length >= 5);
  const citedSentences = substantiveSentences.filter(sentence => [...sentence.matchAll(/\[(\d{1,2})\]/g)].some(match => Number(match[1]) > 0 && Number(match[1]) <= sources.length));
  const coverage = sources.length && substantiveSentences.length ? Math.round(citedSentences.length / substantiveSentences.length * 100) : 0;
  const warnings: string[] = [];
  if (!sources.length) warnings.push("No external evidence was available for this draft.");
  else if (!citedSourceIndexes.length) warnings.push("The narration contains no inline source markers.");
  if (/\b(?:allegedly|perhaps|possibly|legend says|some believe)\b/i.test(result.narration)) warnings.push("Qualified or legendary claims need editorial review.");
  const factCheck = { status: (!sources.length ? "unverified" : coverage >= 80 && citedSourceIndexes.length >= Math.min(3, sources.length) ? "grounded" : "review") as NonNullable<ScriptResult["factCheck"]>["status"], coverage: Math.min(100, coverage), warnings };
  return { ...result, titleIdeas: result.titleIdeas || [], visualBeats: result.visualBeats || [], soundDesign: result.soundDesign || [], cta: result.cta || "", whyItWorks: result.whyItWorks || "", wordCount, estimatedSeconds: Math.max(1, Math.round(wordCount / 2.55)), scores, citedSourceIndexes, factCheck };
}

export function selectEditorialWinner(results: ScriptResult[]): EditorialDecision {
  const completed = results.filter(result => !result.error && result.narration.trim());
  if (!completed.length) return { winner: null, score: 0, rationale: "No writer completed a draft, so no winner was selected." };
  const ranked = completed.map(result => ({ result, score: Math.round(result.scores.overall * .75 + (result.factCheck?.coverage || 0) * .25) })).sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  return { winner: winner.result.provider, score: winner.score, rationale: `${winner.result.provider} leads on combined retention craft, clarity, originality, factuality, and citation coverage. Human editorial review is still recommended before publishing.` };
}
