import type { GenerateInput, Source } from "./types";

const targets = { short: "130–170 words (about 60 seconds)", standard: "190–260 words (about 90 seconds)", deep: "330–430 words (2–3 minutes)" };

export function buildWriterPrompt(input: GenerateInput, summary: string, sources: Source[], providerName: string): string {
  const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}\n${source.url}`).join("\n\n");
  return `You are ${providerName}, working independently as an elite factual YouTube storyteller for the channel “Did You Know That?”.

SUBJECT: ${input.subject}
AUDIENCE: ${input.audience}
LANGUAGE: ${input.language}
TARGET: ${targets[input.duration]}
STORY DNA: ${input.genres.join(", ")}; ${input.tone} tone; ${input.pacing} pacing
HOOK STYLE: ${input.hookStyle}
FACTUAL MODE: ${input.factuality}

RESEARCH EDITOR'S BRIEF:
${summary}

SOURCE NOTES:
${evidence || "No external sources were available. Clearly mark uncertain claims and avoid precise unsupported facts."}

Write an original, voiceover-ready script. The first sentence must deliver the title's promise immediately. Open a curiosity gap, escalate with a reveal every 2–4 sentences, use concrete sensory language, and end with a satisfying payoff. Never invent a fact, quote, date, or source. Distinguish legend from verified history. Do not mention being an AI or the research process.

Return ONLY valid JSON matching this shape:
{
  "title": "one compelling honest title",
  "titleIdeas": ${input.includeTitleIdeas ? "[\"three optional titles\"]" : "[]"},
  "hook": "the exact opening line",
  "narration": "complete voiceover with short paragraphs",
  "visualBeats": ["${input.includeVisuals ? "6–10 concise scene directions" : "leave empty"}"],
  "soundDesign": ["${input.includeSfx ? "3–6 music or SFX cues" : "leave empty"}"],
  "cta": "${input.includeCta ? "one natural channel CTA" : "leave empty"}",
  "whyItWorks": "2 concise sentences explaining the retention strategy",
  "scores": {"hook": 1, "retention": 1, "clarity": 1, "originality": 1, "factuality": 1}
}
Use integer scores from 1–100 and judge your own draft critically.`;
}

export function buildResearchQuery(input: GenerateInput): string {
  return `${input.subject}: verified surprising facts, primary sources, historical context, misconceptions, chronology, and story-worthy human details for a factual YouTube video`;
}
