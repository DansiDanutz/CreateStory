import { GENRES, PROVIDERS, TONES, type GenerateInput, type Provider } from "./types";

const allowed = <T extends readonly string[]>(value: unknown, values: T): value is T[number] =>
  typeof value === "string" && values.includes(value as T[number]);

export function validateInput(value: unknown): GenerateInput {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  const input = value as Record<string, unknown>;
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (subject.length < 3 || subject.length > 240) throw new Error("Subject must be between 3 and 240 characters.");

  const providers = Array.isArray(input.providers)
    ? [...new Set(input.providers.filter((item): item is Provider => allowed(item, PROVIDERS)))]
    : [];
  if (!providers.length) throw new Error("Select at least one story engine.");

  const genres = Array.isArray(input.genres)
    ? [...new Set(input.genres.filter((item): item is string => allowed(item, GENRES)))].slice(0, 8)
    : [];
  if (!genres.length) throw new Error("Select at least one story genre.");

  const tone = allowed(input.tone, TONES) ? input.tone : "Cinematic";
  const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
    typeof v === "string" && values.includes(v as T) ? (v as T) : fallback;

  return {
    subject,
    providers,
    genres,
    tone,
    duration: oneOf(input.duration, ["short", "standard", "deep"], "standard"),
    audience: typeof input.audience === "string" ? input.audience.slice(0, 80) : "Curious adults 18–44",
    language: typeof input.language === "string" ? input.language.slice(0, 40) : "English",
    hookStyle: typeof input.hookStyle === "string" ? input.hookStyle.slice(0, 80) : "Impossible question",
    pacing: oneOf(input.pacing, ["fast", "balanced", "slow-burn"], "fast"),
    factuality: oneOf(input.factuality, ["strict", "balanced", "creative"], "strict"),
    includeVisuals: input.includeVisuals !== false,
    includeSfx: input.includeSfx !== false,
    includeCta: input.includeCta !== false,
    includeTitleIdeas: input.includeTitleIdeas !== false,
    researchDepth: oneOf(input.researchDepth, ["quick", "standard", "deep"], "standard"),
  };
}
