import { createClient } from "redis";
import type { TournamentState } from "./tournament-types";

const REDIS_KEY = "bot-war-room:tournament:v2-independent-teams";
const globalStore = globalThis as typeof globalThis & {
  __botWarRoomTournamentStateV2?: TournamentState;
  __botWarRoomTournamentRedisV2?: Promise<any | null>;
};

async function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!globalStore.__botWarRoomTournamentRedisV2) {
    globalStore.__botWarRoomTournamentRedisV2 = (async () => {
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
  return globalStore.__botWarRoomTournamentRedisV2;
}

export async function loadTournamentState(): Promise<TournamentState | null> {
  const redis = await redisClient();
  if (!redis) return globalStore.__botWarRoomTournamentStateV2 ?? null;
  const raw = await redis.get(REDIS_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw) as TournamentState;
  globalStore.__botWarRoomTournamentStateV2 = state;
  return state;
}

export async function saveTournamentState(state: TournamentState): Promise<void> {
  globalStore.__botWarRoomTournamentStateV2 = state;
  const redis = await redisClient();
  if (redis) await redis.set(REDIS_KEY, JSON.stringify(state));
}

export async function tournamentStorageMode(): Promise<"redis" | "memory"> {
  return (await redisClient()) ? "redis" : "memory";
}
