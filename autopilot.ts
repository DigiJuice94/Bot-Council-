import { buildCouncilDiscussion } from "./debate";
import { executePaper } from "./execution";
import { runWarRoom } from "./engine";
import { resolveAdaptiveWeights, relevantMemoryHints } from "./learning-store";
import { fetchLiveCandidate, liveMarketDataMode } from "./market-data";
import { getPaperPortfolioContext, getPaperWallet } from "./paper-wallet";
import { assessPaperEntryEligibility, ensurePositionGuardianLoop, registerPaperPosition } from "./position-manager";
import { listManagedPositions } from "./position-store";
import { loadLatestProfitability } from "./profitability-store";
import { getProviderHealth } from "./provider-health";
import { classifyMarketRegime } from "./regime";
import { appendDecisionJournal } from "./trade-journal";
import type { Chain, ManagedPosition, PortfolioRiskContext, PositionEntryContext, WarRoomResult } from "./types";

const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"];
const DEFAULT_INTERVAL_MS = 2_000;
const MAX_CHAT_ROWS = 100;
const MAX_DECISIONS = 50;

export type AutopilotChatRow = {
  id: string;
  at: string;
  bot: string;
  message: string;
  kind: "council" | "system" | "execution" | "guardian";
};

export type AutopilotStatus = {
  running: boolean;
  mode: "paper";
  dataMode: "adapter" | "birdeye" | "dexscreener";
  intervalMs: number;
  scanningChains: Chain[];
  currentChain: Chain;
  lastScanAt?: string;
  nextScanAt?: string;
  scanCount: number;
  candidateCount: number;
  buyCount: number;
  latestResult: WarRoomResult | null;
  recentDecisions: WarRoomResult[];
  chat: AutopilotChatRow[];
  lastError?: string;
};

type AutopilotGlobal = typeof globalThis & {
  __botWarRoomAutopilotTimerV12?: ReturnType<typeof setInterval>;
  __botWarRoomAutopilotStateV12?: AutopilotStatus;
  __botWarRoomAutopilotBusyV12?: boolean;
  __botWarRoomAutopilotCursorV12?: number;
};
const globalState = globalThis as AutopilotGlobal;

function intervalMs() {
  const raw = Number(process.env.WAR_ROOM_SCAN_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Math.max(1_500, Math.min(60_000, Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS));
}
function initialState(): AutopilotStatus {
  return {
    running: false,
    mode: "paper",
    dataMode: liveMarketDataMode(),
    intervalMs: intervalMs(),
    scanningChains: CHAINS,
    currentChain: CHAINS[0],
    scanCount: 0,
    candidateCount: 0,
    buyCount: 0,
    latestResult: null,
    recentDecisions: [],
    chat: [],
  };
}
function state() {
  if (!globalState.__botWarRoomAutopilotStateV12) globalState.__botWarRoomAutopilotStateV12 = initialState();
  return globalState.__botWarRoomAutopilotStateV12;
}
function addChat(bot: string, message: string, kind: AutopilotChatRow["kind"] = "system", at = new Date().toISOString()) {
  const current = state();
  current.chat = [{ id: `${at}-${bot}-${Math.random().toString(36).slice(2, 8)}`, at, bot, message, kind }, ...current.chat].slice(0, MAX_CHAT_ROWS);
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

async function autoExecute(result: WarRoomResult, portfolio: PortfolioRiskContext) {
  if (result.decision !== "BUY" || !result.execution.allowed || !result.execution.request) return;
  if (result.execution.request.mode !== "paper") return;
  const context = entryContext(result, portfolio);
  const eligibility = await assessPaperEntryEligibility({ request: result.execution.request, snapshot: result.snapshot, entryContext: context });
  if (!eligibility.allowed) {
    addChat("Executor", `AUTO PAPER entry skipped for $${result.snapshot.symbol}: ${eligibility.reason}`, "execution");
    return;
  }

  try {
    const fill = await executePaper(result.execution.request, result.snapshot);
    const position = await registerPaperPosition({
      fill,
      request: result.execution.request,
      snapshot: result.snapshot,
      exitStrategy: result.exitStrategy,
      entryContext: context,
      reentryCount: eligibility.reentryCount,
    });
    state().buyCount += 1;
    addChat("Executor", `AUTO PAPER BUY $${fill.symbol}: $${fill.requestedUsd.toFixed(2)} committed at $${fill.fillPrice}. ${fill.routeVerified ? "Live route verified." : "Route unverified; liquidity model used."} Guardian owns ${position?.id ?? "the position"}.`, "execution");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addChat("Executor", `Paper route rejected for $${result.snapshot.symbol}: ${message}`, "execution");
  }
}

async function scanOneChain(chain: Chain) {
  const current = state();
  current.currentChain = chain;
  current.lastScanAt = new Date().toISOString();
  current.nextScanAt = new Date(Date.now() + current.intervalMs).toISOString();
  current.dataMode = liveMarketDataMode();
  current.scanCount += 1;

  const snapshot = await fetchLiveCandidate(chain);
  if (!snapshot) {
    if (current.scanCount % CHAINS.length === 0) {
      const source = current.dataMode === "birdeye" ? "Birdeye New Listings + DEX enrichment" : current.dataMode === "adapter" ? "the configured market adapter" : "DEX Screener live discovery";
      addChat("Launch Scout", `${chain}: no new qualifying real candidate from ${source}. Continuing automatically.`, "system");
    }
    return;
  }
  current.candidateCount += 1;

  const regime = classifyMarketRegime(snapshot);
  const [learning, memoryHints, profitability, portfolio] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
    getPaperPortfolioContext(snapshot.chain),
  ]);

  const result = runWarRoom(snapshot, {
    mode: "paper",
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
    portfolio,
  });

  current.latestResult = result;
  current.recentDecisions = [result, ...current.recentDecisions.filter((row) => row.decisionId !== result.decisionId)].slice(0, MAX_DECISIONS);
  current.lastError = undefined;
  await appendDecisionJournal(result);

  const discussion = buildCouncilDiscussion(result);
  for (const turn of discussion) {
    const bot = result.agents.find((agent) => agent.id === turn.agentId)?.name ?? turn.agentId;
    addChat(bot, turn.message, "council");
  }
  addChat("CIO", `$${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 roles aligned/ready. Wallet equity $${portfolio.equityUsd.toFixed(2)}.`, "council");
  await autoExecute(result, portfolio);
}

export async function runAutonomousTick() {
  if (globalState.__botWarRoomAutopilotBusyV12) return;
  globalState.__botWarRoomAutopilotBusyV12 = true;
  try {
    const cursor = globalState.__botWarRoomAutopilotCursorV12 ?? 0;
    const chain = CHAINS[cursor % CHAINS.length];
    globalState.__botWarRoomAutopilotCursorV12 = (cursor + 1) % CHAINS.length;
    await scanOneChain(chain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state().lastError = message;
    addChat("System", `Autonomous cycle error: ${message}`, "system");
    console.error("[autopilot] cycle failed", error);
  } finally {
    globalState.__botWarRoomAutopilotBusyV12 = false;
  }
}

export function ensureAutonomousWarRoom() {
  ensurePositionGuardianLoop();
  const current = state();
  current.running = true;
  current.intervalMs = intervalMs();
  current.dataMode = liveMarketDataMode();
  if (globalState.__botWarRoomAutopilotTimerV12) return;

  setTimeout(() => void runAutonomousTick(), 750);
  globalState.__botWarRoomAutopilotTimerV12 = setInterval(() => void runAutonomousTick(), current.intervalMs);
  const source = current.dataMode === "birdeye" ? "Birdeye New Listings → DEX Screener enrichment" : current.dataMode;
  addChat("System", `V2.12 autonomous REAL-DATA paper trader started: ${source}. $${Number(process.env.PAPER_STARTING_CASH_USD ?? 1000).toFixed(0)} paper wallet; six-chain rotation; Council-approved BUYs execute without human input.`, "system");
}

export async function getAutopilotStatus() {
  ensureAutonomousWarRoom();
  const [positions, paperWallet] = await Promise.all([listManagedPositions(), getPaperWallet()]);
  state().buyCount = paperWallet.buyFills;
  return {
    ...state(),
    paperWallet,
    providers: getProviderHealth(),
    positions: positions.sort((a: ManagedPosition, b: ManagedPosition) => b.openedAt.localeCompare(a.openedAt)).slice(0, 50),
    generatedAt: new Date().toISOString(),
  };
}
