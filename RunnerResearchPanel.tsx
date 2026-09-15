"use client";

import { useEffect, useMemo, useState } from "react";

type Requirement = { id: string; label: string; current: string; target: string; passed: boolean };
type Research = {
  mission: string;
  casesStudied: number;
  labeledCases: number;
  runnerCases: number;
  dumperCases: number;
  neutralCases: number;
  openCases: number;
  observations: number;
  paperTrades: number;
  paperWins: number;
  freshCoinWins: number;
  targetFreshCoinWins: number;
  runnerCaptures: number;
  activeHypotheses: number;
  confirmedTells: number;
  invalidatedTells: number;
  topRunnerTells: string[];
  topDumpTells: string[];
  recentBotLessons: Array<{ agentId: string; message: string; at: string }>;
  recentCases: Array<{ symbol: string; chain: string; outcome: string; firstMarketCap: number; peakMarketCap: number; peakReturnPct: number; paperReturnPct?: number; lastSeenAt: string }>;
  oosAccuracyPct: number;
  paperProfitFactor: number;
  paperExpectancyPct: number;
  maxObservedDrawdownPct: number;
  providerCoveragePct: number;
  codeProgressPct: number;
  codeDeciphered: boolean;
  liveTradingEligible: boolean;
  liveAutoEnableRequested: boolean;
  liveExecutorConfigured: boolean;
  liveTradingArmed: boolean;
  requirements: Requirement[];
  dailyAutopsy: string[];
  generatedAt: string;
};

type Payload = {
  research?: Research;
  paperWalletResetMeta?: { resets: number; totalInjectedUsd: number; lastResetAt?: string };
};

function compactUsd(value: number) {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

function timeAgo(value?: string) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function RunnerResearchPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/autopilot", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as Payload;
        if (active) setPayload(next);
      } catch { /* main dashboard owns connectivity warnings */ }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const r = payload?.research;
  const progress = Math.max(0, Math.min(100, r?.codeProgressPct ?? 0));
  const resetMeta = payload?.paperWalletResetMeta;
  const status = !r ? "BUILDING RESEARCH STATE" : r.codeDeciphered ? "CODE DECIPHERED" : "CODE DECIPHERING";
  const liveStatus = !r ? "LOCKED" : r.liveTradingArmed ? "LIVE ARMED" : r.liveTradingEligible ? "LIVE READY — EXECUTOR REQUIRED" : "LIVE LOCKED";
  const requirementRows = r?.requirements ?? [];
  const caseRows = r?.recentCases ?? [];
  const lessons = useMemo(() => (r?.recentBotLessons ?? []).slice(0, 8), [r?.recentBotLessons]);

  return (
    <section className="v214-research page-panel" id="filing-cabinet">
      <div className="v214-hero-row">
        <div>
          <span className="v214-kicker">RUNNER GENOME · FILING CABINET</span>
          <h2>The Council&apos;s main mission: crack the runner vs dumper pattern.</h2>
          <p>{r?.mission ?? "Every fresh launch becomes a case file. The Council studies outcomes, trades in paper mode and files what it learns."}</p>
        </div>
        <div className={`v214-live-lock ${r?.liveTradingArmed ? "armed" : ""}`}><small>AUTO LIVE STATE</small><b>{liveStatus}</b></div>
      </div>

      <div className="v214-code-card">
        <div className="v214-code-head"><div><span>{status}</span><strong>{progress}%</strong></div><p>{r?.codeDeciphered ? "All research graduation gates passed." : "The bar only reaches 100% when every graduation requirement passes — including 100 successful fresh-coin wins."}</p></div>
        <div className="v214-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
        <div className="v214-progress-labels"><span>Collecting evidence</span><span>Testing hypotheses</span><span>Validating edge</span><span>CODE DECIPHERED</span></div>
      </div>

      <div className="v214-stat-grid">
        <div><strong>{r?.casesStudied ?? 0}</strong><span>coin case files</span></div>
        <div><strong>{r?.observations ?? 0}</strong><span>observations filed</span></div>
        <div><strong>{r?.runnerCases ?? 0}</strong><span>runners identified</span></div>
        <div><strong>{r?.dumperCases ?? 0}</strong><span>dumpers identified</span></div>
        <div className="v214-win"><strong>{r?.freshCoinWins ?? 0}/{r?.targetFreshCoinWins ?? 100}</strong><span>fresh-coin wins</span></div>
        <div><strong>{r?.runnerCaptures ?? 0}</strong><span>runners paper-captured</span></div>
        <div><strong>{r?.activeHypotheses ?? 0}</strong><span>active hypotheses</span></div>
        <div><strong>{r?.confirmedTells ?? 0}</strong><span>confirmed tells</span></div>
      </div>

      <div className="v214-three-col">
        <article className="v214-box">
          <div className="v214-box-title"><h3>Graduation requirements</h3><span>{requirementRows.filter((row) => row.passed).length}/{requirementRows.length || 0} passed</span></div>
          <div className="v214-req-list">{requirementRows.length ? requirementRows.map((row) => <div className="v214-req" key={row.id}><i className={row.passed ? "pass" : "wait"}>{row.passed ? "✓" : "•"}</i><span><b>{row.label}</b><small>{row.current} / {row.target}</small></span></div>) : <p className="v214-muted">Waiting for the research engine to initialize.</p>}</div>
        </article>

        <article className="v214-box">
          <div className="v214-box-title"><h3>Strongest runner tells</h3><span>Filing Cabinet</span></div>
          <div className="v214-tell-list">{(r?.topRunnerTells ?? []).length ? r!.topRunnerTells.map((tell, i) => <p key={`${i}-${tell}`}><b>{String(i + 1).padStart(2, "0")}</b>{tell}</p>) : <p className="v214-muted">Need runner and dumper labels before the Council can validate tells.</p>}</div>
        </article>

        <article className="v214-box">
          <div className="v214-box-title"><h3>Dumper contrasts</h3><span>{r?.invalidatedTells ?? 0} invalidated ideas</span></div>
          <div className="v214-tell-list">{(r?.topDumpTells ?? []).length ? r!.topDumpTells.map((tell, i) => <p key={`${i}-${tell}`}><b>{String(i + 1).padStart(2, "0")}</b>{tell}</p>) : <p className="v214-muted">The Bear Bot is still collecting matched failures.</p>}</div>
        </article>
      </div>

      <div className="v214-metric-strip">
        <div><small>OOS genome accuracy</small><b>{(r?.oosAccuracyPct ?? 0).toFixed(1)}%</b></div>
        <div><small>Paper profit factor</small><b>{(r?.paperProfitFactor ?? 0).toFixed(2)}</b></div>
        <div><small>Paper expectancy</small><b className={(r?.paperExpectancyPct ?? 0) >= 0 ? "positive" : "negative"}>{(r?.paperExpectancyPct ?? 0) >= 0 ? "+" : ""}{(r?.paperExpectancyPct ?? 0).toFixed(2)}%</b></div>
        <div><small>Max adverse excursion</small><b>{(r?.maxObservedDrawdownPct ?? 0).toFixed(1)}%</b></div>
        <div><small>Provider coverage</small><b>{r?.providerCoveragePct ?? 0}%</b></div>
        <div><small>Paper wallet resets</small><b>{resetMeta?.resets ?? 0}</b></div>
      </div>

      <div className="v214-two-col">
        <article className="v214-box">
          <div className="v214-box-title"><h3>What the bots are filing</h3><span>all 8 roles</span></div>
          <div className="v214-lessons">{lessons.length ? lessons.map((row, index) => <div key={`${row.at}-${row.agentId}-${index}`}><span>{row.agentId.toUpperCase()}</span><p>{row.message}</p><time>{timeAgo(row.at)}</time></div>) : <p className="v214-muted">The next Council reads will appear here as research notes.</p>}</div>
        </article>

        <article className="v214-box">
          <div className="v214-box-title"><h3>Recent case files</h3><span>runner / dumper autopsy queue</span></div>
          <div className="v214-case-table"><div className="v214-case-head"><span>Coin</span><span>First MC</span><span>Peak MC</span><span>Outcome</span></div>{caseRows.length ? caseRows.map((row, index) => <div className="v214-case-row" key={`${row.chain}-${row.symbol}-${index}`}><b>${row.symbol}<small>{row.chain}</small></b><span>{compactUsd(row.firstMarketCap)}</span><span>{compactUsd(row.peakMarketCap)}<small>{row.peakReturnPct >= 0 ? "+" : ""}{row.peakReturnPct.toFixed(0)}%</small></span><em className={`outcome-${row.outcome}`}>{row.outcome}</em></div>) : <p className="v214-muted">No case files yet.</p>}</div>
        </article>
      </div>

      <div className="v214-autopsy">
        <div><h3>Daily Autopsy</h3><p>The Council compares today&apos;s runners with matched failures instead of only studying trades it took.</p></div>
        <div>{(r?.dailyAutopsy ?? []).map((line, i) => <p key={`${i}-${line}`}>{line}</p>)}</div>
      </div>
    </section>
  );
}
