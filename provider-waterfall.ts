import { fetchLiveCandidate as fetchCoreCandidate, fetchLivePositionSnapshot as fetchCorePosition } from "./market-data";
import type { Chain, DataQuality, ManagedPosition, MarketSnapshot } from "./types";

type AuxProviderName = "moralis" | "bitquery" | "solana-rpc" | "zeroex";
export type AuxProviderHealth = {
  name: AuxProviderName;
  configured: boolean;
  ok: boolean;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
};

type ProviderWaterfallGlobal = typeof globalThis & {
  __bwrAuxProviderHealth?: Map<AuxProviderName, AuxProviderHealth>;
  __bwrMoralisSeen?: Map<string, number>;
};

const globalState = globalThis as ProviderWaterfallGlobal;
const healthStore = globalState.__bwrAuxProviderHealth ??= new Map();
const moralisSeen = globalState.__bwrMoralisSeen ??= new Map();
const MORALIS_SOLANA = "https://solana-gateway.moralis.io";
const MORALIS_EVM = "https://deep-index.moralis.io/api/v2.2";
const BITQUERY_GRAPHQL = "https://streaming.bitquery.io/graphql";
const PUBLIC_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const REQUEST_TIMEOUT_MS = 6_500;
const MORALIS_COOLDOWN_MS = 120_000;

const MORALIS_EVM_CHAIN: Partial<Record<Chain, string>> = {
  Ethereum: "eth",
  Base: "base",
  "BNB Chain": "bsc",
  Monad: "monad",
};

function configured(name: AuxProviderName) {
  if (name === "moralis") return Boolean(process.env.MORALIS_API_KEY);
  if (name === "bitquery") return Boolean(process.env.BITQUERY_API_TOKEN);
  if (name === "zeroex") return Boolean(process.env.ZEROEX_API_KEY);
  return true;
}

function base(name: AuxProviderName): AuxProviderHealth {
  return healthStore.get(name) ?? { name, configured: configured(name), ok: false };
}

export function markAuxProviderSuccess(name: AuxProviderName) {
  healthStore.set(name, {
    ...base(name),
    configured: configured(name),
    ok: true,
    lastSuccessAt: new Date().toISOString(),
    lastError: undefined,
  });
}

export function markAuxProviderFailure(name: AuxProviderName, error: unknown) {
  healthStore.set(name, {
    ...base(name),
    configured: configured(name),
    ok: false,
    lastErrorAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
  });
}

export function getWaterfallProviderHealth(): AuxProviderHealth[] {
  const names: AuxProviderName[] = ["moralis", "bitquery", "solana-rpc", "zeroex"];
  return names.map((name) => ({ ...base(name), configured: configured(name) }));
}

function cloneQuality(snapshot: MarketSnapshot): DataQuality {
  const q = snapshot.dataProvenance?.quality;
  return {
    sellability: Boolean(q?.sellability),
    honeypot: Boolean(q?.honeypot),
    taxes: Boolean(q?.taxes),
    holders: Boolean(q?.holders),
    top10: Boolean(q?.top10),
    liquidityLock: Boolean(q?.liquidityLock),
    authorities: Boolean(q?.authorities),
    ownership: Boolean(q?.ownership),
    bundled: Boolean(q?.bundled),
    smartMoney: Boolean(q?.smartMoney),
    socialVelocity: Boolean(q?.socialVelocity),
    routeFeasibility: Boolean(q?.routeFeasibility),
  };
}

function note(snapshot: MarketSnapshot, text: string) {
  const notes = snapshot.dataProvenance?.notes ?? [];
  if (!notes.includes(text) && snapshot.dataProvenance) snapshot.dataProvenance.notes = [...notes, text];
}

function percent(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

async function fetchJson(url: string, provider: AuxProviderName, init?: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": "Bot-War-Room/2.14",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${provider} HTTP ${response.status}${body ? `: ${body.slice(0, 140)}` : ""}`);
    }
    const payload = await response.json();
    markAuxProviderSuccess(provider);
    return payload;
  } catch (error) {
    markAuxProviderFailure(provider, error);
    return null;
  }
}

function fakePosition(chain: Chain, tokenAddress: string): ManagedPosition {
  return { chain, tokenAddress } as ManagedPosition;
}

async function moralisPumpFunCandidate(): Promise<MarketSnapshot | null> {
  const key = process.env.MORALIS_API_KEY;
  if (!key) return null;
  const payload = await fetchJson(`${MORALIS_SOLANA}/token/mainnet/exchange/pumpfun/new`, "moralis", {
    headers: { "X-API-Key": key },
  }) as any;
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  const now = Date.now();
  for (const [address, at] of moralisSeen) if (now - at > MORALIS_COOLDOWN_MS * 3) moralisSeen.delete(address);

  for (const row of rows.slice(0, 20)) {
    const tokenAddress = String(row?.tokenAddress ?? row?.mint ?? "");
    if (tokenAddress.length < 20) continue;
    const seenAt = moralisSeen.get(tokenAddress);
    if (seenAt && now - seenAt < MORALIS_COOLDOWN_MS) continue;
    moralisSeen.set(tokenAddress, now);
    const snapshot = await fetchCorePosition(fakePosition("Solana", tokenAddress));
    if (!snapshot || snapshot.liquidity < Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_DISCOVERY_MIN_LIQUIDITY_USD ?? 1_000))) continue;
    const holders = Number(row?.holders);
    if (Number.isFinite(holders) && holders >= 0) {
      snapshot.holders = holders;
      const q = cloneQuality(snapshot);
      q.holders = true;
      if (snapshot.dataProvenance) snapshot.dataProvenance.quality = q;
    }
    note(snapshot, "Moralis Pump.fun discovery supplied this live Solana candidate when primary listing discovery needed a fallback.");
    return snapshot;
  }
  return null;
}

async function moralisEvmHolders(snapshot: MarketSnapshot) {
  const key = process.env.MORALIS_API_KEY;
  const chain = MORALIS_EVM_CHAIN[snapshot.chain];
  if (!key || !chain || snapshot.chainFamily !== "evm") return;
  const url = new URL(`${MORALIS_EVM}/erc20/${encodeURIComponent(snapshot.tokenAddress)}/holders`);
  url.searchParams.set("chain", chain);
  const payload = await fetchJson(url.toString(), "moralis", { headers: { "X-API-Key": key } }) as any;
  if (!payload || !snapshot.dataProvenance) return;
  const q = cloneQuality(snapshot);
  const holders = Number(payload?.totalHolders);
  if (Number.isFinite(holders) && holders >= 0) {
    snapshot.holders = holders;
    q.holders = true;
  }
  const top10 = percent(payload?.holderSupply?.top10?.supplyPercent);
  if (top10 !== undefined) {
    snapshot.top10Pct = top10;
    q.top10 = true;
  }
  snapshot.dataProvenance.quality = q;
  note(snapshot, "Moralis holder analytics filled EVM holder-count/top-10 gaps in the primary security feed.");
}

async function moralisSolanaSignals(snapshot: MarketSnapshot) {
  const key = process.env.MORALIS_API_KEY;
  if (!key || snapshot.chain !== "Solana") return;
  const [metadata, swaps] = await Promise.all([
    fetchJson(`${MORALIS_SOLANA}/token/mainnet/${encodeURIComponent(snapshot.tokenAddress)}/metadata`, "moralis", { headers: { "X-API-Key": key } }),
    fetchJson(`${MORALIS_SOLANA}/token/mainnet/${encodeURIComponent(snapshot.tokenAddress)}/swaps`, "moralis", { headers: { "X-API-Key": key } }),
  ]) as [any, any];
  if (metadata?.score !== undefined) note(snapshot, `Moralis on-chain token quality score: ${Number(metadata.score).toFixed(0)}/100.`);
  const rows = Array.isArray(swaps?.result) ? swaps.result : [];
  if (rows.length) {
    const buyers = new Set(rows.filter((row: any) => String(row?.transactionType ?? row?.swapType ?? "").toLowerCase() === "buy").map((row: any) => String(row?.walletAddress ?? "")).filter(Boolean));
    const sellers = new Set(rows.filter((row: any) => String(row?.transactionType ?? row?.swapType ?? "").toLowerCase() === "sell").map((row: any) => String(row?.walletAddress ?? "")).filter(Boolean));
    snapshot.launchMetrics = {
      ...(snapshot.launchMetrics ?? {}),
      uniqueBuyersPerMinute: snapshot.ageMinutes <= 60 ? buyers.size / Math.max(1, snapshot.ageMinutes) : buyers.size / 60,
    };
    note(snapshot, `Moralis recent-swap fallback observed ${buyers.size} unique buyers and ${sellers.size} unique sellers; this is participation data, not fabricated smart-money labeling.`);
  }
}

async function rpcCall(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Bot-War-Room/2.14" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${method}-${Date.now()}`, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Solana RPC ${method} HTTP ${response.status}`);
  const payload = await response.json() as any;
  if (payload?.error) throw new Error(`Solana RPC ${method}: ${payload.error.message ?? "unknown error"}`);
  return payload;
}

async function solanaRpcEnrichment(snapshot: MarketSnapshot) {
  if (snapshot.chain !== "Solana" || !snapshot.dataProvenance) return;
  const urls = [...new Set([process.env.SOLANA_RPC_URL, PUBLIC_SOLANA_RPC].filter(Boolean) as string[])];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const [account, supply, largest] = await Promise.all([
        rpcCall(url, "getAccountInfo", [snapshot.tokenAddress, { encoding: "jsonParsed" }]),
        rpcCall(url, "getTokenSupply", [snapshot.tokenAddress]),
        rpcCall(url, "getTokenLargestAccounts", [snapshot.tokenAddress]),
      ]);
      const q = cloneQuality(snapshot);
      const info = account?.result?.value?.data?.parsed?.info;
      if (info) {
        snapshot.mintAuthority = Boolean(info.mintAuthority);
        snapshot.freezeAuthority = Boolean(info.freezeAuthority);
        snapshot.ownershipRenounced = !snapshot.mintAuthority;
        q.authorities = true;
        q.ownership = true;
      }
      const totalRaw = Number(supply?.result?.value?.amount);
      const largestRows = largest?.result?.value;
      if (Number.isFinite(totalRaw) && totalRaw > 0 && Array.isArray(largestRows)) {
        const topRaw = largestRows.slice(0, 10).reduce((sum: number, row: any) => sum + Number(row?.amount ?? 0), 0);
        if (Number.isFinite(topRaw)) {
          snapshot.top10Pct = Math.max(0, Math.min(100, topRaw / totalRaw * 100));
          q.top10 = true;
        }
      }
      snapshot.dataProvenance.quality = q;
      note(snapshot, `Solana RPC fallback verified ${q.authorities ? "mint/freeze authorities" : "available mint data"}${q.top10 ? " and top-10 concentration" : ""}.`);
      markAuxProviderSuccess("solana-rpc");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  markAuxProviderFailure("solana-rpc", lastError ?? new Error("No Solana RPC endpoint responded"));
}

async function bitquerySolanaFlow(snapshot: MarketSnapshot) {
  const token = process.env.BITQUERY_API_TOKEN;
  if (!token || snapshot.chain !== "Solana") return;
  const mint = snapshot.tokenAddress.replace(/"/g, "");
  const query = `query { Solana { DEXTrades(limit: {count: 60}, orderBy: {descending: Block_Time}, where: {Transaction: {Result: {Success: true}}, any: [{Trade: {Buy: {Currency: {MintAddress: {is: \"${mint}\"}}}}}, {Trade: {Sell: {Currency: {MintAddress: {is: \"${mint}\"}}}}}]}) { Trade { Buy { Account { Address } Currency { MintAddress } } Sell { Account { Address } Currency { MintAddress } } } } } }`;
  const payload = await fetchJson(BITQUERY_GRAPHQL, "bitquery", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  }) as any;
  const rows = payload?.data?.Solana?.DEXTrades;
  if (!Array.isArray(rows) || !rows.length) return;
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  for (const row of rows) {
    const buyMint = String(row?.Trade?.Buy?.Currency?.MintAddress ?? "");
    const sellMint = String(row?.Trade?.Sell?.Currency?.MintAddress ?? "");
    if (buyMint === mint) buyers.add(String(row?.Trade?.Buy?.Account?.Address ?? ""));
    if (sellMint === mint) sellers.add(String(row?.Trade?.Sell?.Account?.Address ?? ""));
  }
  buyers.delete(""); sellers.delete("");
  snapshot.launchMetrics = {
    ...(snapshot.launchMetrics ?? {}),
    uniqueBuyersPerMinute: snapshot.launchMetrics?.uniqueBuyersPerMinute ?? (snapshot.ageMinutes <= 60 ? buyers.size / Math.max(1, snapshot.ageMinutes) : buyers.size / 60),
  };
  note(snapshot, `Bitquery fallback observed ${buyers.size} recent buyer wallets and ${sellers.size} seller wallets for real-time flow context.`);
}

export async function enrichWithProviderWaterfall(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
  if (!snapshot.dataProvenance) return snapshot;
  if (snapshot.chain === "Solana") {
    // Wait for all relevant checks before giving the snapshot to the council.
    await Promise.all([
      solanaRpcEnrichment(snapshot),
      moralisSolanaSignals(snapshot),
      bitquerySolanaFlow(snapshot),
    ]);
  } else {
    await moralisEvmHolders(snapshot);
  }
  return snapshot;
}

export async function fetchLiveTokenSnapshot(chain: Chain, tokenAddress: string): Promise<MarketSnapshot | null> {
  const snapshot = await fetchCorePosition(fakePosition(chain, tokenAddress));
  return snapshot ? enrichWithProviderWaterfall(snapshot) : null;
}

export async function fetchLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const primary = await fetchCoreCandidate(chain);
  if (primary) return enrichWithProviderWaterfall(primary);
  if (chain === "Solana") {
    const moralis = await moralisPumpFunCandidate();
    if (moralis) return enrichWithProviderWaterfall(moralis);
  }
  return null;
}
