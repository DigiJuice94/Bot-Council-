import { fetchLiveTokenSnapshot } from "./provider-waterfall";
import { acquireRuntimeLease } from "./position-store";
import { loadTournamentState, saveTournamentState } from "./tournament-store";
import { TOURNAMENT_ROLES, type TournamentPosition, type TournamentRole, type TournamentState, type TournamentTeam, type TournamentTeamView, type TournamentView } from "./tournament-types";
import type { MarketSnapshot, WarRoomResult } from "./types";

const STARTING_CASH_USD = 1_000;
const QUALIFIER_MS = Math.max(60_000, Number(process.env.TOURNAMENT_QUALIFIER_HOURS ?? 24) * 3_600_000);
const FINAL_MS = Math.max(60_000, Number(process.env.TOURNAMENT_FINAL_HOURS ?? 24) * 3_600_000);
const MAX_OPEN_POSITIONS = Math.max(1, Number(process.env.TOURNAMENT_MAX_OPEN_POSITIONS ?? 12));
const MAX_TRADE_ROWS = 300;
const MAX_PROCESSED_IDS = 1_200;
const FEE_RATE = Math.max(0, Number(process.env.TOURNAMENT_PAPER_FEE_BPS ?? 25)) / 10_000;
const TP_LEVELS = [{ pct: 25, portion: 0.20 }, { pct: 50, portion: 0.20 }, { pct: 100, portion: 0.25 }, { pct: 200, portion: 0.25 }];

type Variant = Pick<TournamentTeam, "id" | "name" | "description" | "roleBias" | "thresholdDelta" | "sizeMultiplier" | "fileCabinet">;
const VARIANTS: Variant[] = [
  { id: "team-1", name: "Team 1 · Baseline", description: "Exact V3.6.2 BUY decisions; no tournament bias.", roleBias: {}, thresholdDelta: 0, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-2", name: "Team 2 · Launch +2", description: "Small Early Runner Scout emphasis.", roleBias: { launch: 2 }, thresholdDelta: -1, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-3", name: "Team 3 · Narrative +2", description: "Small Narrative Ignition Scout emphasis.", roleBias: { social: 2 }, thresholdDelta: -1, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-4", name: "Team 4 · Flow +2", description: "Small Early Flow Analyst emphasis.", roleBias: { wallet: 2 }, thresholdDelta: -1, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-5", name: "Team 5 · Quant +2", description: "Small Runner Pattern Quant emphasis.", roleBias: { quant: 2 }, thresholdDelta: -1, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-6", name: "Team 6 · Safety +2", description: "Slightly stricter Fast Safety Gate weighting.", roleBias: { contract: 2 }, thresholdDelta: 1, sizeMultiplier: 0.95, fileCabinet: false },
  { id: "team-7", name: "Team 7 · Bear +2", description: "Slightly stronger Dumper Specialist defense.", roleBias: { bear: 2 }, thresholdDelta: 1, sizeMultiplier: 0.95, fileCabinet: false },
  { id: "team-8", name: "Team 8 · Portfolio +2", description: "Small Portfolio Strategist sizing emphasis.", roleBias: { portfolio: 2 }, thresholdDelta: 0, sizeMultiplier: 1.05, fileCabinet: false },
  { id: "team-9", name: "Team 9 · CIO +2", description: "Small Runner CIO conviction emphasis.", roleBias: { cio: 2 }, thresholdDelta: -1, sizeMultiplier: 1, fileCabinet: false },
  { id: "team-10", name: "Team File Cabinet", description: "Uses stored Runner Genome, trajectory, winner/dumper and missed-runner evidence as advisory input.", roleBias: {}, thresholdDelta: 0, sizeMultiplier: 1, fileCabinet: true },
];

const tournamentGlobal = globalThis as typeof globalThis & {
  __botWarRoomTournamentTimerV1?: ReturnType<typeof setInterval>;
  __botWarRoomTournamentRefreshCursorV1?: number;
};

function iso(ms = Date.now()) { return new Date(ms).toISOString(); }
function roundUsd(value: number) { return Number(value.toFixed(6)); }
function emptyRoles(): TournamentTeam["rolePerformance"] {
  return Object.fromEntries(TOURNAMENT_ROLES.map((role) => [role, { role, trades: 0, wins: 0, losses: 0, attributedPnlUsd: 0 }])) as TournamentTeam["rolePerformance"];
}
function newTeam(variant: Variant): TournamentTeam {
  return { ...variant, startingCashUsd: STARTING_CASH_USD, cashUsd: STARTING_CASH_USD, realizedPnlUsd: 0, lockedCapitalLossUsd: 0, totalTrades: 0, positions: [], trades: [], rolePerformance: emptyRoles() };
}
function initialState(now = Date.now()): TournamentState {
  return { version: 1, phase: "qualifier", status: "running", createdAt: iso(now), qualifierStartedAt: iso(now), qualifierEndsAt: iso(now + QUALIFIER_MS), opportunityCount: 0, processedOpportunityIds: [], teams: VARIANTS.map(newTeam), fileCabinetEvidence: [] };
}
async function ensureState() {
  const current = await loadTournamentState();
  if (current) return current;
  const created = initialState();
  await saveTournamentState(created);
  return created;
}

function roleScores(result: WarRoomResult): Record<TournamentRole, number> {
  const byId = new Map(result.agents.map((agent) => [agent.id, agent.score]));
  return Object.fromEntries(TOURNAMENT_ROLES.map((role) => [role, Number(byId.get(role) ?? (role === "cio" ? result.conviction : 50))])) as Record<TournamentRole, number>;
}
function immediateSafetyFailure(snapshot: MarketSnapshot) {
  if (snapshot.liquidity <= 0) return "Confirmed zero executable liquidity";
  if (snapshot.honeypot) return "Confirmed honeypot";
  if (snapshot.chainFamily === "solana" && snapshot.freezeAuthority) return "Confirmed freeze authority";
  return null;
}
function hasPositiveSellabilityFailure(snapshot: MarketSnapshot) {
  return snapshot.sellable === false && snapshot.dataProvenance?.quality.sellability === true;
}
function equity(team: TournamentTeam) {
  return team.cashUsd + team.positions.filter((position) => position.status === "open").reduce((sum, position) => sum + position.remainingQuantity * position.markPrice, 0);
}
function openCost(team: TournamentTeam) {
  return team.positions.filter((position) => position.status === "open").reduce((sum, position) => sum + position.remainingCostUsd, 0);
}
function addTrade(team: TournamentTeam, row: TournamentTeam["trades"][number]) {
  team.trades = [row, ...team.trades].slice(0, MAX_TRADE_ROWS);
}
function eligible(team: TournamentTeam, result: WarRoomResult, scores: Record<TournamentRole, number>) {
  // Tournament wallets own their cash and capacity. Never inherit the sidelined
  // main wallet's execution.allowed/request, because those are calculated from
  // the main wallet's cash. Shared market risk and Executor safety still apply.
  if (!result.risk.passed || result.councilProcess.executorVote === "BLOCK" || team.cashUsd < 25) return false;
  if (team.id === "team-1") return result.decision === "BUY";
  let adjusted = result.conviction;
  for (const role of TOURNAMENT_ROLES) adjusted += ((scores[role] - 50) / 50) * (team.roleBias[role] ?? 0);
  if (team.fileCabinet) {
    const genome = result.runnerGenome;
    if (!genome.learned) return result.decision === "BUY";
    adjusted += (genome.entryScore - 60) * 0.08 - Math.max(0, genome.dumperRiskScore - 65) * 0.10 + (genome.trajectoryScore - 50) * 0.04;
  }
  if (result.decision === "BUY") return adjusted >= 50 + team.thresholdDelta;
  return result.decision === "WATCH" && adjusted >= 58 + team.thresholdDelta;
}
function positionExists(team: TournamentTeam, snapshot: MarketSnapshot) {
  return team.positions.some((position) => position.status === "open" && position.chain === snapshot.chain && position.tokenAddress === snapshot.tokenAddress);
}
function settleRoles(team: TournamentTeam, position: TournamentPosition) {
  if (position.rolesSettled) return;
  const total = TOURNAMENT_ROLES.reduce((sum, role) => sum + Math.max(1, position.roleScores[role]), 0);
  for (const role of TOURNAMENT_ROLES) {
    const row = team.rolePerformance[role];
    row.trades += 1;
    row.wins += position.realizedPnlUsd > 0 ? 1 : 0;
    row.losses += position.realizedPnlUsd <= 0 ? 1 : 0;
    row.attributedPnlUsd = roundUsd(row.attributedPnlUsd + position.realizedPnlUsd * (Math.max(1, position.roleScores[role]) / total) * TOURNAMENT_ROLES.length);
  }
  position.rolesSettled = true;
}
function sell(team: TournamentTeam, position: TournamentPosition, quantity: number, price: number, action: "TRIM" | "SELL", note: string, at: string) {
  const actualQty = Math.min(position.remainingQuantity, Math.max(0, quantity));
  if (actualQty <= 0 || price <= 0) return;
  const cost = position.remainingQuantity > 0 ? position.remainingCostUsd * (actualQty / position.remainingQuantity) : 0;
  const gross = actualQty * price;
  const proceeds = gross * (1 - FEE_RATE);
  const pnl = proceeds - cost;
  position.remainingQuantity = roundUsd(position.remainingQuantity - actualQty);
  position.remainingCostUsd = roundUsd(Math.max(0, position.remainingCostUsd - cost));
  position.realizedPnlUsd = roundUsd(position.realizedPnlUsd + pnl);
  team.cashUsd = roundUsd(team.cashUsd + proceeds);
  team.realizedPnlUsd = roundUsd(team.realizedPnlUsd + pnl);
  addTrade(team, { id: `${position.id}-${action}-${at}-${position.takenTargets.length}`, at, symbol: position.symbol, chain: position.chain, action, quantity: actualQty, price, valueUsd: proceeds, pnlUsd: pnl, note });
  if (position.remainingQuantity <= Math.max(1e-12, position.initialQuantity * 0.000001) || action === "SELL") {
    position.remainingQuantity = 0;
    position.remainingCostUsd = 0;
    position.status = "closed";
    position.closedAt = at;
    settleRoles(team, position);
  }
}
function lockPosition(team: TournamentTeam, position: TournamentPosition, reason: string, at: string) {
  if (position.status !== "open") return;
  const loss = position.remainingCostUsd;
  position.realizedPnlUsd = roundUsd(position.realizedPnlUsd - loss);
  team.realizedPnlUsd = roundUsd(team.realizedPnlUsd - loss);
  team.lockedCapitalLossUsd = roundUsd(team.lockedCapitalLossUsd + loss);
  addTrade(team, { id: `${position.id}-LOCKED-${at}`, at, symbol: position.symbol, chain: position.chain, action: "LOCKED", quantity: position.remainingQuantity, price: 0, valueUsd: 0, pnlUsd: -loss, note: reason });
  position.markPrice = 0;
  position.remainingCostUsd = 0;
  position.status = "unsellable";
  position.closedAt = at;
  position.lockedReason = reason;
  settleRoles(team, position);
}
function applyMark(team: TournamentTeam, position: TournamentPosition, snapshot: MarketSnapshot, at: string) {
  if (position.status !== "open") return;
  const unsafe = immediateSafetyFailure(snapshot);
  if (unsafe) return lockPosition(team, position, unsafe, at);
  if (hasPositiveSellabilityFailure(snapshot)) {
    position.sellabilityFailureCount = (position.sellabilityFailureCount ?? 0) + 1;
    if (position.sellabilityFailureCount >= 2) return lockPosition(team, position, "Sellability audit confirmed locked capital twice", at);
  } else {
    position.sellabilityFailureCount = 0;
  }
  if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) return;
  position.markPrice = snapshot.price;
  position.highWaterPrice = Math.max(position.highWaterPrice, snapshot.price);
  const pnlPct = (snapshot.price / Math.max(position.entryPrice, 1e-12) - 1) * 100;
  for (let index = 0; index < TP_LEVELS.length; index += 1) {
    const target = TP_LEVELS[index];
    if (pnlPct >= target.pct && !position.takenTargets.includes(index)) {
      position.takenTargets.push(index);
      sell(team, position, position.initialQuantity * target.portion, snapshot.price, "TRIM", `Shared +${target.pct}% tournament take-profit`, at);
      if (position.status !== "open") return;
    }
  }
  const drawdownPct = position.highWaterPrice > 0 ? (1 - snapshot.price / position.highWaterPrice) * 100 : 0;
  const ageMinutes = (new Date(at).getTime() - new Date(position.openedAt).getTime()) / 60_000;
  if (pnlPct <= -position.stopLossPct) sell(team, position, position.remainingQuantity, snapshot.price, "SELL", "Shared stop-loss", at);
  else if (pnlPct >= 25 && drawdownPct >= position.trailingStopPct) sell(team, position, position.remainingQuantity, snapshot.price, "SELL", "Shared trailing stop", at);
  else if (ageMinutes >= position.maxHoldMinutes) sell(team, position, position.remainingQuantity, snapshot.price, "SELL", "Shared maximum hold time", at);
}
function enter(team: TournamentTeam, result: WarRoomResult, scores: Record<TournamentRole, number>, at: string) {
  const snapshot = result.snapshot;
  if (positionExists(team, snapshot) || team.positions.filter((position) => position.status === "open").length >= MAX_OPEN_POSITIONS) return;
  const planned = result.execution.request?.notionalUsd ?? result.runnerGenome.suggestedTradeUsd ?? 50;
  const fileCabinetSize = team.fileCabinet && result.runnerGenome.learned ? result.runnerGenome.suggestedTradeUsd : planned;
  const notional = Math.min(team.cashUsd, 125, Math.max(25, fileCabinetSize * team.sizeMultiplier));
  if (notional < 25 || snapshot.price <= 0) return;
  const fee = notional * FEE_RATE;
  const spend = notional;
  const quantity = (notional - fee) / snapshot.price;
  team.cashUsd = roundUsd(team.cashUsd - spend);
  team.totalTrades += 1;
  const position: TournamentPosition = {
    id: `${team.id}-${result.decisionId}`,
    chain: snapshot.chain, tokenAddress: snapshot.tokenAddress, symbol: snapshot.symbol,
    entryPrice: snapshot.price, markPrice: snapshot.price, highWaterPrice: snapshot.price,
    initialQuantity: quantity, remainingQuantity: quantity, entryNotionalUsd: spend, remainingCostUsd: spend,
    realizedPnlUsd: 0, openedAt: at, status: "open", takenTargets: [],
    stopLossPct: Math.max(1, result.exitStrategy.stopLossPct), trailingStopPct: Math.max(1, result.exitStrategy.trailingStopPct),
    maxHoldMinutes: Math.max(5, result.exitStrategy.maxHoldMinutes), roleScores: scores,
  };
  team.positions.push(position);
  addTrade(team, { id: `${position.id}-BUY`, at, symbol: snapshot.symbol, chain: snapshot.chain, action: "BUY", quantity, price: snapshot.price, valueUsd: spend, pnlUsd: -fee, note: team.fileCabinet ? "File Cabinet advisory entry" : "Controlled tournament entry" });
}

function liquidateRound(team: TournamentTeam, at: string) {
  for (const position of team.positions) if (position.status === "open") sell(team, position, position.remainingQuantity, position.markPrice, "SELL", "Round-end mark liquidation", at);
}
function teamView(team: TournamentTeam): TournamentTeamView {
  const openValueUsd = team.positions.filter((position) => position.status === "open").reduce((sum, position) => sum + position.remainingQuantity * position.markPrice, 0);
  const equityUsd = team.cashUsd + openValueUsd;
  const unrealizedPnlUsd = openValueUsd - openCost(team);
  return { ...team, rank: 0, openValueUsd: roundUsd(openValueUsd), equityUsd: roundUsd(equityUsd), unrealizedPnlUsd: roundUsd(unrealizedPnlUsd), activeTrades: team.positions.filter((position) => position.status === "open").length, returnPct: roundUsd((equityUsd / team.startingCashUsd - 1) * 100) };
}
function ranked(teams: TournamentTeam[]) {
  return teams.map(teamView).sort((a, b) => b.equityUsd - a.equityUsd || b.realizedPnlUsd - a.realizedPnlUsd).map((team, index) => ({ ...team, rank: index + 1 }));
}
function draftFinalists(qualifiers: TournamentTeam[], at: string) {
  return [1, 2, 3].map((rank) => {
    const roleBias: Partial<Record<TournamentRole, number>> = {};
    const draftSources: NonNullable<TournamentTeam["draftSources"]> = {};
    const rolePerformance = emptyRoles();
    let thresholdDelta = 0;
    let sizeMultiplier = 0;
    for (const role of TOURNAMENT_ROLES) {
      const ordered = [...qualifiers].sort((a, b) => b.rolePerformance[role].attributedPnlUsd - a.rolePerformance[role].attributedPnlUsd || b.rolePerformance[role].wins - a.rolePerformance[role].wins);
      const source = ordered[Math.min(rank - 1, ordered.length - 1)];
      roleBias[role] = source.roleBias[role] ?? 0;
      thresholdDelta += source.thresholdDelta / TOURNAMENT_ROLES.length;
      sizeMultiplier += source.sizeMultiplier / TOURNAMENT_ROLES.length;
      draftSources[role] = { teamId: source.id, teamName: source.name, rank };
      rolePerformance[role].sourceTeamId = source.id;
      rolePerformance[role].sourceTeamName = source.name;
    }
    return { id: `final-${rank}`, name: `Final Team ${rank}`, description: `${rank === 1 ? "Best" : rank === 2 ? "Second-best" : "Third-best"} qualifier performer drafted independently for every role.`, startingCashUsd: STARTING_CASH_USD, cashUsd: STARTING_CASH_USD, realizedPnlUsd: 0, lockedCapitalLossUsd: 0, totalTrades: 0, positions: [], trades: [], rolePerformance, roleBias, thresholdDelta, sizeMultiplier, fileCabinet: Object.values(draftSources).some((source) => source.teamId === "team-10"), draftSources } satisfies TournamentTeam;
  });
}
function advanceIfDue(state: TournamentState, now = Date.now()) {
  if (state.phase === "qualifier" && now >= new Date(state.qualifierEndsAt).getTime()) {
    const at = iso(now);
    for (const team of state.teams) liquidateRound(team, at);
    state.qualifierArchive = state.teams;
    state.teams = draftFinalists(state.qualifierArchive, at);
    state.phase = "final";
    state.finalStartedAt = at;
    state.finalEndsAt = iso(now + FINAL_MS);
  }
  if (state.phase === "final" && state.finalEndsAt && now >= new Date(state.finalEndsAt).getTime()) {
    const at = iso(now);
    for (const team of state.teams) liquidateRound(team, at);
    const ordered = ranked(state.teams);
    state.phase = "complete";
    state.completedAt = at;
    if (ordered.every((team) => team.equityUsd < STARTING_CASH_USD)) {
      state.status = "failed";
      state.failureReason = "All three final councils finished below their $1,000 starting wallet.";
    } else {
      state.status = "winner";
      state.winnerTeamId = ordered[0]?.id;
    }
  }
}

export async function observeTournamentOpportunity(result: WarRoomResult): Promise<boolean> {
  const unsafe = immediateSafetyFailure(result.snapshot) || hasPositiveSellabilityFailure(result.snapshot);
  const release = await acquireRuntimeLease("tournament-state", 45_000);
  if (!release) return (await ensureState()).phase !== "complete";
  try {
    const state = await ensureState();
    advanceIfDue(state);
    if (state.phase === "complete") return false;
    if (state.processedOpportunityIds.includes(result.decisionId)) return true;
    state.processedOpportunityIds = [...state.processedOpportunityIds.slice(-(MAX_PROCESSED_IDS - 1)), result.decisionId];
    state.opportunityCount += 1;
    state.lastOpportunityAt = iso();
    const scores = roleScores(result);
    for (const team of state.teams) {
      const existing = team.positions.find((position) => position.status === "open" && position.chain === result.snapshot.chain && position.tokenAddress === result.snapshot.tokenAddress);
      if (existing) applyMark(team, existing, result.snapshot, state.lastOpportunityAt);
      if (!unsafe && eligible(team, result, scores)) enter(team, result, scores, state.lastOpportunityAt);
    }
    if (result.runnerGenome.learned) state.fileCabinetEvidence = [...result.runnerGenome.runnerEvidence.slice(0, 3), ...result.runnerGenome.dumperEvidence.slice(0, 2)].slice(0, 5);
    await saveTournamentState(state);
    return true;
  } finally {
    await release().catch(() => undefined);
  }
}

export async function isTournamentActive() {
  return (await ensureState()).phase !== "complete";
}

export async function refreshTournamentMarks(limit = 4) {
  // Fetch prices without holding the state lock. Provider latency can otherwise
  // collide with a new candidate and make the whole tournament miss it.
  const preview = await ensureState();
  if (preview.phase === "complete") return;
  const unique = new Map<string, TournamentPosition>();
  for (const team of preview.teams) for (const position of team.positions) if (position.status === "open") unique.set(`${position.chain}:${position.tokenAddress}`, position);
  const rows = [...unique.values()];
  if (!rows.length) return;
  const cursor = tournamentGlobal.__botWarRoomTournamentRefreshCursorV1 ?? 0;
  const selected = Array.from({ length: Math.min(limit, rows.length) }, (_, index) => rows[(cursor + index) % rows.length]);
  tournamentGlobal.__botWarRoomTournamentRefreshCursorV1 = (cursor + selected.length) % rows.length;
  const snapshots = await Promise.all(selected.map((position) => fetchLiveTokenSnapshot(position.chain, position.tokenAddress).catch(() => null)));

  const release = await acquireRuntimeLease("tournament-state", 45_000);
  if (!release) return;
  try {
    const state = await ensureState();
    advanceIfDue(state);
    if (state.phase === "complete") { await saveTournamentState(state); return; }
    const at = iso();
    snapshots.forEach((snapshot) => {
      if (!snapshot) return;
      for (const team of state.teams) {
        const position = team.positions.find((row) => row.status === "open" && row.chain === snapshot.chain && row.tokenAddress === snapshot.tokenAddress);
        if (position) applyMark(team, position, snapshot, at);
      }
    });
    state.lastMarkRefreshAt = at;
    await saveTournamentState(state);
  } finally {
    await release().catch(() => undefined);
  }
}

export function ensureTournamentRuntime() {
  if (tournamentGlobal.__botWarRoomTournamentTimerV1) return;
  void ensureState().catch((error) => console.error("[tournament] initialize", error));
  tournamentGlobal.__botWarRoomTournamentTimerV1 = setInterval(() => void refreshTournamentMarks().catch((error) => console.error("[tournament] marks", error)), 10_000);
}

export async function getTournamentView(): Promise<TournamentView> {
  ensureTournamentRuntime();
  const state = await ensureState();
  advanceIfDue(state);
  await saveTournamentState(state);
  return { ...state, teams: ranked(state.teams), qualifierArchive: state.qualifierArchive ? ranked(state.qualifierArchive) : undefined, roundLabel: state.phase === "qualifier" ? "10-team qualifier" : state.phase === "final" ? "3-team drafted final" : state.status === "failed" ? "Experiment failed" : "Tournament complete", generatedAt: iso() };
}
