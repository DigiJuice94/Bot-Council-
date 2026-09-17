import type { ProviderHealth } from "./types";

type ProviderName = ProviderHealth["name"];
type ProviderGlobal = typeof globalThis & { __bwrProviderHealth?: Map<ProviderName, ProviderHealth> };
const globalState = globalThis as ProviderGlobal;
const store = globalState.__bwrProviderHealth ??= new Map();

function configured(name: ProviderName) {
  if (name === "birdeye") return Boolean(process.env.BIRDEYE_API_KEY);
  if (name === "helius") return Boolean(process.env.HELIUS_API_KEY || process.env.SOLANA_RPC_URL);
  if (name === "jupiter") return Boolean(process.env.JUPITER_API_KEY);
  if (name === "goplus") return true; // GoPlus supports anonymous calls; token increases limits.
  if (name === "redis") return Boolean(process.env.REDIS_URL);
  return true; // DEX Screener is public.
}

function base(name: ProviderName): ProviderHealth {
  return store.get(name) ?? { name, configured: configured(name), ok: false };
}

export function markProviderSuccess(name: ProviderName) {
  store.set(name, { ...base(name), configured: configured(name), ok: true, lastSuccessAt: new Date().toISOString(), lastError: undefined });
}

export function markProviderFailure(name: ProviderName, error: unknown) {
  store.set(name, {
    ...base(name),
    configured: configured(name),
    ok: false,
    lastErrorAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
  });
}

export function getProviderHealth(): ProviderHealth[] {
  const names: ProviderName[] = ["birdeye", "geckoterminal", "dexscreener", "goplus", "helius", "jupiter", "redis"];
  return names.map((name) => ({ ...base(name), configured: configured(name) }));
}
