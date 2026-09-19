import { buildCouncilDiscussion } from "./debate";
import { executePaper } from "./execution";
import { runIndependentCouncil } from "./agent-entity-runtime";
import { resolveAdaptiveWeights, relevantMemoryHints } from "./learning-store";
import { fetchLiveCandidate, fetchLiveTokenSnapshot, getWaterfallProviderHealth } from "./provider-waterfall";
import { liveMarketDataMode } from "./market-data";
import { ensurePaperWalletResearchFunds, getPaperPortfolioContext, getPaperWalletResetMeta } from "./paper-wallet";
import { assessPaperEntryEligibility, ensurePositionGuardianLoop, registerPaperPosition } from "./position-manager";
import { acquireRuntimeLease, listManagedPositions } from "./position-store";
import { loadLatestProfitability } from "./profitability-store";
import { getProviderHealth } from "./provider-health";
import { getRunnerGenomeGuidance, getRunnerResearchSnapshot, ingestClosedPositions, markResearchTradeOpened, observeCouncilResult, observeResearchSnapshot, refreshOneResearchCase } from "./runner-research";
import { maybeDispatchLiveTrade } from "./live-gate";
import { auditEntryLiquidity } from "./liquidity-auditor";
import { applyClaudeSurvivalCouncil, getClaudeSurvivalCouncilStatus } from "./claude-survival-council";
import { classifyMarketRegime } from "./regime";
import { appendDecisionJournal } from "./trade-journal";
import { ensureTournamentRuntime, isTournamentActive, observeTournamentOpportunity } from "./tournament";
import type { Chain, ExecutionRequest, ManagedPosition, PortfolioRiskContext, PositionEntryContext, WarRoomResult } from "./types";

const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "HyperEVM", "Robinhood Chain"];
const DEFAULT_INTERVAL_MS = 2_000;
const MAX_CHAT_ROWS = 120;
const MAX_DECISIONS = 60;
const MAX_SHADOW_ROWS = 80;

export type AutopilotChatRow = {
  id: string;
  at: string;
  bot: string;
  message: string;
  kind: "council" | "system" | "execution" | "guardian";
};

export type DecisionFunnel = {
  candidates: number;
  riskPassed: number;
  watches: number;
  buySignals: number;
  skips: number;
  paperBuys: number;
  explorationBuys: number;
  rejections: Record<string, number>;
};

export type ShadowDecision = {
  id: string;
  decisionId: string;
  chain: Chain;
  tokenAddress: string;
  symbol: string;
  decision: "WATCH" | "SKIP";
  observedPrice: number;
  observedAt: string;
  reviewAfter: string;
  reviewedAt?: string;
  reviewedPrice?: number;
  movePct?: number;
  missedRunner?: boolean;
};

export type AutopilotStatus = {
  running: boolean;
  mode: "paper";
  dataMode: "adapter" | "birdeye" | "dexscreener";
  intervalMs: number;
  scanningChains: Chain[];
  chainStats: Record<Chain, { scans: number; candidates: number; lastScanAt?: string; lastCandidateAt?: string }>;
  currentChain: Chain;
  lastScanAt?: string;
  nextScanAt?: string;
  scanCount: number;
  candidateCount: number;
  buyCount: number;
  explorationBuyCount: number;
  missedRunnerCount: number;
  funnel: DecisionFunnel;
  shadowBook: ShadowDecision[];
  latestResult: WarRoomResult | null;
  recentDecisions: WarRoomResult[];
  chat: AutopilotChatRow[];
  mainWalletPausedForTournament: boolean;
  lastError?: string;
};

type AutopilotGlobal = typeof globalThis & {
  __botWarRoomAutopilotTimerV14?: ReturnType<typeof setInterval>;
  __botWarRoomAutopilotStateV14?: AutopilotStatus;
  __botWarRoomAutopilotBusyV14?: boolean;
  __botWarRoomAutopilotCursorV14?: number;
  __botWarRoomLastErrorMessageV227?: string;
  __botWarRoomLastErrorAtV227?: number;
};
const globalState = globalThis as AutopilotGlobal;

function intervalMs() {
  const raw = Number(process.env.WAR_ROOM_SCAN_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Math.max(1_500, Math.min(60_000, Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS));
}

function initialFunnel(): DecisionFunnel {
  return { candidates: 0, riskPassed: 0, watches: 0, buySignals: 0, skips: 0, paperBuys: 0, explorationBuys: 0, rejections: {} };
}

function initialState(): AutopilotStatus {
  return {
    running: false,
    mode: "paper",
    dataMode: liveMarketDataMode(),
    intervalMs: intervalMs(),
    scanningChains: CHAINS,
    chainStats: Object.fromEntries(CHAINS.map((chain) => [chain, { scans: 0, candidates: 0 }])) as Record<Chain, { scans: number; candidates: number; lastScanAt?: string; lastCandidateAt?: string }>,
    currentChain: CHAINS[0],
    scanCount: 0,
    candidateCount: 0,
    buyCount: 0,
    explorationBuyCount: 0,
    missedRunnerCount: 0,
    funnel: initialFunnel(),
    shadowBook: [],
    latestResult: null,
    recentDecisions: [],
    chat: [],
    mainWalletPausedForTournament: true,
  };
}

function state() {
  if (!globalState.__botWarRoomAutopilotStateV14) globalState.__botWarRoomAutopilotStateV14 = initialState();
  return globalState.__botWarRoomAutopilotStateV14;
}

function addChat(bot: string, message: string, kind: AutopilotChatRow["kind"] = "system", at = new Date().toISOString()) {
  const current = state();
  current.chat = [{ id: `${at}-${bot}-${Math.random().toString(36).slice(2, 8)}`, at, bot, message, kind }, ...current.chat].slice(0, MAX_CHAT_ROWS);
}

function recordRejection(reason: string) {
  const key = reason.slice(0, 110);
  const funnel = state().funnel;
  funnel.rejections[key] = (funnel.rejections[key] ?? 0) + 1;
}

function entryContext(result: WarRoomResult, portfolio: PortfolioRiskContext): PositionEntryContext {
  const initialAllocationPct = result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1);
  return {
    snapshot: result.snapshot,
    regime: result.regime,
    memeRegime: result.memeRegime,
    councilProcess: result.councilProcess,
    alpha: result.alpha,
    preMeeting: result.preMeeting,
    agentWeights: result.agentWeights,
    decision: result.decision,
    conviction: result.conviction,
    riskMaxPositionPct: result.risk.maxPositionPct,
    initialAllocationPct,
    portfolioEquityUsd: portfolio.equityUsd,
  };
}

function explicitSecurityFailure(result: WarRoomResult) {
  const snapshot = result.snapshot;
  const q = snapshot.dataProvenance?.quality;
  if (q?.sellability && !snapshot.sellable) return "Sellability explicitly failed";
  if (q?.honeypot && snapshot.honeypot) return "Honeypot evidence is positive";
  if (q?.top10 && snapshot.top10Pct > 80) return "Top 10 holders exceed 80%";
  if (q?.bundled && snapshot.bundledPct > 25) return "Bundled supply exceeds 25%";
  if (snapshot.chainFamily === "solana" && q?.authorities && (snapshot.mintAuthority || snapshot.freezeAuthority)) return "Solana mint/freeze authority remains active";
  const earlyRunner = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;
  const minimumLiquidity = earlyRunner ? Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000)) : 15_000;
  if (snapshot.liquidity < minimumLiquidity) return `Executable liquidity below ${earlyRunner ? "early-runner" : "standard"} minimum`;
  return undefined;
}

async function eligibilityWithPaperUnknownOverride(result: WarRoomResult, request: ExecutionRequest, context: PositionEntryContext) {
  const standard = await assessPaperEntryEligibility({ request, snapshot: result.snapshot, entryContext: context });
  if (standard.allowed) return standard;
  const q = result.snapshot.dataProvenance?.quality;
  const missingCriticalEvidence = Boolean(q && (!q.sellability || !q.honeypot || (result.snapshot.chainFamily === "solana" && !q.authorities)));
  const explicitFailure = explicitSecurityFailure(result);
  if (!missingCriticalEvidence || explicitFailure || !standard.reason.includes("deterministic contract/security conditions")) return standard;

  const sameToken = (await listManagedPositions()).filter((position) => position.chain === request.chain && position.tokenAddress === request.tokenAddress);
  if (sameToken.some((position) => position.status !== "closed")) {
    return { allowed: false, isReentry: false, reentryCount: 0, reason: "Position Guardian already owns an open position in this token." };
  }
  if (sameToken.some((position) => position.status === "closed")) {
    return standard; // Preserve the existing re-entry/cooldown rules after a completed trade.
  }
  return {
    allowed: true,
    isReentry: false,
    reentryCount: 0,
    reason: "PAPER-only exploration override: safety evidence is incomplete, not explicitly bad. Position size remains reduced and no live wallet is exposed.",
  };
}

async function executeRequest(result: WarRoomResult, portfolio: PortfolioRiskContext, request: ExecutionRequest, exploration: boolean) {
  // $50 is the floor, not the ceiling. Once Council sees an opportunity, the
  // active Runner Genome controls paper size from learned runner/dumper similarity.
  if (request.mode === "paper" && request.side === "BUY") {
    const minimumBuyUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
    const maximumBuyUsd = Math.max(minimumBuyUsd, Number(process.env.PAPER_TRAINING_MAX_BUY_USD ?? 150));
    if (portfolio.cashUsd + 0.005 < minimumBuyUsd) {
      const reason = `Paper wallet has $${portfolio.cashUsd.toFixed(2)} cash; waiting for an exit before the next $${minimumBuyUsd.toFixed(2)}+ training entry.`;
      recordRejection(reason);
      addChat("Executor", `${exploration ? "EARLY-RUNNER PROBE" : "EARLY-RUNNER BUY"} waiting for cash on $${result.snapshot.symbol}: ${reason}`, "execution");
      return false;
    }
    const genomeTarget = Math.max(minimumBuyUsd, result.runnerGenome?.suggestedTradeUsd ?? minimumBuyUsd);
    const targetUsd = exploration ? Math.min(genomeTarget, Number(process.env.PAPER_WATCH_MAX_BUY_USD ?? 100)) : genomeTarget;
    const notionalUsd = Math.min(maximumBuyUsd, targetUsd, portfolio.cashUsd);
    request = {
      ...request,
      notionalUsd: Number(Math.max(minimumBuyUsd, notionalUsd).toFixed(2)),
      maxSlippageBps: result.runnerGenome?.earlyRunnerZone ? Math.max(request.maxSlippageBps, Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600)) : request.maxSlippageBps,
    };
    addChat("Executor", `${exploration ? "EARLY-RUNNER PROBE" : "EARLY-RUNNER BUY"} $${result.snapshot.symbol}: $${request.notionalUsd.toFixed(2)} · Genome ${result.runnerGenome?.entryScore.toFixed(0) ?? "—"}/100 · dumper risk $${result.runnerGenome?.dumperRiskScore.toFixed(0) ?? "—"}/100. Win or lose, file the outcome and update the model.`, "execution");
  }

  const context = entryContext(result, portfolio);
  context.runnerGenome = result.runnerGenome;
  context.independentCouncil = result.independentCouncil;
  context.claudeSurvivalCouncil = result.claudeSurvivalCouncil;
  context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;

  // Last-mile entry verification: Council decisions can take long enough for a
  // brand-new pool to disappear between discovery and execution. Never trust
  // the earlier candidate snapshot for the final fill. A missing refresh fails
  // closed because it may mean the pair/liquidity no longer exists.
  const executionSnapshot = await fetchLiveTokenSnapshot(request.chain, request.tokenAddress);
  if (!executionSnapshot) {
    const reason = "Entry blocked: fresh final liquidity verification returned no executable market.";
    recordRejection(reason);
    addChat("Executor", `${exploration ? "PAPER PROBE" : "AUTO PAPER"} entry skipped for $${result.snapshot.symbol}: ${reason}`, "execution");
    return false;
  }
  if (!Number.isFinite(executionSnapshot.liquidity) || executionSnapshot.liquidity <= 0) {
    const reason = "Entry blocked: fresh final liquidity verification reports $0 liquidity.";
    recordRejection(reason);
    addChat("Executor", `${exploration ? "PAPER PROBE" : "AUTO PAPER"} entry skipped for $${result.snapshot.symbol}: ${reason}`, "execution");
    return false;
  }
  const liquidityAudit = await auditEntryLiquidity(executionSnapshot, request);
  if (!liquidityAudit.allowed) {
    const reason = `Liquidity Auditor blocked entry: ${liquidityAudit.reason}. No PAPER buy or wallet debit was recorded.`;
    recordRejection(reason);
    addChat("Liquidity Auditor", `$${result.snapshot.symbol}: ${reason}`, "execution");
    return false;
  }
  if (executionSnapshot.dataProvenance) {
    executionSnapshot.dataProvenance.notes = [...(executionSnapshot.dataProvenance.notes ?? []), `Liquidity Auditor: ${liquidityAudit.reason}. Pool data does not prove a token can be sold.`];
  }
  addChat("Liquidity Auditor", `$${result.snapshot.symbol}: ${liquidityAudit.reason}. Entry liquidity check passed.`, "execution");

  context.snapshot = executionSnapshot;
  const verifiedResult: WarRoomResult = { ...result, snapshot: executionSnapshot };
  const eligibility = await eligibilityWithPaperUnknownOverride(verifiedResult, request, context);
  if (!eligibility.allowed) {
    recordRejection(eligibility.reason);
    addChat("Executor", `${exploration ? "PAPER PROBE" : "AUTO PAPER"} entry skipped for $${result.snapshot.symbol}: ${eligibility.reason}`, "execution");
    return false;
  }

  try {
    const fill = await executePaper(request, executionSnapshot);
    const position = await registerPaperPosition({
      fill,
      request,
      snapshot: executionSnapshot,
      exitStrategy: result.exitStrategy,
      entryContext: context,
      reentryCount: eligibility.reentryCount,
    });
    await markResearchTradeOpened(result, fill.requestedUsd, exploration);
    state().buyCount += 1;
    state().funnel.paperBuys += 1;
    if (exploration) {
      state().explorationBuyCount += 1;
      state().funnel.explorationBuys += 1;
    }
    addChat("Executor", `${exploration ? "PAPER PROBE" : "AUTO PAPER BUY"} $${fill.symbol}: $${fill.requestedUsd.toFixed(2)} at $${fill.fillPrice}. ${fill.routeVerified ? "Live route verified." : "Live DEX liquidity model used."} Guardian owns ${position?.id ?? "the position"}.`, "execution");

    // Only full Council BUYs can mirror to live, and only after every Code Deciphered gate passes.
    if (!exploration) {
      const positions = await listManagedPositions();
      await ingestClosedPositions(positions);
      const resetMeta = await getPaperWalletResetMeta();
      const providers = [...getProviderHealth(), ...getWaterfallProviderHealth()];
      const research = await getRunnerResearchSnapshot({ positions, providers, walletResetCount: resetMeta.resets });
      const live = await maybeDispatchLiveTrade({ result, paperRequest: request, research });
      if (live.attempted) addChat("Executor", `${live.dispatched ? "LIVE AUTO-UNLOCK" : "LIVE DISPATCH BLOCKED"}: ${live.reason}`, "execution");
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordRejection(message);
    addChat("Executor", `Paper route rejected for $${result.snapshot.symbol}: ${message}`, "execution");
    return false;
  }
}

async function autoExecute(result: WarRoomResult, portfolio: PortfolioRiskContext) {
  if (result.decision !== "BUY" || !result.execution.allowed || !result.execution.request) return false;
  if (result.execution.request.mode !== "paper") return false;
  return executeRequest(result, portfolio, result.execution.request, false);
}

function explorationRequest(result: WarRoomResult, portfolio: PortfolioRiskContext): ExecutionRequest | null {
  if (process.env.PAPER_EXPLORATION_MODE === "false") return null;
  if (result.decision !== "WATCH" || !result.risk.passed) return null;
  if (result.councilProcess.executorVote === "BLOCK") return null;
  if (explicitSecurityFailure(result)) return null;
  // WATCH means the Council sees an opportunity but wants more proof. In PAPER mode
  // that is exactly the type of rep the Filing Cabinet needs. Do not re-run old Alpha/quorum filters.
  const minimumBuyUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  if (portfolio.cashUsd + 0.005 < minimumBuyUsd) return null;
  const notionalUsd = Number(Math.max(minimumBuyUsd, Math.min(result.runnerGenome?.suggestedTradeUsd ?? minimumBuyUsd, Number(process.env.PAPER_WATCH_MAX_BUY_USD ?? 100))).toFixed(2));
  return {
    mode: "paper",
    chain: result.snapshot.chain,
    tokenAddress: result.snapshot.tokenAddress,
    symbol: result.snapshot.symbol,
    side: "BUY",
    notionalUsd,
    maxSlippageBps: result.runnerGenome?.earlyRunnerZone ? Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600) : 135,
    strategyId: `${result.experiment.id}-exploration`,
    decisionId: `${result.decisionId}-PROBE`,
  };
}

function addShadowDecision(result: WarRoomResult) {
  if (result.decision !== "WATCH" && result.decision !== "SKIP") return;
  if (!result.risk.passed || result.snapshot.price <= 0) return;
  const reviewMinutes = Math.max(5, Number(process.env.PAPER_SHADOW_REVIEW_MINUTES ?? 15));
  const row: ShadowDecision = {
    id: `SH-${result.decisionId}`,
    decisionId: result.decisionId,
    chain: result.snapshot.chain,
    tokenAddress: result.snapshot.tokenAddress,
    symbol: result.snapshot.symbol,
    decision: result.decision,
    observedPrice: result.snapshot.price,
    observedAt: result.generatedAt,
    reviewAfter: new Date(Date.now() + reviewMinutes * 60_000).toISOString(),
  };
  state().shadowBook = [row, ...state().shadowBook.filter((item) => item.tokenAddress !== row.tokenAddress || item.chain !== row.chain)].slice(0, MAX_SHADOW_ROWS);
}

async function reviewOneShadowDecision() {
  const current = state();
  const now = Date.now();
  const due = current.shadowBook.find((row) => !row.reviewedAt && new Date(row.reviewAfter).getTime() <= now);
  if (!due) return;
  const snapshot = await fetchLiveTokenSnapshot(due.chain, due.tokenAddress);
  if (!snapshot || snapshot.price <= 0) {
    due.reviewAfter = new Date(Date.now() + 5 * 60_000).toISOString();
    return;
  }
  await observeResearchSnapshot(snapshot);
  due.reviewedAt = new Date().toISOString();
  due.reviewedPrice = snapshot.price;
  due.movePct = (snapshot.price / due.observedPrice - 1) * 100;
  due.missedRunner = due.movePct >= 25;
  if (due.missedRunner) {
    current.missedRunnerCount += 1;
    addChat("CIO", `Shadow review: we ${due.decision.toLowerCase()}ed $${due.symbol} and it moved +${due.movePct.toFixed(1)}% afterward. Logging this as a missed-runner signal for threshold review.`, "system");
  }
}

async function scanOneChain(chain: Chain) {
  const current = state();
  current.currentChain = chain;
  current.lastScanAt = new Date().toISOString();
  current.nextScanAt = new Date(Date.now() + current.intervalMs).toISOString();
  current.dataMode = liveMarketDataMode();
  current.scanCount += 1;
  const chainStat = current.chainStats[chain] ??= { scans: 0, candidates: 0 };
  chainStat.scans += 1;
  chainStat.lastScanAt = current.lastScanAt;

  const bankroll = await ensurePaperWalletResearchFunds();
  if (bankroll.resetPerformed) {
    addChat("System", `Research bankroll automatically restarted at $${bankroll.wallet.startingCashUsd.toFixed(2)} after reaching zero. Reset #${bankroll.resetMeta.resets}; prior losses remain in the research record.`, "system");
  }
  await refreshOneResearchCase(fetchLiveTokenSnapshot);
  await reviewOneShadowDecision();
  const snapshot = await fetchLiveCandidate(chain);
  if (!snapshot) {
    if (current.scanCount % CHAINS.length === 0) addChat("Launch Scout", `${chain}: no new qualifying real candidate. Provider waterfall is continuing automatically.`, "system");
    return;
  }
  current.candidateCount += 1;
  current.funnel.candidates += 1;
  current.chainStats[chain].candidates += 1;
  current.chainStats[chain].lastCandidateAt = new Date().toISOString();

  const regime = classifyMarketRegime(snapshot);
  const [learning, memoryHints, profitability, portfolio, runnerGenome] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
    getPaperPortfolioContext(snapshot.chain),
    getRunnerGenomeGuidance(snapshot),
  ]);

  let result = await runIndependentCouncil(snapshot, {
    mode: "paper",
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
    portfolio,
    runnerGenome,
  });

  if (!result.independentCouncil) {
    throw new Error("Independent Council trace missing; refusing legacy synthetic decision");
  }

  result = await applyClaudeSurvivalCouncil(result, portfolio);

  await observeCouncilResult(result);
  current.latestResult = result;
  current.recentDecisions = [result, ...current.recentDecisions.filter((row) => row.decisionId !== result.decisionId)].slice(0, MAX_DECISIONS);
  current.lastError = undefined;
  if (result.risk.passed) current.funnel.riskPassed += 1;
  if (result.decision === "BUY") current.funnel.buySignals += 1;
  else if (result.decision === "WATCH") current.funnel.watches += 1;
  else current.funnel.skips += 1;
  await appendDecisionJournal(result);
  // Tournament is a shadow ledger only: it consumes the already-computed result
  // and never feeds back into the locked V3.6.2 scanner, Council or main wallet.
  // Tournament failures must never terminate the scanner. While the tournament
  // is active we fail safely by keeping the main wallet sidelined.
  let tournamentActive = true;
  try {
    tournamentActive = await observeTournamentOpportunity(result);
  } catch (error) {
    console.error("[tournament] opportunity", error);
    tournamentActive = await isTournamentActive().catch(() => true);
  }
  current.mainWalletPausedForTournament = tournamentActive;

  const discussion = buildCouncilDiscussion(result);
  for (const turn of discussion) {
    const bot = result.agents.find((agent) => agent.id === turn.agentId)?.name ?? turn.agentId;
    addChat(bot, turn.message, "council");
  }
  if (result.claudeSurvivalCouncil) {
    for (const opinion of result.claudeSurvivalCouncil.specialists) {
      addChat(opinion.agentName, `${opinion.vote} · ${opinion.confidence.toFixed(0)}% · ${opinion.reason}`, "council", opinion.formedAt);
    }
  }
  addChat("CIO", `${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 local entities aligned; Claude Risk Reaper ${result.claudeSurvivalCouncil ? "completed" : "not summoned"}. PAPER kill switches OFF. Wallet equity ${portfolio.equityUsd.toFixed(2)}.`, "council");

  let executed = false;
  if (tournamentActive) {
    // Guardian keeps managing any legacy main-wallet holdings, but no new main
    // PAPER position is opened until the final tournament round completes.
  } else if (result.decision === "BUY") {
    if (!result.risk.passed) recordRejection(result.risk.hardBlocks[0] ?? "Deterministic risk veto");
    else if (!result.execution.allowed || !result.execution.request) recordRejection(result.execution.reason);
    else executed = await autoExecute(result, portfolio);
  } else if (result.decision === "WATCH") {
    const probe = explorationRequest(result, portfolio);
    if (probe) executed = await executeRequest(result, portfolio, probe, true);
    else recordRejection("WATCH opportunity could not execute because a hard safety/cash condition blocked the paper rep");
  } else {
    recordRejection(result.risk.hardBlocks[0] ?? "Council/alpha threshold produced SKIP");
  }
  if (!executed) addShadowDecision(result);
}

export async function runAutonomousTick() {
  if (globalState.__botWarRoomAutopilotBusyV14) return;
  globalState.__botWarRoomAutopilotBusyV14 = true;
  let releaseLease: (() => Promise<void>) | null = null;
  try {
    releaseLease = await acquireRuntimeLease("autopilot-tick", Math.max(60_000, intervalMs() * 10));
    if (!releaseLease) return;
    const cursor = globalState.__botWarRoomAutopilotCursorV14 ?? 0;
    const chain = CHAINS[cursor % CHAINS.length];
    globalState.__botWarRoomAutopilotCursorV14 = (cursor + 1) % CHAINS.length;
    await scanOneChain(chain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = state();
    const nowMs = Date.now();
    const sameMessage = globalState.__botWarRoomLastErrorMessageV227 === message;
    const lastAt = globalState.__botWarRoomLastErrorAtV227 ?? 0;
    current.lastError = message;
    // Never flood the Council chat with the same infrastructure error every scan.
    if (!sameMessage || nowMs - lastAt >= 60_000) {
      addChat("System", `Autonomous cycle error: ${message}`, "system");
      globalState.__botWarRoomLastErrorMessageV227 = message;
      globalState.__botWarRoomLastErrorAtV227 = nowMs;
    }
    console.error("[autopilot] cycle failed", error);
  } finally {
    if (releaseLease) await releaseLease().catch(() => undefined);
    globalState.__botWarRoomAutopilotBusyV14 = false;
  }
}

export function ensureAutonomousWarRoom() {
  ensurePositionGuardianLoop();
  ensureTournamentRuntime();
  const current = state();
  current.running = true;
  current.intervalMs = intervalMs();
  current.dataMode = liveMarketDataMode();
  if (globalState.__botWarRoomAutopilotTimerV14) return;

  setTimeout(() => void runAutonomousTick(), 750);
  globalState.__botWarRoomAutopilotTimerV14 = setInterval(() => void runAutonomousTick(), current.intervalMs);
  addChat("System", `V3.6.2 Local Council + permanent Claude Risk Reaper started. The three retired Claude seats remain removed. Audit Watch is observational only: UNKNOWN coverage never blocks a buy, sell, or chain; only confirmed locked-capital evidence is classified unsellable.`, "system");
}

export async function getAutopilotStatus() {
  ensureAutonomousWarRoom();
  const bankroll = await ensurePaperWalletResearchFunds();
  const positions = await listManagedPositions();
  await ingestClosedPositions(positions);
  const resetMeta = await getPaperWalletResetMeta();
  const providers = [...getProviderHealth(), ...getWaterfallProviderHealth()];
  const research = await getRunnerResearchSnapshot({ positions, providers, walletResetCount: resetMeta.resets });
  state().buyCount = bankroll.wallet.buyFills;
  state().funnel.paperBuys = bankroll.wallet.buyFills;
  state().mainWalletPausedForTournament = await isTournamentActive().catch(() => true);
  return {
    ...state(),
    paperWallet: bankroll.wallet,
    paperWalletResetMeta: resetMeta,
    providers,
    research,
    claudeSurvivalCouncil: await getClaudeSurvivalCouncilStatus(),
    positions: positions.sort((a: ManagedPosition, b: ManagedPosition) => b.openedAt.localeCompare(a.openedAt)).slice(0, 50),
    generatedAt: new Date().toISOString(),
  };
}
