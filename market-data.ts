import type { Chain, HistoricalFrame, ManagedPosition, MarketSnapshot } from "./types";

function looksLikeSnapshot(value: unknown): value is MarketSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MarketSnapshot>;
  return typeof row.symbol === "string" && typeof row.price === "number" && typeof row.liquidity === "number" && typeof row.tokenAddress === "string";
}

function headers() {
  const output: Record<string, string> = { Accept: "application/json" };
  if (process.env.MARKET_DATA_API_KEY) output.Authorization = `Bearer ${process.env.MARKET_DATA_API_KEY}`;
  return output;
}

export async function fetchLivePositionSnapshot(position: ManagedPosition): Promise<MarketSnapshot | null> {
  const base = process.env.MARKET_DATA_BASE_URL;
  if (!base) return null;
  const url = new URL("/snapshot", base);
  url.searchParams.set("chain", position.chain);
  url.searchParams.set("address", position.tokenAddress);
  const response = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(3500) });
  if (!response.ok) return null;
  const payload = await response.json();
  return looksLikeSnapshot(payload) ? payload : null;
}

export async function fetchLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const base = process.env.MARKET_DATA_BASE_URL;
  if (!base) return null;
  const url = new URL("/candidate", base);
  url.searchParams.set("chain", chain);
  const response = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(3500) });
  if (!response.ok) return null;
  const payload = await response.json();
  return looksLikeSnapshot(payload) ? payload : null;
}

export async function fetchHistoricalFrames(chain: Chain, limit = 5000): Promise<HistoricalFrame[]> {
  const base = process.env.MARKET_DATA_BASE_URL;
  if (!base) return [];
  const url = new URL("/history", base);
  url.searchParams.set("chain", chain);
  url.searchParams.set("limit", String(Math.min(50_000, Math.max(1, limit))));
  const response = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return [];
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload.filter((row) => row && typeof row === "object" && looksLikeSnapshot((row as HistoricalFrame).snapshot)) as HistoricalFrame[];
}
