import { buildCouncilDiscussion } from "./debate";
import { executePaper } from "./execution";
import { runWarRoom } from "./engine";
import { resolveAdaptiveWeights, relevantMemoryHints } from "./learning-store";
import { fetchLiveCandidate, liveMarketDataMode } from "./market-data";
import { assessPaperEntryEligibility, ensurePositionGuardianLoop, registerPaperPosition } from "./position-manager";
import { listManagedPositions } from "./position-store";
import { loadLatestProfitability } from "./profitability-store";
import { classifyMarketRegime } from "./regime";
import type { Chain, ManagedPosition, PositionEntryContext, WarRoomResult } from "./types";

const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"];
const DEFAULT_INTERVAL_MS = 5_000;
const MAX_CHAT_ROWS = 80;
const MAX_DECISIONS = 40;

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
  dataMode: "adapter" | "dexscreener";
  intervalMs: number;
  scanningChains: Chain[];
  currentChain: Chain;
  lastScanAt?: string;
  nextScanAt?: string;
  scanCount: number;
  buyCount: number;
  latestResult: WarRoomResult | null;
  recentDecisions: WarRoomResult[];
  chat: AutopilotChatRow[];
  lastError?: string;
};

type AutopilotGlobal = typeof globalThis & {
  __botWarRoomAutopilotTimer?: ReturnType<typeof setInterval>;
  __botWarRoomAutopilotState?: AutopilotStatus;
  __botWarRoomAutopilotBusy?: boolean;
  __botWarRoomAutopilotCursor?: number;
};

const globalState = globalThis as AutopilotGlobal;

function intervalMs() {
  const raw = Number(process.env.WAR_ROOM_SCAN_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Math.max(2_000, Math.min(60_000, Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS));
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
    buyCount: 0,
    latestResult: null,
    recentDecisions: [],
    chat: [],
  };
}

function state() {
  if (!globalState.__botWarRoomAutopilotState) globalState.__botWarRoomAutopilotState = initialState();
  return globalState.__botWarRoomAutopilotState;
}

function addChat(bot: string, message: string, kind: AutopilotChatRow["kind"] = "system", at = new Date().toISOString()) {
  const current = state();
  current.chat = [{ id: `${at}-${bot}-${Math.random().toString(36).slice(2, 8)}`, at, bot, message, kind }, ...current.chat].slice(0, MAX_CHAT_ROWS);
}

function entryContext(result: WarRoomResult): PositionEntryContext {
  const initialAllocationPct = result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1);
  const notional = result.execution.request?.notionalUsd ?? 0;
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
    portfolioEquityUsd: initialAllocationPct > 0 ? notional / (initialAllocationPct / 100) : undefined,
  };
}

async function autoExecute(result: WarRoomResult) {
  if (result.decision !== "BUY" || !result.execution.allowed || !result.execution.request) return;
  if (result.execution.request.mode !== "paper") return;

  const context = entryContext(result);
  const eligibility = await assessPaperEntryEligibility({ request: result.execution.request, snapshot: result.snapshot, entryContext: context });
  if (!eligibility.allowed) {
    addChat("Executor", `Automatic paper entry skipped for $${result.snapshot.symbol}: ${eligibility.reason}`, "execution");
    return;
  }

  const fill = await executePaper(result.execution.request, result.snapshot);
  await registerPaperPosition({
    fill,
    request: result.execution.request,
    snapshot: result.snapshot,
    exitStrategy: result.exitStrategy,
    entryContext: context,
    reentryCount: eligibility.reentryCount,
  });
  state().buyCount += 1;
  addChat("Executor", `AUTO PAPER BUY $${fill.symbol}: $${fill.filledUsd.toFixed(2)} filled at $${fill.fillPrice}. Guardian now owns the position.`, "execution");
}

async function scanOneChain(chain: Chain) {
  const current = state();
  current.currentChain = chain;
  current.lastScanAt = new Date().toISOString();
  current.nextScanAt = new Date(Date.now() + current.intervalMs).toISOString();
  current.dataMode = liveMarketDataMode();

  const snapshot = await fetchLiveCandidate(chain);
  current.scanCount += 1;
  if (!snapshot) {
    addChat("Launch Scout", `${chain}: no qualifying real candidate returned by ${current.dataMode === "adapter" ? "the configured market-data adapter" : "DEX Screener live discovery"}.`, "system");
    return;
  }

  const regime = classifyMarketRegime(snapshot);
  const [learning, memoryHints, profitability] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
  ]);

  const result = runWarRoom(snapshot, {
    mode: "paper",
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
  });

  current.latestResult = result;
  current.recentDecisions = [result, ...current.recentDecisions.filter((row) => row.decisionId !== result.decisionId)].slice(0, MAX_DECISIONS);
  current.lastError = undefined;

  const discussion = buildCouncilDiscussion(result);
  for (const turn of discussion) {
    const bot = result.agents.find((agent) => agent.id === turn.agentId)?.name ?? turn.agentId;
    addChat(bot, turn.message, "council");
  }
  addChat("CIO", `$${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 roles aligned or ready.`, "council");

  await autoExecute(result);
}

export async function runAutonomousTick() {
  if (globalState.__botWarRoomAutopilotBusy) return;
  globalState.__botWarRoomAutopilotBusy = true;
  try {
    const cursor = globalState.__botWarRoomAutopilotCursor ?? 0;
    const chain = CHAINS[cursor % CHAINS.length];
    globalState.__botWarRoomAutopilotCursor = (cursor + 1) % CHAINS.length;
    await scanOneChain(chain);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state().lastError = message;
    addChat("System", `Autonomous cycle error: ${message}`, "system");
    console.error("[autopilot] cycle failed", error);
  } finally {
    globalState.__botWarRoomAutopilotBusy = false;
  }
}

export function ensureAutonomousWarRoom() {
  ensurePositionGuardianLoop();
  const current = state();
  current.running = true;
  current.intervalMs = intervalMs();
  current.dataMode = liveMarketDataMode();
  if (globalState.__botWarRoomAutopilotTimer) return;

  // Start without waiting for a browser click. Railway's long-lived Node process owns this loop.
  setTimeout(() => void runAutonomousTick(), 750);
  globalState.__botWarRoomAutopilotTimer = setInterval(() => void runAutonomousTick(), current.intervalMs);
  addChat("System", `Autonomous War Room started on REAL market data (${current.dataMode}). Paper scanning rotates across ${CHAINS.length} chains every ${Math.round(current.intervalMs / 1000)} seconds; Council-approved BUYs execute automatically.`, "system");
}

export async function getAutopilotStatus() {
  ensureAutonomousWarRoom();
  const positions = await listManagedPositions();
  return {
    ...state(),
    positions: positions.sort((a: ManagedPosition, b: ManagedPosition) => b.openedAt.localeCompare(a.openedAt)).slice(0, 30),
    generatedAt: new Date().toISOString(),
  };
}
