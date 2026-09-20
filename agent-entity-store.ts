import { createClient } from "redis";
import type { CouncilEntityId, IndependentEntityOpinion, ManagedPosition } from "./types";

const PREFIX = "bot-war-room:entity-memory:v226";
const MAX_MEMORY = 60;

export type EntityMemoryRecord = {
  id: string;
  agentId: CouncilEntityId;
  kind: "decision" | "outcome" | "trajectory";
  createdAt: string;
  symbol: string;
  chain: string;
  decisionId: string;
  vote?: "BUY" | "WATCH" | "SKIP";
  confidence?: number;
  thesis?: string;
  realizedReturnPct?: number;
  realizedPnlUsd?: number;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
  profitCapturePct?: number;
  trajectoryPhase?: string;
  trajectoryScore?: number;
  trajectoryDumperRiskScore?: number;
  trajectoryOutcome?: "runner" | "dumper";
  lesson: string;
};

let redisPromise: Promise<any | null> | null = null;
const memoryFallback = new Map<string, EntityMemoryRecord[]>();
const fallbackOutcomeSet = new Set<string>();

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[entity-memory] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[entity-memory] redis unavailable; using process memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

function cleanNamespace(namespace = "main") {
  return namespace.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 100) || "main";
}

function key(agentId: CouncilEntityId, namespace = "main") {
  return `${PREFIX}:${cleanNamespace(namespace)}:${agentId}`;
}

function outcomeKey(namespace = "main") {
  return `${PREFIX}:${cleanNamespace(namespace)}:recorded-outcomes`;
}

export async function loadPrivateEntityMemory(agentId: CouncilEntityId, limit = 10, namespace = "main"): Promise<EntityMemoryRecord[]> {
  const redis = await getRedis();
  const memoryKey = key(agentId, namespace);
  if (!redis) return (memoryFallback.get(memoryKey) ?? []).slice(0, limit);
  const rows = await redis.lRange(memoryKey, 0, Math.max(0, limit - 1));
  return rows.flatMap((raw: string) => {
    try { return [JSON.parse(raw) as EntityMemoryRecord]; } catch { return []; }
  });
}

export async function appendPrivateEntityMemory(record: EntityMemoryRecord, namespace = "main") {
  const redis = await getRedis();
  const memoryKey = key(record.agentId, namespace);
  if (!redis) {
    const current = memoryFallback.get(memoryKey) ?? [];
    memoryFallback.set(memoryKey, [record, ...current.filter((row) => row.id !== record.id)].slice(0, MAX_MEMORY));
    return;
  }
  await redis.lPush(memoryKey, JSON.stringify(record));
  await redis.lTrim(memoryKey, 0, MAX_MEMORY - 1);
}

export async function recordEntityDecision(args: {
  decisionId: string;
  symbol: string;
  chain: string;
  opinions: IndependentEntityOpinion[];
  namespace?: string;
}) {
  await Promise.all(args.opinions.map((opinion) => appendPrivateEntityMemory({
    id: `${args.decisionId}:${opinion.agentId}:decision`,
    agentId: opinion.agentId,
    kind: "decision",
    createdAt: opinion.formedAt,
    symbol: args.symbol,
    chain: args.chain,
    decisionId: args.decisionId,
    vote: opinion.vote,
    confidence: opinion.confidence,
    thesis: opinion.thesis,
    lesson: `${opinion.vote} at ${opinion.confidence}% confidence. ${opinion.thesis}`.slice(0, 700),
  }, args.namespace)));
}

async function outcomeAlreadyRecorded(positionId: string, namespace = "main") {
  const redis = await getRedis();
  const scopedId = `${cleanNamespace(namespace)}:${positionId}`;
  if (!redis) return fallbackOutcomeSet.has(scopedId);
  return Boolean(await redis.sIsMember(outcomeKey(namespace), positionId));
}

async function markOutcomeRecorded(positionId: string, namespace = "main") {
  const redis = await getRedis();
  if (!redis) {
    fallbackOutcomeSet.add(`${cleanNamespace(namespace)}:${positionId}`);
    return;
  }
  await redis.sAdd(outcomeKey(namespace), positionId);
}

export async function recordIndependentCouncilOutcome(position: ManagedPosition) {
  const council = position.entryContext?.independentCouncil;
  if (!council || (position.status !== "closed" && position.status !== "unsellable")) return;
  const namespace = council.memoryNamespace ?? "main";
  if (await outcomeAlreadyRecorded(position.id, namespace)) return;

  const finalOpinions = council.meetingOpinions.length ? council.meetingOpinions : council.initialOpinions;
  const outcomeGood = position.realizedPnlUsd > 0;
  const outcomeLabel = outcomeGood ? "WIN" : position.realizedPnlUsd < 0 ? "LOSS" : "FLAT";

  const all = [...finalOpinions, council.cioOpinion];
  await Promise.all(all.map((opinion) => {
    const supportedTrade = opinion.vote === "BUY" || opinion.vote === "WATCH";
    const wasDirectionallyRight = outcomeGood ? supportedTrade : !supportedTrade;
    const lesson = [
      `${outcomeLabel} on $${position.symbol}: ${position.pnlPct.toFixed(2)}% / $${position.realizedPnlUsd.toFixed(2)}.`,
      `This entity voted ${opinion.vote} at ${opinion.confidence}% confidence.`,
      wasDirectionallyRight ? "Direction was supported by the eventual outcome." : "Direction was not supported by the eventual outcome.",
      `MFE ${position.maxFavorableExcursionPct.toFixed(1)}% · MAE ${position.maxAdverseExcursionPct.toFixed(1)}% · capture ${position.profitCapturePct.toFixed(1)}%.`,
      `Exit: ${position.lastReason}`,
    ].join(" ");

    return appendPrivateEntityMemory({
      id: `${position.id}:${opinion.agentId}:outcome`,
      agentId: opinion.agentId,
      kind: "outcome",
      createdAt: position.closedAt ?? position.updatedAt,
      symbol: position.symbol,
      chain: position.chain,
      decisionId: position.decisionId,
      vote: opinion.vote,
      confidence: opinion.confidence,
      thesis: opinion.thesis,
      realizedReturnPct: position.pnlPct,
      realizedPnlUsd: position.realizedPnlUsd,
      maxFavorableExcursionPct: position.maxFavorableExcursionPct,
      maxAdverseExcursionPct: position.maxAdverseExcursionPct,
      profitCapturePct: position.profitCapturePct,
      lesson: lesson.slice(0, 1_200),
    }, namespace);
  }));

  await markOutcomeRecorded(position.id, namespace);
}

export async function recordTournamentEntityOutcome(args: {
  namespace: string;
  positionId: string;
  symbol: string;
  chain: string;
  decisionId: string;
  realizedPnlUsd: number;
  realizedReturnPct: number;
  closedAt: string;
  exitReason: string;
  opinions: Array<{ agentId: CouncilEntityId; vote: "BUY" | "WATCH" | "SKIP"; confidence: number; score: number }>;
}) {
  if (await outcomeAlreadyRecorded(args.positionId, args.namespace)) return;
  const outcomeLabel = args.realizedPnlUsd > 0 ? "WIN" : args.realizedPnlUsd < 0 ? "LOSS" : "FLAT";
  await Promise.all(args.opinions.map((opinion) => appendPrivateEntityMemory({
    id: `${args.positionId}:${opinion.agentId}:outcome`,
    agentId: opinion.agentId,
    kind: "outcome",
    createdAt: args.closedAt,
    symbol: args.symbol,
    chain: args.chain,
    decisionId: args.decisionId,
    vote: opinion.vote,
    confidence: opinion.confidence,
    realizedReturnPct: args.realizedReturnPct,
    realizedPnlUsd: args.realizedPnlUsd,
    lesson: `${outcomeLabel} on $${args.symbol}: ${args.realizedReturnPct.toFixed(2)}% / $${args.realizedPnlUsd.toFixed(2)}. This independent team member voted ${opinion.vote} at ${opinion.confidence}% with score ${opinion.score}. Exit: ${args.exitReason}`.slice(0, 1_200),
  }, args.namespace)));
  await markOutcomeRecorded(args.positionId, args.namespace);
}
