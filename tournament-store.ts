import { createClient } from "redis";
import type { TournamentState } from "./tournament-types";

// Dedicated state for the promoted Tournament.13 winner. Do not reuse the
// completed ten-team tournament ledger or the legacy main paper wallet.
const REDIS_KEY = "bot-war-room:team-file-cabinet-exact:v1";
const globalStore = globalThis as typeof globalThis & {
  __botWarRoomTeamFileCabinetStateV1?: TournamentState;
  __botWarRoomTeamFileCabinetRedisV1?: Promise<any | null>;
};

async function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!globalStore.__botWarRoomTeamFileCabinetRedisV1) {
    globalStore.__botWarRoomTeamFileCabinetRedisV1 = (async () => {
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
  return globalStore.__botWarRoomTeamFileCabinetRedisV1;
}

export async function loadTournamentState(): Promise<TournamentState | null> {
  const redis = await redisClient();
  if (!redis) return globalStore.__botWarRoomTeamFileCabinetStateV1 ?? null;
  const raw = await redis.get(REDIS_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw) as TournamentState;
  globalStore.__botWarRoomTeamFileCabinetStateV1 = state;
  return state;
}

export async function saveTournamentState(state: TournamentState): Promise<void> {
  globalStore.__botWarRoomTeamFileCabinetStateV1 = state;
  const redis = await redisClient();
  if (redis) await redis.set(REDIS_KEY, JSON.stringify(state));
}

export async function tournamentStorageMode(): Promise<"redis" | "memory"> {
  return (await redisClient()) ? "redis" : "memory";
}
