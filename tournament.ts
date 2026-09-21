import { fetchLiveTokenSnapshot } from "./provider-waterfall";
import { acquireRuntimeLease } from "./position-store";
import { loadTournamentState, saveTournamentState } from "./tournament-store";
import { runIndependentCouncil, type CouncilOptions, type IndependentCouncilProfile } from "./agent-entity-runtime";
import { recordTournamentEntityOutcome } from "./agent-entity-store";
import { TOURNAMENT_ROLES, type TournamentMemberDecision, type TournamentPosition, type TournamentRole, type TournamentState, type TournamentTeam, type TournamentTeamView, type TournamentView } from "./tournament-types";
import type { CouncilEntityId, MarketSnapshot, PortfolioRiskContext, WarRoomResult } from "./types";

const STARTING_CASH_USD = 1_000;
const MAX_OPEN_POSITIONS = Math.max(1, Number(process.env.TOURNAMENT_MAX_OPEN_POSITIONS ?? 12));
const MAX_TRADE_ROWS = 300;
const MAX_PROCESSED_IDS = 1_200;
const FEE_RATE = Math.max(0, Number(process.env.TOURNAMENT_PAPER_FEE_BPS ?? 25)) / 10_000;
const TP_LEVELS = [{ pct: 25, portion: 0.20 }, { pct: 50, portion: 0.20 }, { pct: 100, portion: 0.25 }, { pct: 200, portion: 0.25 }];
const REGULAR_MAX_HOLD_MINUTES = 20;
const MOONBAG_MAX_HOLD_MINUTES = 120;
const DEADLINE_REFRESH_FAILURES_BEFORE_LOCK = 2;

type Variant = Pick<TournamentTeam, "id" | "name" | "description" | "roleBias" | "thresholdDelta" | "sizeMultiplier" | "fileCabinet">;
const VARIANTS: Variant[] = [
  { id: "team-10", name: "Team File Cabinet", description: "Learned evidence adjusts a 54-point base entry threshold; research remains advisory.", roleBias: {}, thresholdDelta: -3, sizeMultiplier: 0.97, fileCabinet: true },
];

const tournamentGlobal = globalThis as typeof globalThis & {
  __botWarRoomTournamentTimerV1?: ReturnType<typeof setInterval>;
  __botWarRoomTournamentRefreshCursorV1?: number;
  __botWarRoomTournamentRefreshBusyV2?: boolean;
};

function iso(ms = Date.now()) { return new Date(ms).toISOString(); }
function roundUsd(value: number) { return Number(value.toFixed(6)); }
async function acquireTournamentOpportunityLease() {
  // Parallel lanes can complete together. Wait briefly for the shared ledger
  // instead of silently dropping the second valid opportunity.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const release = await acquireRuntimeLease("tournament-state", 45_000);
    if (release) return release;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return null;
}
function emptyRoles(): TournamentTeam["rolePerformance"] {
  return Object.fromEntries(TOURNAMENT_ROLES.map((role) => [role, { role, trades: 0, wins: 0, losses: 0, attributedPnlUsd: 0 }])) as TournamentTeam["rolePerformance"];
}
function newTeam(variant: Variant): TournamentTeam {
  return { ...variant, startingCashUsd: STARTING_CASH_USD, cashUsd: STARTING_CASH_USD, realizedPnlUsd: 0, lockedCapitalLossUsd: 0, totalTrades: 0, councilRuns: 0, positions: [], trades: [], rolePerformance: emptyRoles(), rejectionCounts: {} };
}
function initialState(now = Date.now()): TournamentState {
  return { version: 3, phase: "qualifier", status: "running", createdAt: iso(now), qualifierStartedAt: iso(now), qualifierEndsAt: "9999-12-31T23:59:59.999Z", opportunityCount: 0, processedOpportunityIds: [], teams: VARIANTS.map(newTeam), fileCabinetEvidence: [], forcedTurnoverReleaseVersion: 1 };
}
async function ensureState() {
  const current = await loadTournamentState();
  if (current) {
    const existingOpenPositions = current.teams.some((team) => team.positions?.some((position) => position.status === "open"));
    if (current.forcedTurnoverReleaseVersion !== 1) {
      if (existingOpenPositions) current.forcedTurnoverReleaseRequestedAt ??= iso();
      else current.forcedTurnoverReleaseVersion = 1;
    }
    const variants = new Map(VARIANTS.map((variant) => [variant.id, variant]));
    current.teams = current.teams.filter((team) => team.id === "team-10");
    if (!current.teams.length) current.teams = VARIANTS.map(newTeam);
    current.phase = "qualifier";
    current.status = "running";
    current.qualifierEndsAt = "9999-12-31T23:59:59.999Z";
    current.finalStartedAt = undefined;
    current.finalEndsAt = undefined;
    current.completedAt = undefined;
    current.winnerTeamId = undefined;
    current.failureReason = undefined;
    for (const team of current.teams) {
      team.rejectionCounts ??= {};
      team.councilRuns ??= 0;
      for (const position of team.positions ?? []) {
        if (position.rolesSettled) position.rolesCredited = true;
        else if (position.status === "open") creditRoles(team, position);
        else settleRoles(team, position);
      }
      // Qualifier wallets survive deployments, but strategy configuration must
      // track the current tournament build. Otherwise Redis would preserve the
      // obsolete near-identical thresholds that caused the no-buy behavior.
      if (current.phase === "qualifier") {
        const variant = variants.get(team.id);
        if (variant) Object.assign(team, variant);
      }
    }
    for (const team of current.qualifierArchive ?? []) {
      team.rejectionCounts ??= {}; team.councilRuns ??= 0;
      for (const position of team.positions ?? []) {
        if (position.rolesSettled) position.rolesCredited = true;
        else if (position.status === "open") creditRoles(team, position);
        else settleRoles(team, position);
      }
    }
    return current;
  }
  const created = initialState();
  await saveTournamentState(created);
  return created;
}

function roleScores(result: WarRoomResult): Record<TournamentRole, number> {
  const byId = new Map(result.agents.map((agent) => [agent.id, agent.score]));
  return Object.fromEntries(TOURNAMENT_ROLES.map((role) => [role, Number(byId.get(role) ?? (role === "cio" ? result.conviction : 50))])) as Record<TournamentRole, number>;
}
function immediateSafetyFailure(snapshot: MarketSnapshot) {
  if (!Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0) return "Confirmed zero executable liquidity";
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
function reject(team: TournamentTeam, reason: string) {
  team.lastRejectionReason = reason;
  team.rejectionCounts[reason] = (team.rejectionCounts[reason] ?? 0) + 1;
  return false;
}
function eligible(team: TournamentTeam, result: WarRoomResult) {
  // Tournament wallets own their cash and capacity. Never inherit the sidelined
  // main wallet's execution.allowed/request, because those are calculated from
  // the main wallet's cash. Shared market risk and Executor safety still apply.
  if (!result.risk.passed) return reject(team, `Hard safety: ${result.risk.hardBlocks[0] ?? "risk veto"}`);
  if (result.councilProcess.executorVote === "BLOCK") return reject(team, "Executor blocked market feasibility");
  if (team.cashUsd < 25) return reject(team, "Team wallet has less than $25 cash");
  return result.decision === "BUY" || reject(team, `${team.name} Council finished ${result.decision}`);
}

function teamPortfolio(team: TournamentTeam, chain: MarketSnapshot["chain"]): PortfolioRiskContext {
  const value = equity(team);
  const openValue = team.positions.filter((position) => position.status === "open").reduce((sum, position) => sum + position.remainingQuantity * position.markPrice, 0);
  const chainValue = team.positions.filter((position) => position.status === "open" && position.chain === chain).reduce((sum, position) => sum + position.remainingQuantity * position.markPrice, 0);
  return {
    equityUsd: value, cashUsd: team.cashUsd, dailyPnlPct: (value / team.startingCashUsd - 1) * 100,
    openPositions: team.positions.filter((position) => position.status === "open").length,
    totalExposurePct: value > 0 ? openValue / value * 100 : 0,
    chainExposurePct: value > 0 ? chainValue / value * 100 : 0,
    strategyExposurePct: value > 0 ? openValue / value * 100 : 0,
    maxDailyLossPct: 100, maxOpenPositions: MAX_OPEN_POSITIONS, maxTotalExposurePct: 100,
    maxChainExposurePct: 100, liveTradingEnabled: false,
  };
}

function teamProfile(team: TournamentTeam): IndependentCouncilProfile {
  const roleMemoryNamespaces = team.draftSources
    ? Object.fromEntries(TOURNAMENT_ROLES.map((role) => [role, `tournament:${team.draftSources?.[role]?.teamId ?? team.id}`])) as Partial<Record<CouncilEntityId, string>>
    : undefined;
  return {
    teamId: team.id, teamName: team.name, memoryNamespace: `tournament:${team.id}`,
    roleBias: team.roleBias, thresholdDelta: team.thresholdDelta, fileCabinet: team.fileCabinet,
    roleMemoryNamespaces,
  };
}

function memberDecisions(result: WarRoomResult, profile: IndependentCouncilProfile): TournamentMemberDecision[] {
  const trace = result.independentCouncil;
  if (!trace) return [];
  return [...trace.meetingOpinions, trace.cioOpinion].map((opinion) => ({
    role: opinion.agentId as TournamentRole, vote: opinion.vote, score: opinion.score,
    confidence: opinion.confidence, memoryNamespace: profile.roleMemoryNamespaces?.[opinion.agentId] ?? profile.memoryNamespace,
  }));
}

async function mapConcurrent<T, R>(rows: T[], limit: number, run: (row: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) { const index = cursor++; output[index] = await run(rows[index]); }
  }));
  return output;
}
function positionExists(team: TournamentTeam, snapshot: MarketSnapshot) {
  return team.positions.some((position) => position.status === "open" && position.chain === snapshot.chain && position.tokenAddress === snapshot.tokenAddress);
}
function creditRoles(team: TournamentTeam, position: TournamentPosition) {
  if (position.rolesCredited) return;
  for (const role of TOURNAMENT_ROLES) team.rolePerformance[role].trades += 1;
  position.rolesCredited = true;
}
function settleRoles(team: TournamentTeam, position: TournamentPosition) {
  if (position.rolesSettled) return;
  creditRoles(team, position);
  const total = TOURNAMENT_ROLES.reduce((sum, role) => sum + Math.max(1, position.roleScores[role]), 0);
  for (const role of TOURNAMENT_ROLES) {
    const row = team.rolePerformance[role];
    row.wins += position.realizedPnlUsd > 0 ? 1 : 0;
    row.losses += position.realizedPnlUsd <= 0 ? 1 : 0;
    row.attributedPnlUsd = roundUsd(row.attributedPnlUsd + position.realizedPnlUsd * (Math.max(1, position.roleScores[role]) / total) * TOURNAMENT_ROLES.length);
  }
  position.rolesSettled = true;
}
function sell(team: TournamentTeam, position: TournamentPosition, quantity: number, snapshot: MarketSnapshot, action: "TRIM" | "SELL", note: string, at: string) {
  // Exit accounting must prove that a market exists at the exact snapshot used
  // for the fill. Never turn a stale quoted price into imaginary paper cash.
  if (!Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0) {
    lockPosition(team, position, "Exit rejected: market reports zero executable liquidity. No proceeds credited; remaining capital recorded as locked/lost.", at);
    return;
  }
  const price = snapshot.price;
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
    position.exitReason = note;
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
  position.exitReason = reason;
  settleRoles(team, position);
}
function isMoonbagPosition(position: TournamentPosition) {
  return position.takenTargets.length >= TP_LEVELS.length
    && position.remainingQuantity <= position.initialQuantity * 0.12;
}
function turnoverDeadlineMs(position: TournamentPosition) {
  if (isMoonbagPosition(position)) {
    return new Date(position.moonbagAt ?? position.openedAt).getTime() + MOONBAG_MAX_HOLD_MINUTES * 60_000;
  }
  return new Date(position.openedAt).getTime() + REGULAR_MAX_HOLD_MINUTES * 60_000;
}
function turnoverDue(position: TournamentPosition, now = Date.now()) {
  return position.status === "open" && now >= turnoverDeadlineMs(position);
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
  position.lastMarkAt = at;
  position.deadlineRefreshFailures = 0;
  position.highWaterPrice = Math.max(position.highWaterPrice, snapshot.price);
  const pnlPct = (snapshot.price / Math.max(position.entryPrice, 1e-12) - 1) * 100;
  for (let index = 0; index < TP_LEVELS.length; index += 1) {
    const target = TP_LEVELS[index];
    if (pnlPct >= target.pct && !position.takenTargets.includes(index)) {
      position.takenTargets.push(index);
      sell(team, position, position.initialQuantity * target.portion, snapshot, "TRIM", `Shared +${target.pct}% tournament take-profit`, at);
      if (position.status !== "open") return;
    }
  }
  const isMoonbag = isMoonbagPosition(position);
  if (isMoonbag && !position.moonbagAt) position.moonbagAt = at;
  const drawdownPct = position.highWaterPrice > 0 ? (1 - snapshot.price / position.highWaterPrice) * 100 : 0;
  const ageMinutes = (new Date(at).getTime() - new Date(position.openedAt).getTime()) / 60_000;
  const moonbagMinutes = position.moonbagAt ? (new Date(at).getTime() - new Date(position.moonbagAt).getTime()) / 60_000 : 0;
  const volumeAcceleration = snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? 0;
  const buyingPressureSlowed = !isMoonbag && ageMinutes >= 5
    && Boolean(snapshot.dataProvenance?.live)
    && ((snapshot.buySellRatio < 1 && volumeAcceleration <= 0) || snapshot.buySellRatio < 0.85);
  if (pnlPct <= -position.stopLossPct) sell(team, position, position.remainingQuantity, snapshot, "SELL", "Shared stop-loss", at);
  else if (pnlPct >= 25 && drawdownPct >= position.trailingStopPct) sell(team, position, position.remainingQuantity, snapshot, "SELL", "Shared trailing stop", at);
  else if (buyingPressureSlowed) sell(team, position, position.remainingQuantity, snapshot, "SELL", `Buying pressure slowed after ${ageMinutes.toFixed(0)}m · buy/sell ${snapshot.buySellRatio.toFixed(2)}x · volume acceleration ${volumeAcceleration.toFixed(1)}%`, at);
  else if (isMoonbag && moonbagMinutes >= MOONBAG_MAX_HOLD_MINUTES) sell(team, position, position.remainingQuantity, snapshot, "SELL", "Moon bag reached its 2-hour maximum hold", at);
  else if (!isMoonbag && ageMinutes >= REGULAR_MAX_HOLD_MINUTES) sell(team, position, position.remainingQuantity, snapshot, "SELL", "Regular trade reached its 20-minute maximum hold", at);
}
function enter(team: TournamentTeam, result: WarRoomResult, scores: Record<TournamentRole, number>, at: string) {
  const snapshot = result.snapshot;
  const unsafe = immediateSafetyFailure(snapshot);
  if (unsafe) return reject(team, `Entry rejected: ${unsafe}`);
  if (positionExists(team, snapshot)) return reject(team, "Already holding this token");
  if (team.positions.filter((position) => position.status === "open").length >= MAX_OPEN_POSITIONS) return reject(team, `Maximum ${MAX_OPEN_POSITIONS} active trades reached`);
  const planned = result.execution.request?.notionalUsd ?? result.runnerGenome.suggestedTradeUsd ?? 50;
  const fileCabinetSize = team.fileCabinet && result.runnerGenome.learned ? result.runnerGenome.suggestedTradeUsd : planned;
  const notional = Math.min(team.cashUsd, 125, Math.max(25, fileCabinetSize * team.sizeMultiplier));
  if (notional < 25) return reject(team, "Team wallet cannot fund the $25 minimum");
  if (snapshot.price <= 0) return reject(team, "Candidate price is not executable");
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
    realizedPnlUsd: 0, openedAt: at, lastMarkAt: at, status: "open", takenTargets: [],
    stopLossPct: Math.max(1, result.exitStrategy.stopLossPct), trailingStopPct: Math.max(1, result.exitStrategy.trailingStopPct),
    maxHoldMinutes: 20, roleScores: scores,
    decisionId: result.decisionId,
    memoryNamespace: result.independentCouncil?.memoryNamespace ?? `tournament:${team.id}`,
    memberOpinions: memberDecisions(result, teamProfile(team)),
  };
  team.positions.push(position);
  creditRoles(team, position);
  team.lastRejectionReason = undefined;
  addTrade(team, { id: `${position.id}-BUY`, at, symbol: snapshot.symbol, chain: snapshot.chain, action: "BUY", quantity, price: snapshot.price, valueUsd: spend, pnlUsd: -fee, note: team.fileCabinet ? "File Cabinet advisory entry" : "Controlled tournament entry" });
  return true;
}

function teamView(team: TournamentTeam): TournamentTeamView {
  const openValueUsd = team.positions.filter((position) => position.status === "open").reduce((sum, position) => sum + position.remainingQuantity * position.markPrice, 0);
  const equityUsd = team.cashUsd + openValueUsd;
  const unrealizedPnlUsd = openValueUsd - openCost(team);
  const totalPnlUsd = equityUsd - team.startingCashUsd;
  const accountingDeltaUsd = totalPnlUsd - (team.realizedPnlUsd + unrealizedPnlUsd);
  const openPositions = team.positions.filter((position) => position.status === "open");
  const rolePerformance = Object.fromEntries(TOURNAMENT_ROLES.map((role) => {
    const row = team.rolePerformance[role];
    const livePnl = openPositions.reduce((sum, position) => {
      const totalScore = TOURNAMENT_ROLES.reduce((scoreSum, item) => scoreSum + Math.max(1, position.roleScores[item]), 0);
      const positionPnl = position.realizedPnlUsd + position.remainingQuantity * position.markPrice - position.remainingCostUsd;
      return sum + positionPnl * (Math.max(1, position.roleScores[role]) / totalScore) * TOURNAMENT_ROLES.length;
    }, 0);
    return [role, {
      ...row,
      activeTrades: openPositions.length,
      unrealizedAttributedPnlUsd: roundUsd(livePnl),
      totalAttributedPnlUsd: roundUsd(row.attributedPnlUsd + livePnl),
    }];
  })) as TournamentTeam["rolePerformance"];
  return {
    ...team, rolePerformance, rank: 0,
    openValueUsd: roundUsd(openValueUsd), equityUsd: roundUsd(equityUsd),
    unrealizedPnlUsd: roundUsd(unrealizedPnlUsd), totalPnlUsd: roundUsd(totalPnlUsd),
    accountingDeltaUsd: roundUsd(accountingDeltaUsd), accountingVerified: Math.abs(accountingDeltaUsd) <= 0.02,
    activeTrades: openPositions.length, returnPct: roundUsd((equityUsd / team.startingCashUsd - 1) * 100),
  };
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
    return { id: `final-${rank}`, name: `Final Team ${rank}`, description: `${rank === 1 ? "Best" : rank === 2 ? "Second-best" : "Third-best"} qualifier performer drafted independently for every role.`, startingCashUsd: STARTING_CASH_USD, cashUsd: STARTING_CASH_USD, realizedPnlUsd: 0, lockedCapitalLossUsd: 0, totalTrades: 0, councilRuns: 0, positions: [], trades: [], rolePerformance, roleBias, thresholdDelta, sizeMultiplier, fileCabinet: Object.values(draftSources).some((source) => source.teamId === "team-10"), rejectionCounts: {}, draftSources } satisfies TournamentTeam;
  });
}
function advanceIfDue(state: TournamentState) {
  // The winning Tournament.13 environment now runs continuously as the main
  // wallet. There is no qualifier deadline, draft, final, or losing council.
  state.phase = "qualifier";
  state.status = "running";
}

async function flushOutcomeMemories(state: TournamentState) {
  const positions = [...state.teams, ...(state.qualifierArchive ?? [])]
    .flatMap((team) => team.positions)
    .filter((position) => position.status !== "open" && !position.memoryRecorded && position.memberOpinions?.length);
  for (const position of positions) {
    const groups = new Map<string, TournamentMemberDecision[]>();
    for (const opinion of position.memberOpinions) groups.set(opinion.memoryNamespace, [...(groups.get(opinion.memoryNamespace) ?? []), opinion]);
    await Promise.all([...groups].map(([namespace, opinions]) => recordTournamentEntityOutcome({
      namespace, positionId: position.id, symbol: position.symbol, chain: position.chain,
      decisionId: position.decisionId, realizedPnlUsd: position.realizedPnlUsd,
      realizedReturnPct: position.entryNotionalUsd > 0 ? position.realizedPnlUsd / position.entryNotionalUsd * 100 : 0,
      closedAt: position.closedAt ?? iso(), exitReason: position.exitReason ?? position.lockedReason ?? "Tournament exit",
      opinions: opinions.map((opinion) => ({ agentId: opinion.role, vote: opinion.vote, confidence: opinion.confidence, score: opinion.score })),
    })));
    position.memoryRecorded = true;
  }
}

export async function observeTournamentOpportunity(seed: WarRoomResult, sharedOptions: Omit<CouncilOptions, "portfolio" | "teamProfile"> = {}): Promise<{ active: boolean; representativeResult?: WarRoomResult }> {
  const opportunityRelease = await acquireRuntimeLease(`tournament-opportunity:${seed.decisionId}`, 120_000);
  if (!opportunityRelease) return { active: (await ensureState()).phase !== "complete" };
  try {
    let preview = await ensureState();
    advanceIfDue(preview);
    if (preview.phase === "complete") return { active: false };
    if (preview.processedOpportunityIds.includes(seed.decisionId)) return { active: true };
    const phase = preview.phase;
    const teams = preview.teams.map((team) => structuredClone(team));
    const councilResults = await mapConcurrent(teams, 2, async (team) => runIndependentCouncil(seed.snapshot, {
      ...sharedOptions,
      mode: "paper",
      portfolio: teamPortfolio(team, seed.snapshot.chain),
      teamProfile: teamProfile(team),
    }));

    const release = await acquireTournamentOpportunityLease();
    if (!release) return { active: true, representativeResult: councilResults[0] };
    try {
      const state = await ensureState();
      advanceIfDue(state);
      if (state.phase === "complete") { await flushOutcomeMemories(state); await saveTournamentState(state); return { active: false }; }
      if (state.phase !== phase || state.processedOpportunityIds.includes(seed.decisionId)) return { active: true, representativeResult: councilResults[0] };
      state.processedOpportunityIds = [...state.processedOpportunityIds.slice(-(MAX_PROCESSED_IDS - 1)), seed.decisionId];
      state.opportunityCount += 1;
      state.lastOpportunityAt = iso();
      const unsafe = immediateSafetyFailure(seed.snapshot) || hasPositiveSellabilityFailure(seed.snapshot);
      const turnoverReleasePending = state.forcedTurnoverReleaseVersion !== 1;
      for (const result of councilResults) {
        const teamId = result.independentCouncil?.teamId;
        const team = state.teams.find((row) => row.id === teamId);
        if (!team) continue;
        const profile = teamProfile(team);
        const members = memberDecisions(result, profile);
        team.councilRuns += 1;
        team.lastCouncil = {
          decisionId: result.decisionId, decision: result.decision === "BUY" || result.decision === "WATCH" ? result.decision : "SKIP",
          score: result.independentCouncil?.cioOpinion.score ?? result.conviction,
          completedAt: result.independentCouncil?.completedAt ?? state.lastOpportunityAt,
          members: Object.fromEntries(members.map((member) => [member.role, member])),
        };
        const existing = team.positions.find((position) => position.status === "open" && position.chain === result.snapshot.chain && position.tokenAddress === result.snapshot.tokenAddress);
        if (existing) applyMark(team, existing, result.snapshot, state.lastOpportunityAt);
        if (turnoverReleasePending) reject(team, "One-time turnover release is clearing pre-deployment positions");
        else if (unsafe) reject(team, immediateSafetyFailure(result.snapshot) ?? "Confirmed sellability failure");
        else if (eligible(team, result)) enter(team, result, roleScores(result), state.lastOpportunityAt);
      }
      if (seed.runnerGenome.learned) state.fileCabinetEvidence = [...seed.runnerGenome.runnerEvidence.slice(0, 3), ...seed.runnerGenome.dumperEvidence.slice(0, 2)].slice(0, 5);
      await flushOutcomeMemories(state);
      await saveTournamentState(state);
      return { active: true, representativeResult: councilResults[0] };
    } finally {
      await release().catch(() => undefined);
    }
  } finally {
    await opportunityRelease().catch(() => undefined);
  }
}

export async function isTournamentActive() {
  return (await ensureState()).phase !== "complete";
}

export async function refreshTournamentMarks(limit = 4) {
  if (tournamentGlobal.__botWarRoomTournamentRefreshBusyV2) return;
  tournamentGlobal.__botWarRoomTournamentRefreshBusyV2 = true;
  try {
  // Fetch prices without holding the state lock. Provider latency can otherwise
  // collide with a new candidate and make the whole tournament miss it.
  const preview = await ensureState();
  if (preview.phase === "complete") return;
  const unique = new Map<string, TournamentPosition>();
  for (const team of preview.teams) for (const position of team.positions) if (position.status === "open") unique.set(`${position.chain}:${position.tokenAddress}`, position);
  const rows = [...unique.values()].sort((a, b) => {
    const aDue = turnoverDue(a) ? 0 : 1;
    const bDue = turnoverDue(b) ? 0 : 1;
    return aDue - bDue || turnoverDeadlineMs(a) - turnoverDeadlineMs(b);
  });
  if (!rows.length) return;
  const dueRows = rows.filter((position) => turnoverDue(position));
  const cursor = tournamentGlobal.__botWarRoomTournamentRefreshCursorV1 ?? 0;
  const selected = dueRows.length
    ? dueRows.slice(0, limit)
    : Array.from({ length: Math.min(limit, rows.length) }, (_, index) => rows[(cursor + index) % rows.length]);
  tournamentGlobal.__botWarRoomTournamentRefreshCursorV1 = (cursor + selected.length) % rows.length;
  const snapshots = await Promise.all(selected.map((position) => fetchLiveTokenSnapshot(position.chain, position.tokenAddress).catch(() => null)));

  const release = await acquireRuntimeLease("tournament-state", 45_000);
  if (!release) return;
  try {
    const state = await ensureState();
    advanceIfDue(state);
    if (state.phase === "complete") { await saveTournamentState(state); return; }
    const at = iso();
    snapshots.forEach((snapshot, index) => {
      const selectedPosition = selected[index];
      for (const team of state.teams) {
        const position = team.positions.find((row) => row.status === "open" && row.chain === selectedPosition.chain && row.tokenAddress === selectedPosition.tokenAddress);
        if (position) {
          if (!snapshot) {
            if (turnoverDue(position)) {
              position.deadlineRefreshFailures = (position.deadlineRefreshFailures ?? 0) + 1;
              if (position.deadlineRefreshFailures >= DEADLINE_REFRESH_FAILURES_BEFORE_LOCK) {
                lockPosition(team, position, `${isMoonbagPosition(position) ? "Two-hour moon-bag" : "20-minute regular-trade"} deadline reached, but two fresh executable exit checks returned no market. No proceeds credited; remaining capital conservatively recorded as locked/lost.`, at);
              }
            }
            continue;
          }
          applyMark(team, position, snapshot, at);
          if (state.forcedTurnoverReleaseVersion !== 1 && position.status === "open") {
            sell(team, position, position.remainingQuantity, snapshot, "SELL", "One-time Tournament.10 turnover release", at);
          }
        }
      }
    });
    if (state.forcedTurnoverReleaseVersion !== 1 && !state.teams.some((team) => team.positions.some((position) => position.status === "open"))) {
      state.forcedTurnoverReleaseVersion = 1;
    }
    state.lastMarkRefreshAt = at;
    await flushOutcomeMemories(state);
    await saveTournamentState(state);
  } finally {
    await release().catch(() => undefined);
  }
  } finally {
    tournamentGlobal.__botWarRoomTournamentRefreshBusyV2 = false;
  }
}

export function ensureTournamentRuntime() {
  if (tournamentGlobal.__botWarRoomTournamentTimerV1) return;
  void ensureState().catch((error) => console.error("[tournament] initialize", error));
  void refreshTournamentMarks(12).catch((error) => console.error("[tournament] one-time release", error));
  tournamentGlobal.__botWarRoomTournamentTimerV1 = setInterval(() => void refreshTournamentMarks().catch((error) => console.error("[tournament] marks", error)), 10_000);
}

export async function getTournamentView(): Promise<TournamentView> {
  ensureTournamentRuntime();
  const state = await ensureState();
  advanceIfDue(state);
  await flushOutcomeMemories(state);
  await saveTournamentState(state);
  return { ...state, teams: ranked(state.teams), qualifierArchive: undefined, roundLabel: "Exact Tournament.13 environment · continuous", generatedAt: iso() };
}
