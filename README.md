# StoryLab / CreateStory

A multi-model production dashboard for the **Did You Know That?** YouTube channel. One subject becomes a cited research brief, then GPT, Claude, and Kimi independently write three voiceover-ready scripts.

## What it does

- Runs Tavily, Firecrawl, Exa, Perplexity, GitHub, and OpenAI web research concurrently, then deduplicates evidence and optionally enriches top pages through Crawl4AI.
- Generates independent GPT, Claude, and Kimi drafts concurrently.
- Controls mystery, drama, action, suspense, history, science, pacing, tone, hook, audience, duration, language, and factual strictness.
- Produces titles, narration, visual beats, sound design, CTA, and quality scores.
- Isolates provider failures and keeps successful drafts.
- Saves the latest 12 runs in browser-local history.
- Copies or downloads scripts as production-ready Markdown.
- Detects configured runtime engines and shows a dated development-machine audit snapshot of local tools/plugins plus optional open-source additions.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add at least one writer key and any research engines you want to enable:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `MOONSHOT_API_KEY`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`
- `EXA_API_KEY`
- `PERPLEXITY_API_KEY`
- `GITHUB_TOKEN` (optional; public search works at a lower rate without it)
- `CRAWL4AI_BASE_URL` and optionally `CRAWL4AI_API_TOKEN`
- `STORYLAB_ACCESS_CODE` (required for a public deployment)

All keys are read only by server routes. Never use a `NEXT_PUBLIC_` prefix for provider credentials. Production fails closed unless the access code is at least 32 characters; use a randomly generated value. The endpoint’s process-local IP throttle is only a burst dampener on each serverless instance—the high-entropy access code is the primary public cost-control boundary. For shared multi-user use, replace it with authenticated accounts and a distributed quota store.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Research and architecture notes

The prompt design follows YouTube’s official guidance: deliver the title/thumbnail promise in the initial seconds, keep intros concise, build anticipation, and use audience retention to learn which moments work. It also protects monetization quality by requiring original, source-grounded narrative rather than interchangeable mass-produced templates.

The first release intentionally uses browser-local history. A future authenticated, shared studio can add Postgres without changing the provider adapters.

## Deployment

Deploy on Vercel, configure the same environment variables for Production, and allow up to 300 seconds for the generation route on a plan that supports it.
