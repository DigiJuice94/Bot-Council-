"use client";

import { useEffect, useMemo, useState } from "react";
import { TOURNAMENT_ROLES, type TournamentRole, type TournamentView } from "@/lib/tournament-types";

const ROLE_LABELS: Record<TournamentRole, string> = {
  launch: "Early Runner Scout", social: "Narrative Scout", wallet: "Flow Analyst", quant: "Pattern Quant",
  contract: "Safety Gate", bear: "Dumper Specialist", portfolio: "Portfolio Strategist", cio: "Runner CIO",
};

function money(value: number, signed = false) {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value) >= 100_000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value.toFixed(2)}`;
}
export default function TournamentPanel() {
  const [view, setView] = useState<TournamentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tournament", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Tournament status failed (${response.status})`);
        if (active) { setView(payload); setError(null); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void load();
    const poll = window.setInterval(() => void load(), 5_000);
    const clock = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(clock); };
  }, []);

  const roleLeaders = useMemo(() => {
    if (!view) return [];
    return TOURNAMENT_ROLES.map((role) => {
      const ordered = [...view.teams].sort((a, b) => (b.rolePerformance[role].totalAttributedPnlUsd ?? b.rolePerformance[role].attributedPnlUsd) - (a.rolePerformance[role].totalAttributedPnlUsd ?? a.rolePerformance[role].attributedPnlUsd));
      return { role, team: ordered[0], row: ordered[0]?.rolePerformance[role] };
    });
  }, [view]);

  const wallet = view?.teams[0];
  const activePositions = wallet?.positions.filter((position) => position.status === "open") ?? [];
  return <section id="wallet" className="tournament-panel page-panel">
    <div className="tournament-head">
      <div><small>V3.6.2 TOURNAMENT.13 · EXACT WINNER</small><h2>Team File Cabinet Main Wallet</h2><p>The original winning eight-member council now runs alone inside its exact tournament wallet, entry, sizing, fee, exit and mark-refresh environment. Regular trades recycle after 20 minutes or sooner when buying pressure fades; true moon bags close after 48 hours.</p></div>
      <div className="tournament-clock"><span>{view?.roundLabel ?? "Loading exact environment"}</span><b>{wallet ? money(wallet.equityUsd) : "$1,000.00"}</b><small>{view?.opportunityCount ?? 0} opportunities evaluated</small></div>
    </div>
    {error && <p className="tournament-error">{error}</p>}
    <div className="tournament-rankings">
      <div className="tournament-row tournament-row-head"><span>Council</span><span>Cash</span><span>Equity</span><span>Realized</span><span>Unrealized</span><span>Total P/L</span><span>Active</span><span>Trades</span><span>Return</span></div>
      {view?.teams.map((team) => <article className={`tournament-row ${team.rank <= 3 ? "podium" : ""}`} key={team.id}>
        <span className="tournament-team"><i>10</i><span><b>{team.name}</b><small>{team.accountingVerified ? "✓ ACCOUNTING VERIFIED" : `⚠ ACCOUNTING DELTA ${money(team.accountingDeltaUsd, true)}`} · {team.lastRejectionReason ? `Latest pass: ${team.lastRejectionReason}` : `${team.councilRuns} Council runs`}</small></span></span>
        <strong>{money(team.cashUsd)}</strong>
        <strong>{money(team.equityUsd)}</strong>
        <strong className={team.realizedPnlUsd >= 0 ? "positive" : "negative"}>{money(team.realizedPnlUsd, true)}</strong>
        <strong className={team.unrealizedPnlUsd >= 0 ? "positive" : "negative"}>{money(team.unrealizedPnlUsd, true)}</strong>
        <strong className={team.totalPnlUsd >= 0 ? "positive" : "negative"}>{money(team.totalPnlUsd, true)}</strong>
        <strong>{team.activeTrades}</strong><strong>{team.totalTrades}</strong>
        <strong className={team.returnPct >= 0 ? "positive" : "negative"}>{team.returnPct >= 0 ? "+" : ""}{team.returnPct.toFixed(2)}%</strong>
      </article>)}
    </div>
    <div className="tournament-subgrid">
      <article><h3>Eight independent members</h3><p>Performance is attributed from settled trades using the original Tournament.13 scoring model.</p><div className="role-leader-list">
        {roleLeaders.map(({ role, team, row }) => { const value = row?.totalAttributedPnlUsd ?? row?.attributedPnlUsd ?? 0; return <div key={role}><span><b>{ROLE_LABELS[role]}</b><small>{team?.name ?? "Waiting"}</small></span><strong className={value >= 0 ? "positive" : "negative"}>{money(value, true)}</strong></div>; })}
      </div></article>
      <article><h3>Team File Cabinet evidence</h3><p>Stored research is advisory—not law. It can make a small controlled adjustment but cannot override global safety.</p><ul>{view?.fileCabinetEvidence.length ? view.fileCabinetEvidence.map((line) => <li key={line}>{line}</li>) : <li>Waiting for a learned Runner Genome match.</li>}</ul></article>
    </div>
    <div className="role-matrix"><h3>Every independent member · live score + performance</h3><div>{view?.teams.map((team) => <article key={team.id}><b>{team.name}</b>{TOURNAMENT_ROLES.map((role) => { const row = team.rolePerformance[role]; const openDecision = [...team.positions].reverse().find((position) => position.status === "open")?.memberOpinions?.find((opinion) => opinion.role === role); const decision = team.lastCouncil?.members[role] ?? openDecision; const pnl = row.totalAttributedPnlUsd ?? row.attributedPnlUsd; return <span key={role}><small>{ROLE_LABELS[role]}</small><strong className={pnl >= 0 ? "positive" : "negative"}>{decision ? `${decision.vote} ${decision.score}` : "WAITING"}</strong><em>{money(pnl, true)} · {row.trades} trades ({row.activeTrades ?? 0} live) · {row.wins}W/{row.losses}L · {decision ? `${decision.confidence}%` : "no vote"}</em></span>; })}</article>)}</div></div>
    <div className="champion-ledger"><h3>Active positions</h3><p>These are the exact positions currently owned by the promoted tournament wallet.</p><div className="champion-table"><div className="champion-table-head"><span>Token</span><span>Entry</span><span>Mark</span><span>Remaining</span><span>Value</span><span>Status</span></div>{activePositions.length ? activePositions.map((position) => <div key={position.id}><strong>${position.symbol}</strong><span>{money(position.entryPrice)}</span><span>{money(position.markPrice)}</span><span>{position.remainingQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>{money(position.remainingQuantity * position.markPrice)}</span><span>OPEN</span></div>) : <p className="champion-empty">No active positions.</p>}</div></div>
    <div className="champion-ledger"><h3>Verified trade ledger</h3><p>Every buy, trim, sale and locked-capital event from this wallet.</p><div className="champion-table"><div className="champion-table-head"><span>Time</span><span>Action</span><span>Token</span><span>Quantity</span><span>Price</span><span>P/L</span></div>{wallet?.trades.length ? wallet.trades.map((trade) => <div key={trade.id}><span>{new Date(trade.at).toLocaleString()}</span><strong>{trade.action}</strong><span>${trade.symbol}</span><span>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span><span>{money(trade.price)}</span><span className={trade.pnlUsd >= 0 ? "positive" : "negative"}>{money(trade.pnlUsd, true)}</span></div>) : <p className="champion-empty">Waiting for the first verified fill.</p>}</div></div>
  </section>;
}
