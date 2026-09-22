import { createClient } from "redis";
import { markProviderFailure, markProviderSuccess } from "./provider-health";
import type { PaperFill, WarRoomResult } from "./types";

const DECISION_KEY = "bot-war-room:decision-journal:v1-real-market";
const FILL_KEY = "bot-war-room:fill-journal:v1-real-market";
const MAX_ROWS = 1000;

type JournalGlobal = typeof globalThis & {
  __bwrJournalRedis?: Promise<any | null>;
  __bwrDecisionJournal?: any[];
  __bwrFillJournal?: any[];
};
const state = globalThis as JournalGlobal;

async function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!state.__bwrJournalRedis) {
    state.__bwrJournalRedis = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => markProviderFailure("redis", error));
        await client.connect();
        markProviderSuccess("redis");
        return client;
      } catch (error) {
        markProviderFailure("redis", error);
        return null;
      }
    })();
  }
  return state.__bwrJournalRedis;
}

function decisionRecord(result: WarRoomResult) {
  return {
    decisionId: result.decisionId,
    at: result.generatedAt,
    chain: result.snapshot.chain,
    tokenAddress: result.snapshot.tokenAddress,
    symbol: result.snapshot.symbol,
    price: result.snapshot.price,
    marketCap: result.snapshot.marketCap,
    liquidity: result.snapshot.liquidity,
    volume24h: result.snapshot.volume24h,
    ageMinutes: result.snapshot.ageMinutes,
    decision: result.decision,
    conviction: result.conviction,
    council: result.councilProcess,
    alpha: { score: result.alpha.score, action: result.alpha.action },
    regime: result.regime.id,
    memeRegime: result.memeRegime.id,
    risk: result.risk,
    execution: result.execution,
    dataProvenance: result.snapshot.dataProvenance,
  };
}

export async function appendDecisionJournal(result: WarRoomResult) {
  const record = decisionRecord(result);
  const redis = await redisClient();
  if (redis) {
    await redis.lPush(DECISION_KEY, JSON.stringify(record));
    await redis.lTrim(DECISION_KEY, 0, MAX_ROWS - 1);
  } else {
    state.__bwrDecisionJournal = [record, ...(state.__bwrDecisionJournal ?? [])].slice(0, MAX_ROWS);
  }
}

export async function appendFillJournal(fill: PaperFill, tokenAddress: string, positionId?: string) {
  const record = { ...fill, tokenAddress, positionId };
  const redis = await redisClient();
  if (redis) {
    await redis.lPush(FILL_KEY, JSON.stringify(record));
    await redis.lTrim(FILL_KEY, 0, MAX_ROWS - 1);
  } else {
    state.__bwrFillJournal = [record, ...(state.__bwrFillJournal ?? [])].slice(0, MAX_ROWS);
  }
}

async function readList(key: string, memory: any[], limit: number) {
  const redis = await redisClient();
  if (!redis) return memory.slice(0, limit);
  const rows = await redis.lRange(key, 0, Math.max(0, limit - 1));
  return rows.flatMap((raw: string) => { try { return [JSON.parse(raw)]; } catch { return []; } });
}

export async function getTradeJournal(limit = 100) {
  const safeLimit = Math.max(1, Math.min(MAX_ROWS, Math.round(limit)));
  const [decisions, fills] = await Promise.all([
    readList(DECISION_KEY, state.__bwrDecisionJournal ?? [], safeLimit),
    readList(FILL_KEY, state.__bwrFillJournal ?? [], safeLimit),
  ]);
  return { decisions, fills, decisionCountShown: decisions.length, fillCountShown: fills.length, generatedAt: new Date().toISOString() };
}
