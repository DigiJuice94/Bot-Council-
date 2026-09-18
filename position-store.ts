import { createClient } from "redis";
import type { ManagedPosition } from "./types";

const REDIS_KEY = "bot-war-room:positions:v3-live-paper";
const memory = new Map<string, ManagedPosition>();
const memoryLeases = new Set<string>();
let redisPromise: Promise<any | null> | null = null;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[position-store] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[position-store] falling back to memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

export async function positionStorageMode(): Promise<"redis" | "memory"> {
  return (await getRedis()) ? "redis" : "memory";
}

export async function listManagedPositions(): Promise<ManagedPosition[]> {
  const redis = await getRedis();
  if (!redis) return [...memory.values()];
  const rows = await redis.hGetAll(REDIS_KEY) as Record<string, string>;
  return Object.values(rows).map((value) => JSON.parse(value) as ManagedPosition);
}

export async function saveManagedPosition(position: ManagedPosition): Promise<void> {
  memory.set(position.id, position);
  const redis = await getRedis();
  if (redis) await redis.hSet(REDIS_KEY, position.id, JSON.stringify(position));
}

export async function removeManagedPosition(positionId: string): Promise<void> {
  memory.delete(positionId);
  const redis = await getRedis();
  if (redis) await redis.hDel(REDIS_KEY, positionId);
}

/**
 * Prevent two Guardian/autopilot workers from executing the same PAPER action.
 * The Redis lease also protects deployments that briefly have two Railway
 * containers alive during a rollout. The returned release function only
 * releases the lease owned by this caller.
 */
export async function acquireRuntimeLease(name: string, ttlMs = 120_000): Promise<(() => Promise<void>) | null> {
  const leaseName = name.replace(/[^a-zA-Z0-9:_-]/g, "_");
  const key = `bot-war-room:runtime-lease:${leaseName}`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const redis = await getRedis();

  if (!redis) {
    if (memoryLeases.has(key)) return null;
    memoryLeases.add(key);
    return async () => { memoryLeases.delete(key); };
  }

  const acquired = await redis.set(key, token, { NX: true, PX: Math.max(5_000, ttlMs) });
  if (acquired !== "OK") return null;
  return async () => {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { keys: [key], arguments: [token] },
    );
  };
}
