"use client";

import { useEffect, useState } from "react";

type Kind = "main" | "rug" | "proof";
const CABINETS = [
  { kind: "main" as const, title: "MAIN FILE CABINET", description: "Accumulated trading knowledge, Council decisions, fills and position outcomes." },
  { kind: "rug" as const, title: "RUG FILE CABINET", description: "Rug, honeypot, unsellable-token and locked-capital intelligence." },
  { kind: "proof" as const, title: "PROOF OF WORK", description: "Independent paper-trade reconstruction, wallet reconciliation and runtime health." },
];

function money(value: unknown) {
  const number = Number(value ?? 0);
  return `${number < 0 ? "-" : ""}$${Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <span className={tone ? `cabinet-stat-${tone}` : undefined}><small>{label}</small><b>{value}</b></span>;
}

function MainCabinet({ data }: { data: any }) {
  const knowledge = data?.accumulatedKnowledge;
  return <>
    <div className="cabinet-stats">
      <Stat label="CASES STUDIED" value={knowledge?.casesStudied ?? 0} />
      <Stat label="CONFIRMED TELLS" value={knowledge?.confirmedTells ?? 0} />
      <Stat label="COUNCIL DECISIONS" value={data?.summary?.decisions ?? 0} />
      <Stat label="PAPER FILLS" value={data?.summary?.fills ?? 0} />
      <Stat label="POSITIONS" value={data?.summary?.positions ?? 0} />
    </div>
    <div className="cabinet-grid">
      <article><h3>Strongest runner tells</h3>{knowledge?.topRunnerTells?.length ? knowledge.topRunnerTells.map((line: string, index: number) => <p key={line}><b>{index + 1}</b>{line}</p>) : <p className="cabinet-empty">No confirmed runner tells yet.</p>}</article>
      <article><h3>Dumper contrasts</h3>{knowledge?.topDumpTells?.length ? knowledge.topDumpTells.map((line: string, index: number) => <p key={line}><b>{index + 1}</b>{line}</p>) : <p className="cabinet-empty">No confirmed dumper contrasts yet.</p>}</article>
      <article><h3>Recent bot filings</h3>{knowledge?.recentBotLessons?.length ? knowledge.recentBotLessons.slice(0, 10).map((row: any, index: number) => <p key={`${row.at}-${index}`}><b>{String(row.agentId).toUpperCase()}</b>{row.message}</p>) : <p className="cabinet-empty">No bot filings stored yet.</p>}</article>
    </div>
  </>;
}

function RugCabinet({ data }: { data: any }) {
  const learned = data?.learnedRugIntelligence;
  return <>
    <div className="cabinet-stats">
      <Stat label="RECORDED INCIDENTS" value={data?.summary?.incidents ?? 0} tone={(data?.summary?.incidents ?? 0) > 0 ? "bad" : undefined} />
      <Stat label="LOCKED CAPITAL LOSS" value={money(data?.summary?.lockedCapitalLossUsd)} tone={(data?.summary?.lockedCapitalLossUsd ?? 0) > 0 ? "bad" : undefined} />
      <Stat label="LEARNED RUG CASES" value={data?.summary?.learnedRugCases ?? 0} />
    </div>
    <div className="cabinet-grid cabinet-grid-two">
      <article><h3>Recent rug case files</h3>{learned?.recentRugCases?.length ? learned.recentRugCases.map((row: any) => <div className="cabinet-case" key={`${row.chain}-${row.symbol}-${row.recordedAt}`}><span><b>${row.symbol}</b><small>{row.chain} · {new Date(row.recordedAt).toLocaleString()}</small></span><p>{row.reason}</p></div>) : <p className="cabinet-empty">No confirmed rug fingerprints are stored yet.</p>}</article>
      <article><h3>Locked / unsellable positions</h3>{data?.incidents?.length ? data.incidents.map((row: any) => <div className="cabinet-case" key={row.id}><span><b>${row.symbol}</b><small>{row.chain} · {row.status}</small></span><p>{row.unsellableReason ?? row.lastReason ?? "Locked-capital incident"}</p><strong>{money(-(Number(row.lockedCapitalLossUsd ?? 0)))}</strong></div>) : <p className="cabinet-empty">No locked-capital incidents are stored.</p>}</article>
    </div>
  </>;
}

function ProofCabinet({ data }: { data: any }) {
  const p = data?.performance;
  const r = data?.reconciliation;
  const health = data?.operationalHealth;
  const recentTrades = data?.trades?.slice(0, 25) ?? [];
  return <>
    <div className="proof-health-row">
      <span className={`proof-health proof-health-${String(health?.state ?? "initializing").toLowerCase()}`}>{health?.state ?? "INITIALIZING"}</span>
      <p>Monitoring only. This layer cannot approve, reject, size, enter or exit a trade.</p>
    </div>
    <div className="cabinet-stats cabinet-stats-wide">
      <Stat label="REPORTED TRADES" value={p?.totalTradesReported ?? 0} />
      <Stat label="CONFIRMED" value={p?.confirmedTrades ?? 0} tone="good" />
      <Stat label="PARTIAL" value={p?.partiallyConfirmedTrades ?? 0} />
      <Stat label="UNCONFIRMED" value={p?.unconfirmedTrades ?? 0} />
      <Stat label="DISCREPANCIES" value={p?.discrepancies ?? 0} tone={(p?.discrepancies ?? 0) > 0 ? "bad" : "good"} />
      <Stat label="WALLET RECONCILIATION" value={r?.accountingVerified ? "VERIFIED" : "CHECK"} tone={r?.accountingVerified ? "good" : "bad"} />
    </div>
    <div className="cabinet-grid cabinet-grid-two">
      <article><h3>Reported vs independently reconstructed</h3><div className="proof-ledger">
        <span><small>Reported wins</small><b>{p?.reportedWins ?? 0}</b><small>Verified wins</small><strong>{p?.verifiedWins ?? 0}</strong></span>
        <span><small>Reported losses</small><b>{p?.reportedLosses ?? 0}</b><small>Verified losses</small><strong>{p?.verifiedLosses ?? 0}</strong></span>
        <span><small>Reported settled P/L</small><b>{money(p?.reportedSettledPnlUsd)}</b><small>Verified settled P/L</small><strong>{money(p?.independentlyVerifiedSettledPnlUsd)}</strong></span>
        <span><small>P/L depending on unresolved evidence</small><b>{money(p?.pnlDependentOnUnconfirmedEvidenceUsd)}</b><small>Equity delta</small><strong>{money(r?.equityDeltaUsd)}</strong></span>
      </div></article>
      <article><h3>Runtime heartbeat</h3><div className="proof-ledger">
        <span><small>Last scanner attempt</small><b>{health?.scanner?.lastCycleAttemptAt ? new Date(health.scanner.lastCycleAttemptAt).toLocaleString() : "WAITING"}</b><small>Last successful cycle</small><strong>{health?.scanner?.lastSuccessfulCycleAt ? new Date(health.scanner.lastSuccessfulCycleAt).toLocaleString() : "WAITING"}</strong></span>
        <span><small>Candidates reaching Council</small><b>{health?.scanner?.candidateCount ?? 0}</b><small>Council decisions</small><strong>{health?.scanner?.councilDecisionsCompleted ?? 0}</strong></span>
        <span><small>Entry attempts</small><b>{health?.scanner?.entriesAttempted ?? 0}</b><small>Completed entries</small><strong>{health?.scanner?.entriesCompleted ?? 0}</strong></span>
        <span><small>Guardian cycles</small><b>{health?.guardian?.cycles ?? 0}</b><small>Stuck operations</small><strong>{health?.stuckOrPendingOperations?.length ?? 0}</strong></span>
      </div></article>
    </div>
    <article className="proof-table-wrap"><h3>Trade verification ledger</h3><div className="proof-table"><div className="proof-table-head"><span>State</span><span>Token</span><span>Status</span><span>Reported P/L</span><span>Reconstructed P/L</span><span>Delta</span></div>{recentTrades.length ? recentTrades.map((trade: any) => <div key={trade.tradeId}><strong className={`proof-state proof-state-${String(trade.verificationState).toLowerCase()}`}>{trade.verificationState}</strong><span>${trade.token.symbol}<small>{trade.token.chain}</small></span><span>{trade.status}</span><span>{money(trade.exit.claimedRealizedPnlUsd)}</span><span>{money(trade.exit.independentlyReconstructedRealizedPnlUsd)}</span><span>{money(trade.exit.realizedPnlDeltaUsd)}</span></div>) : <p className="cabinet-empty">No persisted trades are available to verify yet.</p>}</div></article>
    <details className="proof-limitations"><summary>Verification limits</summary>{(data?.limitations ?? []).map((line: string) => <p key={line}>{line}</p>)}</details>
  </>;
}

export default function Cabinets() {
  const [kind, setKind] = useState<Kind>("proof");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/cabinets/${kind}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Cabinet failed");
        if (active) { setData(payload); setError(""); setLoading(false); }
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
      }
    };
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(), kind === "proof" ? 5_000 : 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [kind]);
  const selected = CABINETS.find((cabinet) => cabinet.kind === kind)!;
  return <main className="cabinet-workspace">
    <header className="cabinet-header"><div><small>BOT WAR ROOM · READ-ONLY EVIDENCE</small><h1>FILE CABINETS</h1><p>Downloadable records for independent analysis. No controls here can modify trading.</p></div><a href="/">← BACK TO WAR ROOM</a></header>
    <nav className="cabinet-tabs" aria-label="File cabinets">{CABINETS.map((cabinet) => <button type="button" key={cabinet.kind} className={kind === cabinet.kind ? "active" : ""} onClick={() => setKind(cabinet.kind)}>{cabinet.title}</button>)}</nav>
    <section className="cabinet-panel"><div className="cabinet-panel-head"><div><h2>{selected.title}</h2><p>{selected.description}</p><small>{data?.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleString()}` : "Waiting for current evidence"}</small></div><a className="cabinet-download" href={`/api/cabinets/${kind}?download=1`}>↓ DOWNLOAD DATA</a></div>
      {loading && !data && <p className="cabinet-empty">Loading persisted evidence…</p>}
      {error && <p className="cabinet-error">{error}</p>}
      {data && kind === "main" && <MainCabinet data={data} />}
      {data && kind === "rug" && <RugCabinet data={data} />}
      {data && kind === "proof" && <ProofCabinet data={data} />}
    </section>
  </main>;
}
