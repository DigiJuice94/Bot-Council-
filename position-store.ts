import { createClient } from "redis";
import type { ManagedPosition } from "./types";

const REDIS_KEY = "bot-war-room:positions:v2";
const memory = new Map<string, ManagedPosition>();
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
