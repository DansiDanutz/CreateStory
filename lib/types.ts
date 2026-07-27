export const PROVIDERS = ["openai", "anthropic", "kimi"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const RESEARCH_ENGINES = ["tavily", "firecrawl", "exa", "perplexity", "github", "openai", "crawl4ai"] as const;
export type ResearchEngine = (typeof RESEARCH_ENGINES)[number];

export const GENRES = [
  "Mystery", "Drama", "Action", "Suspense", "History", "Science",
  "Dark", "Inspiring", "Adventure", "Conspiracy", "Horror", "Educational",
] as const;

export const TONES = ["Cinematic", "Conversational", "Urgent", "Witty", "Documentary", "Emotional"] as const;

export interface GenerateInput {
  subject: string;
  providers: Provider[];
  genres: string[];
  tone: string;
  duration: "short" | "standard" | "deep";
  audience: string;
  language: string;
  hookStyle: string;
  pacing: "fast" | "balanced" | "slow-burn";
  factuality: "strict" | "balanced" | "creative";
  includeVisuals: boolean;
  includeSfx: boolean;
  includeCta: boolean;
  includeTitleIdeas: boolean;
  researchDepth: "quick" | "standard" | "deep";
  researchEngines: ResearchEngine[];
}

export interface Source {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface ScriptResult {
  provider: Provider;
  model: string;
  title: string;
  titleIdeas: string[];
  hook: string;
  narration: string;
  visualBeats: string[];
  soundDesign: string[];
  cta: string;
  whyItWorks: string;
  wordCount: number;
  estimatedSeconds: number;
  scores: { hook: number; retention: number; clarity: number; originality: number; factuality: number; overall: number };
  error?: string;
}

export interface GenerateResponse {
  id: string;
  createdAt: string;
  subject: string;
  researchSummary: string;
  sources: Source[];
  researchEngine: string;
  results: ScriptResult[];
}

export interface Capabilities {
  providers: Record<Provider, { configured: boolean; model: string }>;
  research: Record<string, boolean>;
  installedTools: string[];
  installedPlugins: string[];
  recommendedSkills: { name: string; purpose: string; status: "installed" | "optional" }[];
}
