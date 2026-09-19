import { createClient } from "redis";
import type { ClaudeSurvivalAgentId, ClaudeSurvivalCouncilTrace, ClaudeSurvivalOpinion, ManagedPosition } from "./types";

const PREFIX = "bot-war-room:claude-survival:v360-risk-reaper";
const OUTCOME_SET_KEY = `${PREFIX}:settled-positions`;

export type ClaudeSurvivalState = "alive" | "probation" | "dead";

export type ClaudeSurvivalLedger = {
  agentId: ClaudeSurvivalAgentId;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  apiCostUsd: number;
  settledTrades: number;
  wins: number;
  losses: number;
  attributedValueUsd: number;
  netValueUsd: number;
  state: ClaudeSurvivalState;
  updatedAt: string;
};

let redisPromise: Promise<any | null> | null = null;
const fallback = new Map<ClaudeSurvivalAgentId, ClaudeSurvivalLedger>();
const settledFallback = new Set<string>();

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[claude-survival] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[claude-survival] redis unavailable; using process memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

function fresh(agentId: ClaudeSurvivalAgentId): ClaudeSurvivalLedger {
  return {
    agentId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    apiCostUsd: 0,
    settledTrades: 0,
    wins: 0,
    losses: 0,
    attributedValueUsd: 0,
    netValueUsd: 0,
    state: "alive",
    updatedAt: new Date().toISOString(),
  };
}

function key(agentId: ClaudeSurvivalAgentId) {
  return `${PREFIX}:ledger:${agentId}`;
}

function thresholds() {
  const probationTrades = Math.max(3, Number(process.env.CLAUDE_SURVIVAL_PROBATION_TRADES ?? 10));
  const deathTrades = Math.max(probationTrades + 1, Number(process.env.CLAUDE_SURVIVAL_DEATH_TRADES ?? 20));
  const minNetUsd = Number(process.env.CLAUDE_SURVIVAL_MIN_NET_USD ?? 0);
  return { probationTrades, deathTrades, minNetUsd };
}

function recalc(row: ClaudeSurvivalLedger): ClaudeSurvivalLedger {
  const { probationTrades, deathTrades, minNetUsd } = thresholds();
  const netValueUsd = row.attributedValueUsd - row.apiCostUsd;
  let state: ClaudeSurvivalState = "alive";
  if (row.settledTrades >= deathTrades && netValueUsd < minNetUsd) state = "dead";
  else if (row.settledTrades >= probationTrades && netValueUsd < minNetUsd) state = "probation";
  return { ...row, netValueUsd: Number(netValueUsd.toFixed(6)), state, updatedAt: new Date().toISOString() };
}

export async function loadClaudeSurvivalLedger(agentId: ClaudeSurvivalAgentId): Promise<ClaudeSurvivalLedger> {
  const redis = await getRedis();
  if (!redis) return fallback.get(agentId) ?? fresh(agentId);
  const raw = await redis.get(key(agentId));
  if (!raw) return fresh(agentId);
  try { return recalc(JSON.parse(raw) as ClaudeSurvivalLedger); } catch { return fresh(agentId); }
}

async function saveLedger(row: ClaudeSurvivalLedger) {
  const next = recalc(row);
  const redis = await getRedis();
  if (!redis) {
    fallback.set(next.agentId, next);
    return next;
  }
  await redis.set(key(next.agentId), JSON.stringify(next));
  return next;
}

export async function recordClaudeApiSpend(agentId: ClaudeSurvivalAgentId, inputTokens: number, outputTokens: number, estimatedCostUsd: number) {
  const row = await loadClaudeSurvivalLedger(agentId);
  return saveLedger({
    ...row,
    calls: row.calls + 1,
    inputTokens: row.inputTokens + Math.max(0, inputTokens),
    outputTokens: row.outputTokens + Math.max(0, outputTokens),
    apiCostUsd: row.apiCostUsd + Math.max(0, estimatedCostUsd),
  });
}

export async function recordClaudeApiUsage(opinion: ClaudeSurvivalOpinion) {
  return recordClaudeApiSpend(opinion.agentId, opinion.inputTokens, opinion.outputTokens, opinion.estimatedCostUsd);
}

async function alreadySettled(positionId: string) {
  const redis = await getRedis();
  if (!redis) return settledFallback.has(positionId);
  return Boolean(await redis.sIsMember(OUTCOME_SET_KEY, positionId));
}

async function markSettled(positionId: string) {
  const redis = await getRedis();
  if (!redis) {
    settledFallback.add(positionId);
    return;
  }
  await redis.sAdd(OUTCOME_SET_KEY, positionId);
}

function allOpinions(trace: ClaudeSurvivalCouncilTrace) {
  // V3.6 only scores the surviving Risk Reaper seat. Legacy traces may still
  // contain retired seats, but they no longer receive calls or outcome credit.
  return trace.specialists.filter((opinion) => opinion.agentId === "risk_reaper");
}

function attributedValue(opinion: ClaudeSurvivalOpinion, realizedPnlUsd: number) {
  // Directional attribution, not a claim of exact counterfactual P/L.
  // VETO earns credit for correctly opposing losses and is penalized for opposing
  // winners. PASS receives only a small attribution because it preserved the local call.
  if (opinion.vote === "VETO") return -realizedPnlUsd;
  return realizedPnlUsd * 0.15;
}

export async function recordClaudeSurvivalOutcome(position: ManagedPosition) {
  const trace = position.entryContext?.claudeSurvivalCouncil;
  if (!trace || (position.status !== "closed" && position.status !== "unsellable")) return;
  if (await alreadySettled(position.id)) return;

  await Promise.all(allOpinions(trace).map(async (opinion) => {
    const row = await loadClaudeSurvivalLedger(opinion.agentId);
    const value = attributedValue(opinion, position.realizedPnlUsd);
    await saveLedger({
      ...row,
      settledTrades: row.settledTrades + 1,
      wins: row.wins + (value > 0 ? 1 : 0),
      losses: row.losses + (value < 0 ? 1 : 0),
      attributedValueUsd: row.attributedValueUsd + value,
    });
  }));

  await markSettled(position.id);
}

export async function getClaudeSurvivalScoreboard() {
  return [await loadClaudeSurvivalLedger("risk_reaper")];
}
