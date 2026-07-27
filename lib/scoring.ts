import type { ScriptResult } from "./types";

const clamp = (value: unknown, fallback: number) => Math.max(1, Math.min(100, Number(value) || fallback));

export function finalizeScript(result: Omit<ScriptResult, "wordCount" | "estimatedSeconds" | "scores"> & { scores?: Partial<ScriptResult["scores"]> }): ScriptResult {
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
  return { ...result, titleIdeas: result.titleIdeas || [], visualBeats: result.visualBeats || [], soundDesign: result.soundDesign || [], cta: result.cta || "", whyItWorks: result.whyItWorks || "", wordCount, estimatedSeconds: Math.max(1, Math.round(wordCount / 2.55)), scores };
}
