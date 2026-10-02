// v16: DexScreener EVM mark feed (paper trading only — measurement, not execution).
//
// Problem: positions on Base / BNB Chain / Ethereum were marked $0 because the
// engine had no reliable price feed for EVM chains. Spot-checks (2026-09-30)
// proved the $0 marks were feed blindness, not death — e.g. MARIE on Ethereum
// was +86% vs entry on a live $15.9K-liquidity Uniswap v4 pool while our books
// carried it at $0.
//
// This module is a dedicated mark source for non-Solana chains:
//   - Batched: DexScreener tokens/v1 accepts up to 30 addresses per request.
//   - Cached: ~60s per token so a Guardian cycle costs one cheap call per chain.
//   - 429-aware: exponential backoff on refusals, stops calling after repeated
//     refusals (10-minute cooldown) — never hammers the provider.
//   - NEVER invents a price: a token with no pair data is simply absent from
//     the result. Callers must keep the last known mark. The exact bug being
//     fixed is "no data -> $0", so this module has no code path that yields 0.
//
// Solana is intentionally excluded: its existing providers stay primary and
// untouched.

import type { Chain } from "./types";

const DEX_MARK_BASE = "https://api.dexscreener.com";
const MARK_TIMEOUT_MS = 6_500;
const MARK_CACHE_MS = 60_000;
const MARK_BATCH_SIZE = 30;
const MARK_MAX_BACKOFF_MS = 10 * 60_000;
const MARK_REFUSAL_STOP_AFTER = 5;

// Task-scoped chain mapping: ethereum -> ethereum, BNB -> bsc, base -> base.
// Other chains are not served by this feed (callers fall through to existing paths).
const EVM_DEX_CHAIN: Partial<Record<Chain, string>> = {
  Ethereum: "ethereum",
  Base: "base",
  "BNB Chain": "bsc",
};

/** Structural subset of a DexScreener pair — enough for mark + v15 filter telemetry. */
export type EvmDexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | null;
  txns?: Record<string, { buys?: number; sells?: number } | undefined>;
  volume?: Record<string, number | undefined>;
  priceChange?: Record<string, number | undefined>;
  liquidity?: { usd?: number | null } | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
  info?: { imageUrl?: string } | null;
  boosts?: { active?: number } | null;
};

type CacheEntry = { at: number; pair: EvmDexPair };

const markCache = new Map<string, CacheEntry>(); // `${dexChain}:${address}` -> entry
let consecutiveRefusals = 0;
let coolUntilMs = 0;

function cacheKey(dexChain: string, address: string) {
  return `${dexChain}:${address.toLowerCase()}`;
}

function dexChainFor(chain: Chain): string | null {
  return EVM_DEX_CHAIN[chain] ?? null;
}

/** True when the feed is serving a chain via this module (never Solana). */
export function isEvmMarkChain(chain: Chain): boolean {
  return dexChainFor(chain) !== null && chain !== "Solana";
}

function noteRefusal() {
  consecutiveRefusals += 1;
  // Repeated refusals (>= 5) trigger the full stop: 10-minute cooldown.
  const base = consecutiveRefusals >= MARK_REFUSAL_STOP_AFTER
    ? MARK_MAX_BACKOFF_MS
    : Math.min(1_000 * 2 ** consecutiveRefusals, MARK_MAX_BACKOFF_MS);
  coolUntilMs = Date.now() + base + Math.floor(Math.random() * 1_000);
}

function noteSuccess() {
  consecutiveRefusals = 0;
  coolUntilMs = 0;
}

function backoffActive() {
  if (Date.now() < coolUntilMs) return true;
  if (coolUntilMs > 0) {
    // Cooldown expired: fresh start, provider gets another chance.
    consecutiveRefusals = 0;
    coolUntilMs = 0;
  }
  return false;
}

function bestPairFor(pairs: EvmDexPair[], address: string): EvmDexPair | undefined {
  const wanted = address.toLowerCase();
  let best: EvmDexPair | undefined;
  let bestLiq = -1;
  for (const pair of pairs) {
    if (String(pair.baseToken?.address ?? "").toLowerCase() !== wanted) continue;
    const price = Number(pair.priceUsd);
    if (!Number.isFinite(price) || price <= 0) continue; // never mark from a non-positive price
    const liq = Number(pair.liquidity?.usd);
    const liqScore = Number.isFinite(liq) ? liq : -1;
    if (liqScore > bestLiq) { best = pair; bestLiq = liqScore; }
  }
  return best;
}

async function fetchChunk(dexChain: string, addresses: string[]): Promise<EvmDexPair[]> {
  const url = `${DEX_MARK_BASE}/tokens/v1/${dexChain}/${addresses.map(encodeURIComponent).join(",")}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Bot-War-Room/2.12" },
    cache: "no-store",
    signal: AbortSignal.timeout(MARK_TIMEOUT_MS),
  });
  if (response.status === 429) {
    noteRefusal();
    return [];
  }
  if (!response.ok) {
    // 5xx / network-level trouble counts as a refusal; other 4xx just yield nothing.
    if (response.status >= 500) noteRefusal();
    return [];
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  noteSuccess();
  return Array.isArray(payload) ? (payload as EvmDexPair[]) : [];
}

/**
 * Fetch + cache marks for a batch of token addresses on one chain.
 * Never throws, never returns zeros — unknown tokens stay absent.
 */
export async function prewarmEvmMarks(chain: Chain, addresses: string[]): Promise<void> {
  const dexChain = dexChainFor(chain);
  if (!dexChain || chain === "Solana") return;
  const unique = [...new Set(addresses.map((a) => String(a ?? "").trim()).filter((a) => a.length >= 8))];
  if (!unique.length || backoffActive()) return;
  try {
    for (let i = 0; i < unique.length; i += MARK_BATCH_SIZE) {
      if (backoffActive()) return;
      const chunk = unique.slice(i, i + MARK_BATCH_SIZE);
      const pairs = await fetchChunk(dexChain, chunk);
      const now = Date.now();
      for (const address of chunk) {
        const best = bestPairFor(pairs, address);
        // Only cache a real pair. A token with no pair data keeps whatever the
        // cache had (bounded by TTL) — absence here never becomes a $0 mark.
        if (best) markCache.set(cacheKey(dexChain, address), { at: now, pair: best });
      }
    }
  } catch {
    noteRefusal();
  }
}

/** Cached mark only — no network. Returns undefined on miss or stale entry. */
export function getEvmMarkPair(chain: Chain, address: string): EvmDexPair | undefined {
  const dexChain = dexChainFor(chain);
  if (!dexChain || chain === "Solana") return undefined;
  const entry = markCache.get(cacheKey(dexChain, String(address ?? "")));
  if (!entry || Date.now() - entry.at > MARK_CACHE_MS) return undefined;
  return entry.pair;
}

/** Cache-aware single-token fetch (last-resort path when prewarm missed). */
export async function fetchEvmMarkPair(chain: Chain, address: string): Promise<EvmDexPair | null> {
  const cached = getEvmMarkPair(chain, address);
  if (cached) return cached;
  await prewarmEvmMarks(chain, [address]);
  return getEvmMarkPair(chain, address) ?? null;
}

/** Test-only reset for the module's backoff/cache state. */
export function __resetEvmMarkState() {
  markCache.clear();
  consecutiveRefusals = 0;
  coolUntilMs = 0;
}

/** Test-only: simulate N consecutive refusals (drives the hard-stop cooldown). */
export function __simulateEvmMarkRefusals(count: number) {
  consecutiveRefusals = 0;
  coolUntilMs = 0;
  for (let i = 0; i < count; i++) noteRefusal();
}

/** Test-only visibility into backoff state. */
export function __evmMarkBackoff() {
  return { consecutiveRefusals, coolUntilMs };
}
