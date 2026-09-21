import { buildCouncilDiscussion } from "./debate";
import { executePaper } from "./execution";
import { runIndependentCouncil, type IndependentCouncilProfile } from "./agent-entity-runtime";
import { resolveAdaptiveWeights, relevantMemoryHints } from "./learning-store";
import { fetchLiveCandidate, fetchLiveTokenSnapshot, getWaterfallProviderHealth } from "./provider-waterfall";
import { liveMarketDataMode } from "./market-data";
import { ensurePaperWalletResearchFunds, getPaperPortfolioContext, getPaperWalletResetMeta } from "./paper-wallet";
import { ensurePositionGuardianLoop, registerPaperPosition } from "./position-manager";
import { acquireRuntimeLease, listManagedPositions } from "./position-store";
import { loadLatestProfitability } from "./profitability-store";
import { getProviderHealth } from "./provider-health";
import { getRunnerGenomeGuidance, getRunnerResearchSnapshot, ingestClosedPositions, markResearchTradeOpened, observeCouncilResult, observeResearchSnapshot, refreshOneResearchCase } from "./runner-research";
import { maybeDispatchLiveTrade } from "./live-gate";
import { auditEntryLiquidity } from "./liquidity-auditor";
import { classifyMarketRegime } from "./regime";
import { appendDecisionJournal } from "./trade-journal";
import type { Chain, ExecutionRequest, ManagedPosition, PortfolioRiskContext, PositionEntryContext, WarRoomResult } from "./types";

const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "HyperEVM", "Robinhood Chain"];
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_SCAN_WORKERS = 3;
const MAX_CHAT_ROWS = 120;
const MAX_DECISIONS = 60;
const MAX_SHADOW_ROWS = 80;
const FILE_CABINET_MIN_BUY_USD = 25;
const FILE_CABINET_MAX_BUY_USD = 125;
const FILE_CABINET_SIZE_MULTIPLIER = 0.97;
const FILE_CABINET_MAX_OPEN_POSITIONS = 12;

const MAIN_FILE_CABINET_PROFILE: IndependentCouncilProfile = {
  teamId: "team-10",
  teamName: "Team File Cabinet",
  memoryNamespace: "tournament:team-10",
  roleBias: {},
  thresholdDelta: -3,
  fileCabinet: true,
};

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
  scanWorkers: number;
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

function scanWorkers() {
  const raw = Number(process.env.WAR_ROOM_SCAN_WORKERS ?? DEFAULT_SCAN_WORKERS);
  return Math.max(1, Math.min(3, Number.isFinite(raw) ? Math.round(raw) : DEFAULT_SCAN_WORKERS));
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
    scanWorkers: scanWorkers(),
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

async function executeRequest(result: WarRoomResult, portfolio: PortfolioRiskContext, request: ExecutionRequest) {
  // Locked Main File Cabinet sizing: learned Genome amount, multiplied
  // by 0.97, with the original $25 floor and $125 ceiling.
  if (request.mode === "paper" && request.side === "BUY") {
    if (portfolio.cashUsd + 0.005 < FILE_CABINET_MIN_BUY_USD) {
      const reason = `Paper wallet has $${portfolio.cashUsd.toFixed(2)} cash; Team File Cabinet requires at least $${FILE_CABINET_MIN_BUY_USD.toFixed(2)}.`;
      recordRejection(reason);
      addChat("Executor", `TEAM FILE CABINET BUY waiting for cash on $${result.snapshot.symbol}: ${reason}`, "execution");
      return false;
    }
    const learnedTarget = result.runnerGenome?.suggestedTradeUsd ?? request.notionalUsd;
    const notionalUsd = Math.min(portfolio.cashUsd, FILE_CABINET_MAX_BUY_USD, Math.max(FILE_CABINET_MIN_BUY_USD, learnedTarget * FILE_CABINET_SIZE_MULTIPLIER));
    request = {
      ...request,
      notionalUsd: Number(notionalUsd.toFixed(2)),
      maxSlippageBps: result.runnerGenome?.earlyRunnerZone ? Math.max(request.maxSlippageBps, Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600)) : request.maxSlippageBps,
    };
    addChat("Executor", `TEAM FILE CABINET BUY $${result.snapshot.symbol}: $${request.notionalUsd.toFixed(2)} · Genome ${result.runnerGenome?.entryScore.toFixed(0) ?? "—"}/100 · dumper risk ${result.runnerGenome?.dumperRiskScore.toFixed(0) ?? "—"}/100.`, "execution");
  }

  const context = entryContext(result, portfolio);
  context.runnerGenome = result.runnerGenome;
  context.independentCouncil = result.independentCouncil;
  context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;

  // Last-mile entry verification: Council decisions can take long enough for a
  // brand-new pool to disappear between discovery and execution. Never trust
  // the earlier candidate snapshot for the final fill. A missing refresh fails
  // closed because it may mean the pair/liquidity no longer exists.
  const executionSnapshot = await fetchLiveTokenSnapshot(request.chain, request.tokenAddress);
  if (!executionSnapshot) {
    const reason = "Entry blocked: fresh final liquidity verification returned no executable market.";
    recordRejection(reason);
    addChat("Executor", `TEAM FILE CABINET entry skipped for $${result.snapshot.symbol}: ${reason}`, "execution");
    return false;
  }
  if (!Number.isFinite(executionSnapshot.liquidity) || executionSnapshot.liquidity <= 0) {
    const reason = "Entry blocked: fresh final liquidity verification reports $0 liquidity.";
    recordRejection(reason);
    addChat("Executor", `TEAM FILE CABINET entry skipped for $${result.snapshot.symbol}: ${reason}`, "execution");
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
  const positions = await listManagedPositions();
  const openPositions = positions.filter((position) => position.status === "open" || position.status === "exit_pending");
  const sameTokenOpen = openPositions.some((position) => position.chain === request.chain && position.tokenAddress === request.tokenAddress);
  if (sameTokenOpen || openPositions.length >= FILE_CABINET_MAX_OPEN_POSITIONS) {
    const reason = sameTokenOpen
      ? "Team File Cabinet already holds this token."
      : `Main File Cabinet reached its maximum of ${FILE_CABINET_MAX_OPEN_POSITIONS} active trades.`;
    recordRejection(reason);
    addChat("Executor", `TEAM FILE CABINET entry skipped for $${result.snapshot.symbol}: ${reason}`, "execution");
    return false;
  }
  const reentryCount = positions.filter((position) => position.status === "closed" && position.chain === request.chain && position.tokenAddress === request.tokenAddress).length;

  try {
    const fill = await executePaper(request, executionSnapshot);
    const position = await registerPaperPosition({
      fill,
      request,
      snapshot: executionSnapshot,
      exitStrategy: result.exitStrategy,
      entryContext: context,
      reentryCount,
    });
    await markResearchTradeOpened(result, fill.requestedUsd, false);
    state().buyCount += 1;
    state().funnel.paperBuys += 1;
    addChat("Executor", `TEAM FILE CABINET BUY $${fill.symbol}: $${fill.requestedUsd.toFixed(2)} at $${fill.fillPrice}. ${fill.routeVerified ? "Live route verified." : "Live DEX liquidity model used."} Guardian owns ${position?.id ?? "the position"}.`, "execution");

    const refreshedPositions = await listManagedPositions();
    await ingestClosedPositions(refreshedPositions);
    const resetMeta = await getPaperWalletResetMeta();
    const providers = [...getProviderHealth(), ...getWaterfallProviderHealth()];
    const research = await getRunnerResearchSnapshot({ positions: refreshedPositions, providers, walletResetCount: resetMeta.resets });
    const live = await maybeDispatchLiveTrade({ result, paperRequest: request, research });
    if (live.attempted) addChat("Executor", `${live.dispatched ? "LIVE AUTO-UNLOCK" : "LIVE DISPATCH BLOCKED"}: ${live.reason}`, "execution");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordRejection(message);
    addChat("Executor", `Paper route rejected for $${result.snapshot.symbol}: ${message}`, "execution");
    return false;
  }
}

async function autoExecute(result: WarRoomResult, portfolio: PortfolioRiskContext) {
  if (result.decision !== "BUY" || !result.risk.passed || result.councilProcess.executorVote === "BLOCK") return false;
  const request: ExecutionRequest = result.execution.request ?? {
    mode: "paper",
    chain: result.snapshot.chain,
    tokenAddress: result.snapshot.tokenAddress,
    symbol: result.snapshot.symbol,
    side: "BUY",
    notionalUsd: result.runnerGenome?.suggestedTradeUsd ?? FILE_CABINET_MIN_BUY_USD,
    maxSlippageBps: result.conviction >= 85 ? 125 : 90,
    strategyId: result.experiment.id,
    decisionId: result.decisionId,
  };
  return executeRequest(result, portfolio, request);
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

  // These are the exact wallet constraints Team File Cabinet competed with.
  // They replace the broad main-wallet training defaults for Council decisions.
  const fileCabinetPortfolio: PortfolioRiskContext = {
    ...portfolio,
    maxDailyLossPct: 100,
    maxOpenPositions: FILE_CABINET_MAX_OPEN_POSITIONS,
    maxTotalExposurePct: 100,
    maxChainExposurePct: 100,
    liveTradingEnabled: false,
  };

  const councilOptions = {
    mode: "paper",
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
    portfolio: fileCabinetPortfolio,
    runnerGenome,
  } as const;

  const result: WarRoomResult = await runIndependentCouncil(snapshot, {
    ...councilOptions,
    teamProfile: MAIN_FILE_CABINET_PROFILE,
  });

  if (!result.independentCouncil) {
    throw new Error("Independent Council trace missing; refusing legacy synthetic decision");
  }

  await observeCouncilResult(result);
  current.latestResult = result;
  current.recentDecisions = [result, ...current.recentDecisions.filter((row) => row.decisionId !== result.decisionId)].slice(0, MAX_DECISIONS);
  current.lastError = undefined;
  if (result.risk.passed) current.funnel.riskPassed += 1;
  if (result.decision === "BUY") current.funnel.buySignals += 1;
  else if (result.decision === "WATCH") current.funnel.watches += 1;
  else current.funnel.skips += 1;
  await appendDecisionJournal(result);

  const discussion = buildCouncilDiscussion(result);
  for (const turn of discussion) {
    const bot = result.agents.find((agent) => agent.id === turn.agentId)?.name ?? turn.agentId;
    addChat(bot, turn.message, "council");
  }
  addChat("CIO", `${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 local entities aligned. Locked Main File Cabinet rules applied. Wallet equity ${fileCabinetPortfolio.equityUsd.toFixed(2)}.`, "council");

  let executed = false;
  if (result.decision === "BUY") {
    if (!result.risk.passed) recordRejection(result.risk.hardBlocks[0] ?? "Deterministic risk veto");
    else if (result.councilProcess.executorVote === "BLOCK") recordRejection("Executor blocked market feasibility");
    else executed = await autoExecute(result, fileCabinetPortfolio);
  } else {
    recordRejection(`Team File Cabinet Council finished ${result.decision}`);
  }
  if (!executed) addShadowDecision(result);
}

async function runScannerMaintenance() {
  // These tasks are global rather than chain-specific. Run them once per
  // bounded batch so parallel discovery never duplicates wallet locks or
  // research maintenance.
  const bankroll = await ensurePaperWalletResearchFunds();
  if (bankroll.resetPerformed) {
    addChat("System", `Research bankroll automatically restarted at $${bankroll.wallet.startingCashUsd.toFixed(2)} after reaching zero. Reset #${bankroll.resetMeta.resets}; prior losses remain in the research record.`, "system");
  }
  await refreshOneResearchCase(fetchLiveTokenSnapshot);
  await reviewOneShadowDecision();
}

export async function runAutonomousTick() {
  if (globalState.__botWarRoomAutopilotBusyV14) return;
  globalState.__botWarRoomAutopilotBusyV14 = true;
  let releaseLease: (() => Promise<void>) | null = null;
  try {
    releaseLease = await acquireRuntimeLease("autopilot-tick", Math.max(60_000, intervalMs() * 10));
    if (!releaseLease) return;
    await runScannerMaintenance();
    const cursor = globalState.__botWarRoomAutopilotCursorV14 ?? 0;
    const workers = scanWorkers();
    const chains = Array.from({ length: workers }, (_, index) => CHAINS[(cursor + index) % CHAINS.length]);
    globalState.__botWarRoomAutopilotCursorV14 = (cursor + workers) % CHAINS.length;
    // Two bounded lanes overlap provider/Council latency without creating an
    // unbounded worker pool or changing any candidate or safety decision.
    await Promise.all(chains.map((chain) => scanOneChain(chain)));
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
  const current = state();
  current.running = true;
  current.intervalMs = intervalMs();
  current.scanWorkers = scanWorkers();
  current.dataMode = liveMarketDataMode();
  if (globalState.__botWarRoomAutopilotTimerV14) return;

  setTimeout(() => void runAutonomousTick(), 750);
  globalState.__botWarRoomAutopilotTimerV14 = setInterval(() => void runAutonomousTick(), current.intervalMs);
  addChat("System", `Team File Cabinet is promoted to the main paper wallet with its private learned memory intact. Three bounded scan lanes and all wallet utilities are active. Deterministic liquidity, honeypot, sellability, authority and Executor protections remain global.`, "system");
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
  return {
    ...state(),
    paperWallet: bankroll.wallet,
    paperWalletResetMeta: resetMeta,
    providers,
    research,
    positions: positions.sort((a: ManagedPosition, b: ManagedPosition) => b.openedAt.localeCompare(a.openedAt)),
    generatedAt: new Date().toISOString(),
  };
}
