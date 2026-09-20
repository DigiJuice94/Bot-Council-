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
function remaining(end?: string) {
  if (!end) return "Complete";
  const ms = Math.max(0, new Date(end).getTime() - Date.now());
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${hours}h ${minutes}m ${seconds}s`;
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

  const end = view?.phase === "qualifier" ? view.qualifierEndsAt : view?.finalEndsAt;
  return <section id="tournament" className="tournament-panel page-panel">
    <div className="tournament-head">
      <div><small>V3.6.2 LOCKED BASELINE · 80 INDEPENDENT MEMBERS</small><h2>10-Council Tournament</h2><p>Each council has its own eight decisions, memory stream and $1,000 wallet. Regular trades recycle after 20 minutes or earlier when live buying pressure fades; true moon bags have a 48-hour maximum. Global liquidity and sellability gates protect all ten.</p></div>
      <div className="tournament-clock"><span>{view?.roundLabel ?? "Loading tournament"}</span><b>{remaining(end)}</b><small>{view?.opportunityCount ?? 0} shared opportunities</small></div>
    </div>
    {error && <p className="tournament-error">{error}</p>}
    {view?.status === "failed" && <div className="tournament-verdict failed"><b>EXPERIMENT FAILED</b><span>{view.failureReason}</span></div>}
    {view?.status === "winner" && <div className="tournament-verdict winner"><b>FINAL COUNCIL SELECTED</b><span>{view.teams.find((team) => team.id === view.winnerTeamId)?.name}</span></div>}
    <div className="tournament-rankings">
      <div className="tournament-row tournament-row-head"><span>Rank / Team</span><span>Cash</span><span>Equity</span><span>Realized</span><span>Unrealized</span><span>Total P/L</span><span>Active</span><span>Trades</span><span>Return</span></div>
      {view?.teams.map((team) => <article className={`tournament-row ${team.rank <= 3 ? "podium" : ""}`} key={team.id}>
        <span className="tournament-team"><i>{team.rank}</i><span><b>{team.name}</b><small>{team.accountingVerified ? "✓ ACCOUNTING VERIFIED" : `⚠ ACCOUNTING DELTA ${money(team.accountingDeltaUsd, true)}`} · {team.lastRejectionReason ? `Latest pass: ${team.lastRejectionReason}` : `${team.councilRuns} Council runs`}</small></span></span>
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
      <article><h3>Individual role leaders</h3><p>Performance is attributed from settled trades; each role is drafted independently after the qualifier.</p><div className="role-leader-list">
        {roleLeaders.map(({ role, team, row }) => { const value = row?.totalAttributedPnlUsd ?? row?.attributedPnlUsd ?? 0; return <div key={role}><span><b>{ROLE_LABELS[role]}</b><small>{team?.name ?? "Waiting"}</small></span><strong className={value >= 0 ? "positive" : "negative"}>{money(value, true)}</strong></div>; })}
      </div></article>
      <article><h3>Team File Cabinet evidence</h3><p>Stored research is advisory—not law. It can make a small controlled adjustment but cannot override global safety.</p><ul>{view?.fileCabinetEvidence.length ? view.fileCabinetEvidence.map((line) => <li key={line}>{line}</li>) : <li>Waiting for a learned Runner Genome match.</li>}</ul></article>
    </div>
    <div className="role-matrix"><h3>Every independent member · live score + performance</h3><div>{view?.teams.map((team) => <article key={team.id}><b>#{team.rank} {team.name}</b>{TOURNAMENT_ROLES.map((role) => { const row = team.rolePerformance[role]; const openDecision = [...team.positions].reverse().find((position) => position.status === "open")?.memberOpinions?.find((opinion) => opinion.role === role); const decision = team.lastCouncil?.members[role] ?? openDecision; const pnl = row.totalAttributedPnlUsd ?? row.attributedPnlUsd; return <span key={role}><small>{ROLE_LABELS[role]}</small><strong className={pnl >= 0 ? "positive" : "negative"}>{decision ? `${decision.vote} ${decision.score}` : "WAITING"}</strong><em>{money(pnl, true)} · {row.trades} trades ({row.activeTrades ?? 0} live) · {row.wins}W/{row.losses}L · {decision ? `${decision.confidence}%` : "no vote"}</em></span>; })}</article>)}</div></div>
    {view && view.phase !== "qualifier" && view.teams.some((team) => team.draftSources) && <div className="draft-board"><h3>Final council role draft</h3>{view.teams.map((team) => <article key={team.id}><b>{team.name}</b><div>{TOURNAMENT_ROLES.map((role) => <span key={role}><small>{ROLE_LABELS[role]}</small>{team.draftSources?.[role]?.teamName ?? "—"}</span>)}</div></article>)}</div>}
  </section>;
}
