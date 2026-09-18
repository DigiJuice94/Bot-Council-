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
  fiftyDollarTrades: number;
  fiftyDollarOpen: number;
  fiftyDollarWins: number;
  fiftyDollarLosses: number;
  fiftyDollarWinRatePct: number;
  fiftyDollarNetPnlUsd: number;
  fiftyDollarAvgReturnPct: number;
  medianRunnerPeakMultiple: number;
  medianRunnerTimeToPeakMinutes: number;
  medianRunnerDrawdownPct: number;
  recentFiftyDollarTrades: Array<{ symbol: string; chain: string; outcome: string; status: "OPEN" | "WIN" | "LOSS" | "FLAT"; pnlUsd?: number; returnPct?: number; entryAt?: string }>;
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
  trajectoryObserver?: {
    sequencesTracked: number;
    labeledSequences: number;
    runnerSequences: number;
    dumperSequences: number;
    chainModels: number;
    latestLessons: Array<{ symbol: string; chain: string; outcome: string; message: string }>;
  };
  generatedAt: string;
};

type Payload = {
  research?: Research;
  paperWalletResetMeta?: { resets: number; totalInjectedUsd: number; lastResetAt?: string };
  sellabilityLearning?: {
    casesFiled: number;
    chainCoverage: number;
    totalLockedLossUsd: number;
    learnedCandidatesBlocked: number;
    latestCaseAt?: string;
    latestCaseSymbol?: string;
    latestBlockAt?: string;
    latestBlockSymbol?: string;
  };
  filingCabinetCurator?: {
    role: "advisory-only";
    storage: "redis" | "memory";
    persistenceVerified: boolean;
    recordsRead: number;
    botsReporting: number;
    totalBots: 9;
    allBotsReporting: boolean;
    cioBrief: string;
    cioAdjustment: number;
    evidenceSampleSize: number;
    generatedAt: string;
    neverForgetCount: number;
    neverForgetCapacity: 50;
    topTechniques: Array<{ id: string; rank: number; title: string; instruction: string; evidence: string; significanceScore: number; source: string; direction: "positive" | "caution" | "neutral" }>;
    neverForgetTechniques: Array<{ id: string; rank: number; title: string; instruction: string; evidence: string; significanceScore: number; source: string; direction: "positive" | "caution" | "neutral"; confirmations: number; evidenceSampleSize: number; firstFiledAt: string; lastConfirmedAt: string }>;
    botAudit: Array<{ agentId: string; name: string; status: "ACTIVE" | "BUILDING" | "STALE"; recordsRead: number; decisions: number; outcomes: number; trajectories: number; lastWriteAt?: string; finding: string }>;
  };
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
    const receive = (event: Event) => setPayload((event as CustomEvent<Payload>).detail);
    window.addEventListener("bot-war-room:status", receive);
    return () => window.removeEventListener("bot-war-room:status", receive);
  }, []);

  const r = payload?.research;
  const progress = Math.max(0, Math.min(100, r?.codeProgressPct ?? 0));
  const resetMeta = payload?.paperWalletResetMeta;
  const status = !r ? "BUILDING RESEARCH STATE" : r.codeDeciphered ? "CODE DECIPHERED" : "CODE DECIPHERING";
  const liveStatus = !r ? "LOCKED" : r.liveTradingArmed ? "LIVE ARMED" : r.liveTradingEligible ? "LIVE READY — EXECUTOR REQUIRED" : "LIVE LOCKED";
  const requirementRows = r?.requirements ?? [];
  const caseRows = r?.recentCases ?? [];
  const lessons = useMemo(() => (r?.recentBotLessons ?? []).slice(0, 8), [r?.recentBotLessons]);
  const sellability = payload?.sellabilityLearning;
  const curator = payload?.filingCabinetCurator;

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

      <article className="filing-curator-card">
        <div className="filing-curator-head">
          <div><span>FILING CABINET CURATOR · BACKGROUND ADVISOR · NO VOTE</span><h3>Reads the full cabinet, audits every bot and briefs the CIO.</h3><p>The CIO may consider this evidence, but the Curator cannot force a BUY, SKIP or veto. Its sole scoring goal is improving real, sellable paper profit—not inflating results with exits that could not execute.</p></div>
          <strong className={curator?.persistenceVerified ? "verified" : "fallback"}>{curator?.persistenceVerified ? "PERSISTENT" : "MEMORY FALLBACK"}<small>{curator?.botsReporting ?? 0}/9 bots reporting</small></strong>
        </div>
        <div className="filing-curator-brief">
          <span>EXACT ADVISORY SENT TO CIO</span>
          <blockquote>{curator?.cioBrief ?? "The Curator is reading the Filing Cabinet before issuing its first advisory."}</blockquote>
          <small>CIO context adjustment: <b>{(curator?.cioAdjustment ?? 0) >= 0 ? "+" : ""}{(curator?.cioAdjustment ?? 0).toFixed(1)} points</b> · hard safety rules remain unchanged · {curator?.recordsRead ?? 0} stored records read</small>
        </div>
        <div className="filing-curator-columns">
          <section>
            <div className="filing-curator-title"><div><b>TOP 10 LEARNED TECHNIQUES</b><small>Re-ranked as evidence changes</small></div><em>{curator?.topTechniques.length ?? 0}/10</em></div>
            <div className="filing-techniques">{curator?.topTechniques.length ? curator.topTechniques.map((row) => <div key={row.id} className={`filing-technique ${row.direction}`}>
              <strong>#{row.rank}</strong><span><b>{row.title}</b><p>{row.instruction}</p><small>{row.evidence}</small></span><em>{row.significanceScore}</em>
            </div>) : <p className="v214-muted">Waiting for enough completed evidence to rank a technique. The Curator will not invent one to fill a slot.</p>}</div>
          </section>
          <section>
            <div className="filing-curator-title"><div><b>BOT JOB AUDIT</b><small>Private decisions, outcomes and trajectory work</small></div><em>{curator?.botsReporting ?? 0}/9</em></div>
            <div className="filing-bot-audit">{curator?.botAudit.map((row) => <div key={row.agentId}><i className={row.status.toLowerCase()}>{row.status}</i><span><b>{row.name}</b><small>{row.finding}</small></span><time>{timeAgo(row.lastWriteAt)}</time></div>) ?? <p className="v214-muted">Audit is initializing.</p>}</div>
          </section>
        </div>
        <div className="never-forget-vault">
          <div className="filing-curator-title"><div><b>NEVER FORGET VAULT</b><small>Only repeatedly evidenced profit or loss-avoidance techniques survive wallet resets</small></div><em>{curator?.neverForgetCount ?? 0}/{curator?.neverForgetCapacity ?? 50}</em></div>
          <div className="never-forget-scroll">{curator?.neverForgetTechniques.length ? curator.neverForgetTechniques.map((row) => <div key={row.id}><strong>#{row.rank} {row.title}</strong><span>{row.instruction}</span><small>{row.confirmations} confirmations · evidence sample {row.evidenceSampleSize} · {row.source}</small></div>) : <p>No technique has crossed the repeated-evidence threshold yet. This vault never promotes a one-off win.</p>}</div>
        </div>
      </article>

      <article className="sellability-learning-card">
        <div className="sellability-learning-head">
          <div><span>SELLABILITY INVESTIGATOR · PERSISTENT LEARNING</span><h3>Locked-capital patterns are being filed and checked before future buys.</h3><p>Counts below come from the persistent Sellability case library, not from the visible trade-card limit.</p></div>
          <strong>{sellability?.casesFiled ?? 0}<small>cases filed</small></strong>
        </div>
        <div className="sellability-learning-grid">
          <div><small>Unsellable cases learned</small><b>{sellability?.casesFiled ?? 0}</b></div>
          <div><small>Chains represented</small><b>{sellability?.chainCoverage ?? 0}</b></div>
          <div><small>Locked loss studied</small><b>-${(sellability?.totalLockedLossUsd ?? 0).toFixed(2)}</b></div>
          <div><small>Unique learned blocks</small><b>{sellability?.learnedCandidatesBlocked ?? 0}</b></div>
        </div>
        <div className="sellability-learning-foot">
          <span>Latest filed: <b>{sellability?.latestCaseSymbol ? `$${sellability.latestCaseSymbol}` : "waiting"}</b>{sellability?.latestCaseAt ? ` · ${timeAgo(sellability.latestCaseAt)}` : ""}</span>
          <span>Latest learned block: <b>{sellability?.latestBlockSymbol ? `$${sellability.latestBlockSymbol}` : "none yet"}</b>{sellability?.latestBlockAt ? ` · ${timeAgo(sellability.latestBlockAt)}` : ""}</span>
        </div>
      </article>

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

      <article className="v224-fifty-training">
        <div className="v224-fifty-head">
          <div>
            <span>FILING CABINET · LIVE TRAINING SCOREBOARD</span>
            <h3>Winning with $50+ Trades</h3>
            <p>The Council chooses the opportunity. Every approved early-runner paper entry is at least $50. Stronger learned setups can size larger. Wins, losses and missed runners all stay in the cabinet so the bots can learn and adjust.</p>
          </div>
          <strong>$50+</strong>
        </div>
        <div className="v224-fifty-metrics">
          <div><small>Trades taken</small><b>{r?.fiftyDollarTrades ?? 0}</b></div>
          <div><small>Open now</small><b>{r?.fiftyDollarOpen ?? 0}</b></div>
          <div><small>Wins</small><b className="positive">{r?.fiftyDollarWins ?? 0}</b></div>
          <div><small>Losses</small><b className="negative">{r?.fiftyDollarLosses ?? 0}</b></div>
          <div><small>Win rate</small><b>{(r?.fiftyDollarWinRatePct ?? 0).toFixed(1)}%</b></div>
          <div><small>Net P/L</small><b className={(r?.fiftyDollarNetPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{(r?.fiftyDollarNetPnlUsd ?? 0) >= 0 ? "+" : "-"}${Math.abs(r?.fiftyDollarNetPnlUsd ?? 0).toFixed(2)}</b></div>
          <div><small>Avg return</small><b className={(r?.fiftyDollarAvgReturnPct ?? 0) >= 0 ? "positive" : "negative"}>{(r?.fiftyDollarAvgReturnPct ?? 0) >= 0 ? "+" : ""}{(r?.fiftyDollarAvgReturnPct ?? 0).toFixed(2)}%</b></div>
        </div>
        <div className="v224-fifty-table">
          <div className="v224-fifty-row head"><span>Coin</span><span>Case</span><span>Trade</span><span>P/L</span><span>Return</span></div>
          {(r?.recentFiftyDollarTrades ?? []).length ? r!.recentFiftyDollarTrades.map((row, index) => <div className="v224-fifty-row" key={`${row.chain}-${row.symbol}-${row.entryAt ?? index}`}>
            <b>${row.symbol}<small>{row.chain}</small></b>
            <span>{row.outcome}</span>
            <em className={`v224-${row.status.toLowerCase()}`}>{row.status}</em>
            <strong className={(row.pnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{row.status === "OPEN" ? "—" : `${(row.pnlUsd ?? 0) >= 0 ? "+" : "-"}$${Math.abs(row.pnlUsd ?? 0).toFixed(2)}`}</strong>
            <span>{row.status === "OPEN" || row.returnPct === undefined ? "—" : `${row.returnPct >= 0 ? "+" : ""}${row.returnPct.toFixed(1)}%`}</span>
          </div>) : <p className="v214-muted v224-empty">The first $50+ early-runner paper trades will appear here.</p>}
        </div>
      </article>

      <article className="v229-trajectory-observer">
        <div className="v229-observer-head">
          <div><span>TRAJECTORY OBSERVER · BACKGROUND ONLY · NO VOTE</span><h3>Study how runners develop — then teach the trading bots.</h3><p>The Observer never buys, sells, votes or vetoes. It follows BUY/WATCH/SKIP coins over time, learns runner/dumper sequences, and sends specialty-specific lessons back into each entity&apos;s private memory.</p></div>
          <strong>{r?.trajectoryObserver?.sequencesTracked ?? 0}<small>sequences</small></strong>
        </div>
        <div className="v229-observer-stats">
          <div><small>Tracked</small><b>{r?.trajectoryObserver?.sequencesTracked ?? 0}</b></div>
          <div><small>Labeled</small><b>{r?.trajectoryObserver?.labeledSequences ?? 0}</b></div>
          <div><small>Runner paths</small><b>{r?.trajectoryObserver?.runnerSequences ?? 0}</b></div>
          <div><small>Dumper paths</small><b>{r?.trajectoryObserver?.dumperSequences ?? 0}</b></div>
          <div><small>Chain models</small><b>{r?.trajectoryObserver?.chainModels ?? 0}</b></div>
          <div><small>Review cadence</small><b>~30s</b></div>
        </div>
        <div className="v229-observer-lessons">
          <b>LATEST TRAJECTORY LESSONS</b>
          {(r?.trajectoryObserver?.latestLessons ?? []).length ? (r?.trajectoryObserver?.latestLessons ?? []).map((row, index) => <div key={row.chain + "-" + row.symbol + "-" + index}><strong>{"$" + row.symbol}</strong><em>{row.outcome}</em><span>{row.message}</span></div>) : <p>Collecting multi-snapshot sequences now. The Observer waits for real development data before claiming a pattern.</p>}
        </div>
      </article>

      <article className="v225-genome-engines">
        <div className="v225-genome-title"><span>BACKGROUND LEARNING ENGINES</span><h3>Entry Genome + Exit Genome</h3><p>These do not replace the Council. They continuously mine the Filing Cabinet and feed learned runner/dumper setup patterns back into entries, sizing and Guardian exits.</p></div>
        <div className="v225-genome-grid">
          <div><b>ENTRY GENOME</b><strong>{r?.labeledCases ?? 0}</strong><small>runner/dumper cases learned</small><p>Scores every fresh candidate against previous runner and dumper fingerprints before the Council decides.</p></div>
          <div><b>EXIT GENOME</b><strong>{(r?.medianRunnerPeakMultiple ?? 0).toFixed(2)}×</strong><small>median observed runner peak</small><p>Studies continuation, distribution, typical drawdown and time-to-peak to adapt Guardian trailing/hold behavior.</p></div>
          <div><b>TYPICAL RUNNER PATH</b><strong>{Math.round(r?.medianRunnerTimeToPeakMinutes ?? 0)}m</strong><small>median time to observed peak</small><p>Typical learned runner drawdown: {(r?.medianRunnerDrawdownPct ?? 0).toFixed(1)}% before/through the move.</p></div>
        </div>
      </article>

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
          <div className="v214-box-title"><h3>What the bots are filing</h3><span>all 9 roles</span></div>
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
