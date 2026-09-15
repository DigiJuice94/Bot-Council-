import { createClient } from "redis";
import { DEFAULT_AGENT_WEIGHTS, normalizeResearchWeights, weightsFromPerformance } from "./learning";
import { applyRegimeWeightBias } from "./regime";
import type { AgentMemoryRecord, AgentPerformance, Chain, LearningSnapshot, MarketRegime, MarketRegimeId, MarketSnapshot, ResearchAgentId, ResearchAgentWeights } from "./types";

const PERFORMANCE_KEY = "bot-war-room:agent-performance:v212-real-paper";
const MEMORY_KEY = "bot-war-room:agent-memory:v212-real-paper";
const memoryPerformance = new Map<string, AgentPerformance>();
const memoryRecords = new Map<string, AgentMemoryRecord>();
let redisPromise: Promise<any | null> | null = null;

const agentIds: ResearchAgentId[] = ["launch", "social", "wallet", "quant", "contract", "bear"];

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[learning-store] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[learning-store] falling back to memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

const regimeSegment = (regimeId: MarketRegimeId) => `regime:${regimeId}`;
const detailedSegment = (regimeId: MarketRegimeId, chain: Chain, marketCapBucket: string, ageBucket: string) => `segment:${regimeId}:${chain}:${marketCapBucket}:${ageBucket}`;
const performanceId = (segmentKey: string, agentId: ResearchAgentId) => `${segmentKey}:${agentId}`;

async function loadPerformance(segmentKey: string, regimeId: MarketRegimeId): Promise<AgentPerformance[]> {
  const redis = await getRedis();
  const output: AgentPerformance[] = [];
  for (const agentId of agentIds) {
    const id = performanceId(segmentKey, agentId);
    let row = memoryPerformance.get(id);
    if (redis) {
      const raw = await redis.hGet(PERFORMANCE_KEY, id);
      if (raw) row = JSON.parse(raw) as AgentPerformance;
    }
    if (row && row.regimeId === regimeId) output.push(row);
  }
  return output;
}

export async function resolveAdaptiveWeights(regime: MarketRegime, snapshot?: MarketSnapshot): Promise<{ weights: ResearchAgentWeights; source: "defaults" | "regime" | "learned"; performance: AgentPerformance[] }> {
  const buckets = snapshot ? snapshotBuckets(snapshot) : null;
  const detailKey = snapshot && buckets ? detailedSegment(regime.id, snapshot.chain, buckets.marketCapBucket, buckets.ageBucket) : null;
  const detailed = detailKey ? await loadPerformance(detailKey, regime.id) : [];
  const regimeRows = await loadPerformance(regimeSegment(regime.id), regime.id);
  const detailedReady = detailed.some((row) => row.observations >= 30);
  const regimeReady = regimeRows.some((row) => row.observations >= 30);
  const selected = detailedReady ? detailed : regimeReady ? regimeRows : [];
  const base = selected.length ? weightsFromPerformance(selected) : DEFAULT_AGENT_WEIGHTS;
  const weights = applyRegimeWeightBias(normalizeResearchWeights(base), regime);
  return {
    weights,
    source: selected.length ? "learned" : regime.id === "risk_on_trend" ? "defaults" : "regime",
    performance: selected.length ? selected : detailed.length ? detailed : regimeRows,
  };
}

async function updatePerformanceRow(args: {
  agentId: ResearchAgentId;
  regimeId: MarketRegimeId;
  segmentKey: string;
  directionalCorrect: boolean;
  reasoningSupported: boolean | null;
  edgePct: number;
}) {
  const { agentId, regimeId, segmentKey, directionalCorrect, reasoningSupported, edgePct } = args;
  const id = performanceId(segmentKey, agentId);
  const existing = (await loadPerformance(segmentKey, regimeId)).find((row) => row.agentId === agentId);
  const observations = (existing?.observations ?? 0) + 1;
  const correct = (existing?.correct ?? 0) + (directionalCorrect ? 1 : 0);
  const priorReasoningCorrect = (existing?.reasoningAccuracyPct ?? 50) / 100 * (existing?.observations ?? 0);
  const reasoningCorrect = priorReasoningCorrect + (reasoningSupported === true ? 1 : reasoningSupported === null ? 0.5 : 0);
  const priorEdgeTotal = (existing?.avgEdgePct ?? 0) * (existing?.observations ?? 0);
  const avgEdgePct = (priorEdgeTotal + edgePct) / observations;
  const row: AgentPerformance = {
    agentId,
    regimeId,
    segmentKey,
    observations,
    correct,
    directionalAccuracyPct: Number((correct / observations * 100).toFixed(2)),
    reasoningAccuracyPct: Number((reasoningCorrect / observations * 100).toFixed(2)),
    avgEdgePct: Number(avgEdgePct.toFixed(3)),
    weight: existing?.weight ?? DEFAULT_AGENT_WEIGHTS[agentId],
  };
  memoryPerformance.set(id, row);
  const redis = await getRedis();
  if (redis) await redis.hSet(PERFORMANCE_KEY, id, JSON.stringify(row));
}

export async function recordAgentPerformance(args: {
  agentId: ResearchAgentId;
  regimeId: MarketRegimeId;
  chain: Chain;
  marketCapBucket: string;
  ageBucket: string;
  directionalCorrect: boolean;
  reasoningSupported: boolean | null;
  edgePct: number;
}) {
  const regimeKey = regimeSegment(args.regimeId);
  const detailKey = detailedSegment(args.regimeId, args.chain, args.marketCapBucket, args.ageBucket);
  await Promise.all([
    updatePerformanceRow({ ...args, segmentKey: regimeKey }),
    updatePerformanceRow({ ...args, segmentKey: detailKey }),
  ]);
}

export async function saveAgentMemory(record: AgentMemoryRecord) {
  memoryRecords.set(record.id, record);
  const redis = await getRedis();
  if (redis) {
    await redis.hSet(MEMORY_KEY, record.id, JSON.stringify(record));
    const count = await redis.hLen(MEMORY_KEY);
    if (count > 1200) {
      const rows = await redis.hGetAll(MEMORY_KEY) as Record<string, string>;
      const ordered = Object.entries(rows)
        .map(([id, value]) => ({ id, row: JSON.parse(value) as AgentMemoryRecord }))
        .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt));
      for (const old of ordered.slice(0, count - 1000)) await redis.hDel(MEMORY_KEY, old.id);
    }
  }
}

function marketCapBucket(marketCap: number) {
  if (marketCap < 100_000) return "micro-100k";
  if (marketCap < 500_000) return "micro-500k";
  if (marketCap < 2_000_000) return "small-2m";
  if (marketCap < 10_000_000) return "small-10m";
  return "large";
}

function ageBucket(ageMinutes: number) {
  if (ageMinutes < 30) return "under-30m";
  if (ageMinutes < 180) return "under-3h";
  if (ageMinutes < 1440) return "under-1d";
  return "established";
}

export function snapshotBuckets(snapshot: MarketSnapshot) {
  return { marketCapBucket: marketCapBucket(snapshot.marketCap), ageBucket: ageBucket(snapshot.ageMinutes) };
}

async function allMemories(): Promise<AgentMemoryRecord[]> {
  const redis = await getRedis();
  if (!redis) return [...memoryRecords.values()];
  const rows = await redis.hGetAll(MEMORY_KEY) as Record<string, string>;
  return Object.values(rows).map((value) => JSON.parse(value) as AgentMemoryRecord);
}

export async function relevantMemoryHints(snapshot: MarketSnapshot, regimeId: MarketRegimeId, limit = 3): Promise<Partial<Record<ResearchAgentId, string[]>>> {
  const records = await allMemories();
  const buckets = snapshotBuckets(snapshot);
  const hints: Partial<Record<ResearchAgentId, string[]>> = {};

  for (const agentId of agentIds) {
    const ranked = records
      .filter((row) => row.agentId === agentId)
      .map((row) => {
        let similarity = 0;
        if (row.regimeId === regimeId) similarity += 4;
        if (row.chain === snapshot.chain) similarity += 3;
        if (row.marketCapBucket === buckets.marketCapBucket) similarity += 2;
        if (row.ageBucket === buckets.ageBucket) similarity += 2;
        if (row.reasoningOutcome === "supported") similarity += 0.5;
        return { row, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity || b.row.createdAt.localeCompare(a.row.createdAt))
      .slice(0, limit);
    if (ranked.length) hints[agentId] = ranked.map(({ row }) => `${row.lesson} Similar trade returned ${row.realizedReturnPct >= 0 ? "+" : ""}${row.realizedReturnPct.toFixed(1)}%.`);
  }
  return hints;
}

export async function getLearningSnapshot(regime: MarketRegime, snapshot?: MarketSnapshot): Promise<LearningSnapshot> {
  const resolved = await resolveAdaptiveWeights(regime, snapshot);
  const records = await allMemories();
  const recent = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekly = recent.filter((row) => new Date(row.createdAt).getTime() >= oneWeekAgo);
  const weeklyFeedback = agentIds.map((agentId) => {
    const rows = weekly.filter((row) => row.agentId === agentId && row.regimeId === regime.id);
    if (!rows.length) return `${agentId}: no closed-trade feedback in the last 7 days for ${regime.label}.`;
    const supported = rows.filter((row) => row.reasoningOutcome === "supported").length;
    const avg = rows.reduce((sum, row) => sum + row.realizedReturnPct, 0) / rows.length;
    return `${agentId}: ${supported}/${rows.length} reads supported; similar trades averaged ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%.`;
  });
  return {
    storage: (await getRedis()) ? "redis" : "memory",
    regimeId: regime.id,
    weights: resolved.weights,
    performance: resolved.performance,
    memories: records.length,
    recentLessons: recent.slice(0, 8).map((row) => `${row.agentId}: ${row.lesson}`),
    weeklyFeedback,
    generatedAt: new Date().toISOString(),
  };
}
