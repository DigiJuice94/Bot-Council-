import { createClient } from "redis";
import type { CouncilEntityId, IndependentEntityOpinion, ManagedPosition } from "./types";

const PREFIX = "bot-war-room:entity-memory:v226";
const OUTCOME_SET_KEY = `${PREFIX}:recorded-outcomes`;
const MAX_MEMORY = 60;

export type EntityMemoryRecord = {
  id: string;
  agentId: CouncilEntityId;
  kind: "decision" | "outcome";
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
  lesson: string;
};

let redisPromise: Promise<any | null> | null = null;
const memoryFallback = new Map<CouncilEntityId, EntityMemoryRecord[]>();
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

function key(agentId: CouncilEntityId) {
  return `${PREFIX}:${agentId}`;
}

export async function loadPrivateEntityMemory(agentId: CouncilEntityId, limit = 10): Promise<EntityMemoryRecord[]> {
  const redis = await getRedis();
  if (!redis) return (memoryFallback.get(agentId) ?? []).slice(0, limit);
  const rows = await redis.lRange(key(agentId), 0, Math.max(0, limit - 1));
  return rows.flatMap((raw: string) => {
    try { return [JSON.parse(raw) as EntityMemoryRecord]; } catch { return []; }
  });
}

export async function appendPrivateEntityMemory(record: EntityMemoryRecord) {
  const redis = await getRedis();
  if (!redis) {
    const current = memoryFallback.get(record.agentId) ?? [];
    memoryFallback.set(record.agentId, [record, ...current.filter((row) => row.id !== record.id)].slice(0, MAX_MEMORY));
    return;
  }
  await redis.lPush(key(record.agentId), JSON.stringify(record));
  await redis.lTrim(key(record.agentId), 0, MAX_MEMORY - 1);
}

export async function recordEntityDecision(args: {
  decisionId: string;
  symbol: string;
  chain: string;
  opinions: IndependentEntityOpinion[];
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
  })));
}

async function outcomeAlreadyRecorded(positionId: string) {
  const redis = await getRedis();
  if (!redis) return fallbackOutcomeSet.has(positionId);
  return Boolean(await redis.sIsMember(OUTCOME_SET_KEY, positionId));
}

async function markOutcomeRecorded(positionId: string) {
  const redis = await getRedis();
  if (!redis) {
    fallbackOutcomeSet.add(positionId);
    return;
  }
  await redis.sAdd(OUTCOME_SET_KEY, positionId);
}

export async function recordIndependentCouncilOutcome(position: ManagedPosition) {
  const council = position.entryContext?.independentCouncil;
  if (!council || position.status !== "closed") return;
  if (await outcomeAlreadyRecorded(position.id)) return;

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
    });
  }));

  await markOutcomeRecorded(position.id);
}
