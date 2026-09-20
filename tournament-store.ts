import { createClient } from "redis";
import type { TournamentState } from "./tournament-types";

const REDIS_KEY = "bot-war-room:tournament:v3-80-independent-bots";
const globalStore = globalThis as typeof globalThis & {
  __botWarRoomTournamentStateV3?: TournamentState;
  __botWarRoomTournamentRedisV3?: Promise<any | null>;
};

async function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!globalStore.__botWarRoomTournamentRedisV3) {
    globalStore.__botWarRoomTournamentRedisV3 = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[tournament-store] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[tournament-store] using process memory", error);
        return null;
      }
    })();
  }
  return globalStore.__botWarRoomTournamentRedisV3;
}

export async function loadTournamentState(): Promise<TournamentState | null> {
  const redis = await redisClient();
  if (!redis) return globalStore.__botWarRoomTournamentStateV3 ?? null;
  const raw = await redis.get(REDIS_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw) as TournamentState;
  globalStore.__botWarRoomTournamentStateV3 = state;
  return state;
}

export async function saveTournamentState(state: TournamentState): Promise<void> {
  globalStore.__botWarRoomTournamentStateV3 = state;
  const redis = await redisClient();
  if (redis) await redis.set(REDIS_KEY, JSON.stringify(state));
}

export async function tournamentStorageMode(): Promise<"redis" | "memory"> {
  return (await redisClient()) ? "redis" : "memory";
}
