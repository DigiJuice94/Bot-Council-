import { createClient } from "redis";
import type { ProfitabilityMetrics } from "./types";

const KEY = "bot-war-room:profitability:v212-real-paper";
let memoryLatest: ProfitabilityMetrics | null = null;
let redisPromise: Promise<any | null> | null = null;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[profitability-store] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[profitability-store] memory fallback", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

export async function saveLatestProfitability(metrics: ProfitabilityMetrics) {
  memoryLatest = metrics;
  const redis = await getRedis();
  if (redis) await redis.set(KEY, JSON.stringify(metrics));
}

export async function loadLatestProfitability(): Promise<ProfitabilityMetrics | null> {
  const redis = await getRedis();
  if (!redis) return memoryLatest;
  const raw = await redis.get(KEY);
  return raw ? JSON.parse(raw) as ProfitabilityMetrics : memoryLatest;
}
