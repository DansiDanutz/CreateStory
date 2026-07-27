"use client";

import { useEffect, useMemo, useState } from "react";
import { GENRES, PROVIDERS, RESEARCH_ENGINES, TONES, type Capabilities, type GenerateInput, type GenerateResponse, type Provider, type ResearchEngine, type ScriptResult } from "@/lib/types";

const providerMeta: Record<Provider, { name: string; mark: string; color: string }> = {
  openai: { name: "GPT", mark: "G", color: "emerald" },
  anthropic: { name: "Claude", mark: "C", color: "coral" },
  kimi: { name: "Kimi", mark: "K", color: "violet" },
};

const researchMeta: Record<ResearchEngine, { name: string; role: string }> = {
  tavily: { name: "Tavily", role: "deep web search" },
  firecrawl: { name: "Firecrawl", role: "search + scrape" },
  exa: { name: "Exa", role: "semantic search" },
  perplexity: { name: "Perplexity", role: "ranked live search" },
  github: { name: "GitHub", role: "repositories & archives" },
  openai: { name: "OpenAI Web", role: "agentic fallback" },
  crawl4ai: { name: "Crawl4AI", role: "page enrichment" },
};

const initial: GenerateInput = {
  subject: "The lighthouse that kept shining after its keepers vanished",
  providers: [...PROVIDERS],
  genres: ["Mystery", "Drama", "History", "Suspense"],
  tone: "Cinematic",
  duration: "standard",
  audience: "Curious adults 18–44",
  language: "English",
  hookStyle: "Impossible question",
  pacing: "fast",
  factuality: "strict",
  includeVisuals: true,
  includeSfx: true,
  includeCta: true,
  includeTitleIdeas: true,
  researchDepth: "standard",
  researchEngines: [...RESEARCH_ENGINES],
};

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return <button type="button" className="toggle-row" aria-pressed={checked} onClick={onChange}><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><i className={`switch ${checked ? "on" : ""}`}><b /></i></button>;
}

function ScoreRing({ score }: { score: number }) {
  return <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><span>{score}</span><small>score</small></div>;
}

function StoryCard({ result, sources }: { result: ScriptResult; sources: GenerateResponse["sources"] }) {
  const [tab, setTab] = useState<"script" | "visuals" | "titles">("script");
  const [copied, setCopied] = useState(false);
  const meta = providerMeta[result.provider];
  const copy = async () => { await navigator.clipboard.writeText(`${result.title}\n\n${result.narration}\n\n${result.cta}`); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  const download = () => {
    const body = `# ${result.title}\n\n**Engine:** ${meta.name} · ${result.model}\n**Hook:** ${result.hook}\n\n## Narration\n\n${result.narration}\n\n## Visual beats\n${result.visualBeats.map(v => `- ${v}`).join("\n")}\n\n## Sound design\n${result.soundDesign.map(v => `- ${v}`).join("\n")}\n\n## CTA\n${result.cta}\n\n## Sources\n${sources.map(s => `- [${s.title}](${s.url})`).join("\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    link.download = `${result.provider}-${result.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.md`;
    link.click(); URL.revokeObjectURL(link.href);
  };
  return <article className={`story-card ${meta.color}`}>
    <header className="story-head"><div className="provider"><span>{meta.mark}</span><div><strong>{meta.name}</strong><small>{result.model}</small></div></div><ScoreRing score={result.scores.overall} /></header>
    {result.error ? <div className="error-box"><strong>This engine paused</strong><p>{result.error}</p></div> : <>
      <h3>{result.title}</h3>
      <blockquote>{result.hook}</blockquote>
      <div className="story-meta"><span>{result.wordCount} words</span><span>~{result.estimatedSeconds}s</span><span>{result.scores.retention}% retention craft</span></div>
      <nav className="tabs" aria-label={`${meta.name} output sections`}>
        {(["script", "visuals", ...(result.titleIdeas.length ? ["titles" as const] : [])] as const).map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      <div className="story-body">
        {tab === "script" && <div className="narration">{result.narration.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}{result.cta && <p className="cta">{result.cta}</p>}</div>}
        {tab === "visuals" && <ol className="beat-list">{result.visualBeats.map((beat, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span>{beat}</li>)}</ol>}
        {tab === "titles" && <div className="title-list">{[result.title, ...result.titleIdeas].map((title, i) => <p key={i}><span>{i ? `ALT ${i}` : "PRIMARY"}</span>{title}</p>)}</div>}
      </div>
      <footer><button onClick={copy}>{copied ? "Copied" : "Copy script"}</button><button onClick={download}>Download .md</button></footer>
    </>}
  </article>;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  try { return JSON.parse(body) as T; }
  catch {
    const message = body.trim().split("\n")[0];
    throw new Error(message || `The server returned an invalid response (${response.status}).`);
  }
}

export default function Home() {
  const [input, setInput] = useState(initial);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"create" | "stack" | "history">("create");
  const [history, setHistory] = useState<GenerateResponse[]>([]);
  const [accessCode, setAccessCode] = useState("");
  const [accessStatus, setAccessStatus] = useState<"unknown" | "ready" | "locked">("unknown");

  useEffect(() => {
    const loadHistory = window.setTimeout(() => {
      try { setHistory(JSON.parse(localStorage.getItem("storylab-history") || "[]")); } catch { /* corrupt browser storage is safely ignored */ }
      const savedCode = sessionStorage.getItem("storylab-access") || "";
      setAccessCode(savedCode);
      fetch("/api/capabilities", { headers: { "x-storylab-access-code": savedCode } }).then(async response => {
        if (!response.ok) { setAccessStatus("locked"); return; }
        setCapabilities(await readApiResponse<Capabilities>(response)); setAccessStatus("ready");
      }).catch(() => setAccessStatus("locked"));
    }, 0);
    return () => window.clearTimeout(loadHistory);
  }, []);

  const readyProviders = useMemo(() => input.providers.filter(p => capabilities?.providers[p].configured !== false).length, [input.providers, capabilities]);
  const toggleArray = (key: "genres" | "providers" | "researchEngines", value: string) => setInput(current => {
    const list = current[key] as string[];
    const next = list.includes(value) ? list.filter(item => item !== value) : [...list, value];
    return next.length ? { ...current, [key]: next } : current;
  });
  const update = <K extends keyof GenerateInput>(key: K, value: GenerateInput[K]) => setInput(current => ({ ...current, [key]: value }));
  const connectStudio = async () => {
    const response = await fetch("/api/capabilities", { headers: { "x-storylab-access-code": accessCode } });
    if (!response.ok) { setAccessStatus("locked"); setError("That studio access code is not valid."); return; }
    sessionStorage.setItem("storylab-access", accessCode); setCapabilities(await readApiResponse<Capabilities>(response)); setAccessStatus("ready"); setError("");
  };

  const generate = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", "x-storylab-access-code": accessCode }, body: JSON.stringify(input) });
      const data = await readApiResponse<GenerateResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "The studio could not complete this run.");
      setResult(data);
      const next = [data, ...history.filter(item => item.id !== data.id)].slice(0, 12);
      setHistory(next); localStorage.setItem("storylab-history", JSON.stringify(next));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Generation failed."); }
    finally { setLoading(false); }
  };

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span>SL</span><div>STORY<strong>LAB</strong></div></a>
      <nav>
        <button className={view === "create" ? "active" : ""} onClick={() => setView("create")}><span>✦</span>Create</button>
        <button className={view === "stack" ? "active" : ""} onClick={() => setView("stack")}><span>⌘</span>AI Stack</button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><span>◴</span>History <i>{history.length}</i></button>
      </nav>
      <div className="sidebar-note"><span className="pulse" /><strong>Studio online</strong><small>{readyProviders} selected engines ready</small></div>
      <p className="version">CreateStory · v1.0</p>
    </aside>

    <main id="top">
      <header className="topbar"><div><span className="eyebrow">MULTI-MODEL STORY ENGINE</span><h1>{view === "create" ? "Create your next story" : view === "stack" ? "Your creative stack" : "Recent story runs"}</h1></div><div className="top-actions"><div className={`access-control ${accessStatus}`}><input type="password" aria-label="Studio access code" value={accessCode} onChange={event => setAccessCode(event.target.value)} onKeyDown={event => event.key === "Enter" && connectStudio()} placeholder="Access code" /><button onClick={connectStudio}>{accessStatus === "ready" ? "Connected" : "Unlock"}</button></div><a href="https://www.youtube.com/creators/" target="_blank" rel="noopener noreferrer">Creator guide ↗</a><span className="avatar">DD</span></div></header>

      {view === "create" && <>
        <section className="hero-input">
          <label htmlFor="subject">What should the world discover?</label>
          <div className="subject-row"><textarea id="subject" value={input.subject} maxLength={240} onChange={e => update("subject", e.target.value)} placeholder="Enter a person, place, event, mystery, invention…" /><button disabled={loading || input.subject.trim().length < 3} onClick={generate}>{loading ? <><span className="spinner" />Building stories</> : <>Generate 3 stories <span>→</span></>}</button></div>
          <div className="quick-topics"><span>Try:</span>{["The dancing plague of 1518", "How trees secretly communicate", "The astronaut who almost drowned in space"].map(topic => <button key={topic} onClick={() => update("subject", topic)}>{topic}</button>)}</div>
        </section>

        <div className="workspace">
          <section className="control-panel">
            <div className="panel-title"><div><span>01</span><h2>Story DNA</h2></div><small>Choose up to 8</small></div>
            <div className="chips">{GENRES.map(genre => <button key={genre} className={input.genres.includes(genre) ? "selected" : ""} onClick={() => toggleArray("genres", genre)}>{genre}</button>)}</div>
            <hr />
            <div className="field-grid">
              <label>Tone<select value={input.tone} onChange={e => update("tone", e.target.value)}>{TONES.map(tone => <option key={tone}>{tone}</option>)}</select></label>
              <label>Duration<select value={input.duration} onChange={e => update("duration", e.target.value as GenerateInput["duration"])}><option value="short">~60 sec</option><option value="standard">~90 sec</option><option value="deep">2–3 min</option><option value="five">~5 min</option><option value="ten">~10 min</option><option value="fifteen">~15 min</option></select></label>
              <label>Pacing<select value={input.pacing} onChange={e => update("pacing", e.target.value as GenerateInput["pacing"])}><option value="fast">Fast cuts</option><option value="balanced">Balanced</option><option value="slow-burn">Slow burn</option></select></label>
              <label>Hook style<select value={input.hookStyle} onChange={e => update("hookStyle", e.target.value)}><option>Impossible question</option><option>Cold open</option><option>Shocking fact</option><option>In medias res</option><option>Personal confession</option></select></label>
              <label>Audience<input value={input.audience} onChange={e => update("audience", e.target.value)} /></label>
              <label>Language<select value={input.language} onChange={e => update("language", e.target.value)}><option>English</option><option>Romanian</option><option>Spanish</option><option>French</option><option>German</option></select></label>
            </div>
          </section>

          <section className="control-panel">
            <div className="panel-title"><div><span>02</span><h2>Creative controls</h2></div></div>
            <div className="toggle-list">
              <Toggle checked={input.includeVisuals} onChange={() => update("includeVisuals", !input.includeVisuals)} label="Visual beat sheet" hint="Shot ideas for every reveal" />
              <Toggle checked={input.includeSfx} onChange={() => update("includeSfx", !input.includeSfx)} label="Sound direction" hint="Music and SFX cues" />
              <Toggle checked={input.includeCta} onChange={() => update("includeCta", !input.includeCta)} label="Natural CTA" hint="Earn the subscribe ask" />
              <Toggle checked={input.includeTitleIdeas} onChange={() => update("includeTitleIdeas", !input.includeTitleIdeas)} label="Title variants" hint="Three honest curiosity hooks" />
            </div>
            <div className="segmented-label">Factual guardrails</div>
            <div className="segmented">{(["strict", "balanced", "creative"] as const).map(v => <button key={v} className={input.factuality === v ? "selected" : ""} onClick={() => update("factuality", v)}>{v}</button>)}</div>
            <div className="segmented-label">Research depth</div>
            <div className="segmented">{(["quick", "standard", "deep"] as const).map(v => <button key={v} className={input.researchDepth === v ? "selected" : ""} onClick={() => update("researchDepth", v)}>{v}</button>)}</div>
            <div className="segmented-label">Research engines</div>
            <div className="research-engines">{RESEARCH_ENGINES.map(engine => <button key={engine} className={input.researchEngines.includes(engine) ? "selected" : ""} onClick={() => toggleArray("researchEngines", engine)}><strong>{researchMeta[engine].name}</strong><small>{researchMeta[engine].role}</small><i>{capabilities?.research[researchMeta[engine].name] === false ? "setup" : "on"}</i></button>)}</div>
          </section>

          <section className="control-panel engines-panel">
            <div className="panel-title"><div><span>03</span><h2>Story engines</h2></div><small>Independent drafts</small></div>
            <div className="engine-list">{PROVIDERS.map(provider => { const meta = providerMeta[provider]; const configured = capabilities?.providers[provider].configured; return <button key={provider} className={`${input.providers.includes(provider) ? "selected" : ""} ${meta.color}`} onClick={() => toggleArray("providers", provider)}><span className="engine-mark">{meta.mark}</span><span><strong>{meta.name}</strong><small>{capabilities?.providers[provider].model || "checking…"}</small></span><i className={configured ? "ready" : "missing"}>{configured === undefined ? "…" : configured ? "ready" : "key needed"}</i></button>; })}</div>
            <p className="engine-note">Each engine receives the same cited research pack, then writes without seeing the other drafts.</p>
          </section>
        </div>

        {loading && <section className="pipeline"><div className="pipeline-title"><span className="spinner dark" /><div><strong>Researching, verifying, writing…</strong><small>Three independent creative rooms are working in parallel. This can take 1–3 minutes.</small></div></div><div className="pipeline-steps"><span className="done">Subject brief</span><span className="active">Web research</span><span>Independent drafts</span><span>Quality pass</span></div></section>}
        {error && <div className="global-error"><strong>Generation stopped</strong><span>{error}</span><button onClick={generate}>Try again</button></div>}
        {result && <section className="results"><header><div><span className="eyebrow">RUN COMPLETE · {result.researchEngine.toUpperCase()}</span><h2>Three minds. Three stories.</h2><p>{result.sources.length} sources grounded this run · {new Date(result.createdAt).toLocaleString()}</p></div><a href="#sources">Review sources ↓</a></header><div className="story-grid">{result.results.map(story => <StoryCard key={story.provider} result={story} sources={result.sources} />)}</div><div id="sources" className="sources"><div><span>RESEARCH BRIEF</span><p>{result.researchSummary}</p></div><ol>{result.sources.map((source, i) => <li key={source.url}><span>{String(i + 1).padStart(2, "0")}</span><a href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><small>{source.engine ? `${source.engine} · ` : ""}{new URL(source.url).hostname} ↗</small></a></li>)}</ol></div></section>}
      </>}

      {view === "stack" && <StackView capabilities={capabilities} />}
      {view === "history" && <HistoryView history={history} onClear={() => { setHistory([]); localStorage.removeItem("storylab-history"); }} onOpen={item => { setResult(item); setView("create"); setTimeout(() => document.querySelector(".results")?.scrollIntoView({ behavior: "smooth" }), 80); }} />}
    </main>
  </div>;
}

function StackView({ capabilities }: { capabilities: Capabilities | null }) {
  if (!capabilities) return <div className="empty-state"><span className="spinner dark" /><h2>Auditing your stack…</h2></div>;
  return <section className="stack-view">
    <div className="stack-intro"><h2>Connected runtime & workspace audit</h2><p>Writer and research status is detected live from server credentials. Tool, plugin, and skill lists are a snapshot captured during this build—not a scan of the Vercel host. Optional tools are recommendations, not automatic installs.</p></div>
    <div className="stack-grid">
      <article><span className="eyebrow">WRITERS</span>{PROVIDERS.map(p => <div className="status-row" key={p}><span className={`status-dot ${capabilities.providers[p].configured ? "ok" : ""}`} /><div><strong>{providerMeta[p].name}</strong><small>{capabilities.providers[p].model}</small></div><b>{capabilities.providers[p].configured ? "Connected" : "Needs key"}</b></div>)}</article>
      <article><span className="eyebrow">RESEARCH ENGINES</span>{Object.entries(capabilities.research).map(([name, ok]) => <div className="status-row" key={name}><span className={`status-dot ${ok ? "ok" : ""}`} /><div><strong>{name}</strong><small>{ok ? "Credential available" : "Optional integration"}</small></div></div>)}</article>
      <article><span className="eyebrow">DEV-MACHINE TOOL SNAPSHOT</span><div className="tag-cloud">{capabilities.installedTools.map(tool => <span key={tool}>✓ {tool}</span>)}</div></article>
      <article><span className="eyebrow">WORKSPACE PLUGIN CATALOG SNAPSHOT</span><div className="tag-cloud">{capabilities.installedPlugins.map(tool => <span key={tool}>{tool}</span>)}</div></article>
    </div>
    <article className="recommendations"><span className="eyebrow">SKILLS & OPEN-SOURCE ADDITIONS</span>{capabilities.recommendedSkills.map(skill => <div key={skill.name}><span className={skill.status}>{skill.status}</span><strong>{skill.name}</strong><p>{skill.purpose}</p></div>)}</article>
  </section>;
}

function HistoryView({ history, onOpen, onClear }: { history: GenerateResponse[]; onOpen: (item: GenerateResponse) => void; onClear: () => void }) {
  if (!history.length) return <div className="empty-state"><span>◴</span><h2>No runs yet</h2><p>Your last 12 story runs will be saved in this browser.</p></div>;
  return <section className="history-view"><div className="history-notice"><span>Runs are stored only in this browser.</span><button onClick={onClear}>Clear all history</button></div>{history.map(item => <button key={item.id} onClick={() => onOpen(item)}><div><span>{new Date(item.createdAt).toLocaleDateString()}</span><h3>{item.subject}</h3><p>{item.researchEngine} · {item.sources.length} sources</p></div><div className="mini-models">{item.results.map(result => <i key={result.provider} className={result.error ? "failed" : ""}>{providerMeta[result.provider].mark}</i>)}</div><b>Open run →</b></button>)}</section>;
}
