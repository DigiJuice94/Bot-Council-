import type { Chain, HistoricalFrame, ManagedPosition, MarketSnapshot } from "./types";

const DEX_BASE = "https://api.dexscreener.com";
const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";
const REQUEST_TIMEOUT_MS = 6_000;

const DEX_CHAIN: Record<Chain, string> = {
  Solana: "solana",
  Ethereum: "ethereum",
  Base: "base",
  "BNB Chain": "bsc",
  Monad: "monad",
  "Robinhood Chain": "robinhood",
};

const GOPLUS_CHAIN: Partial<Record<Chain, string>> = {
  Ethereum: "1",
  Base: "8453",
  "BNB Chain": "56",
  Monad: "143",
  "Robinhood Chain": "4663",
};

type DexTxBucket = { buys?: number; sells?: number };
type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | null;
  txns?: Record<string, DexTxBucket | undefined>;
  volume?: Record<string, number | undefined>;
  priceChange?: Record<string, number | undefined>;
  liquidity?: { usd?: number | null } | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
  info?: { socials?: Array<{ platform?: string; handle?: string }> | null } | null;
  boosts?: { active?: number } | null;
};

type DiscoveryToken = { chainId?: string; tokenAddress?: string; amount?: number; totalAmount?: number };

type SecurityResult = {
  verified: boolean;
  source: "goplus" | "unavailable";
  sellable?: boolean;
  honeypot?: boolean;
  buyTaxPct?: number;
  sellTaxPct?: number;
  holders?: number;
  top10Pct?: number;
  liquidityLocked?: boolean;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
  ownershipRenounced?: boolean;
  proxyContract?: boolean;
  quality: {
    sellability: boolean;
    honeypot: boolean;
    taxes: boolean;
    holders: boolean;
    top10: boolean;
    liquidityLock: boolean;
    authorities: boolean;
    ownership: boolean;
    bundled: boolean;
    smartMoney: boolean;
    socialVelocity: boolean;
  };
};

type MarketDataGlobal = typeof globalThis & {
  __bwrDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;
  __bwrSecurityCache?: Map<string, { at: number; value: SecurityResult }>;
};

const globalCache = globalThis as MarketDataGlobal;
const discoveryCache = globalCache.__bwrDiscoveryCache ??= new Map();
const securityCache = globalCache.__bwrSecurityCache ??= new Map();

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool1(value: unknown) {
  return value === "1" || value === 1 || value === true;
}

function pctValue(value: unknown): number {
  const n = num(value, 0);
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function headers() {
  const output: Record<string, string> = { Accept: "application/json", "User-Agent": "Bot-War-Room/2.11.2" };
  if (process.env.MARKET_DATA_API_KEY) output.Authorization = `Bearer ${process.env.MARKET_DATA_API_KEY}`;
  return output;
}

function goPlusHeaders() {
  const output: Record<string, string> = { Accept: "application/json", "User-Agent": "Bot-War-Room/2.11.2" };
  const token = process.env.GOPLUS_API_TOKEN;
  if (token) output.Authorization = `Bearer ${token}`;
  return output;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", "User-Agent": "Bot-War-Room/2.11.2", ...(options?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}


function configuredLiveAdapterBase() {
  const base = process.env.MARKET_DATA_BASE_URL;
  return process.env.WAR_ROOM_MARKET_DATA_MODE === "adapter" && base ? base : undefined;
}

function looksLikeSnapshot(value: unknown): value is MarketSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MarketSnapshot>;
  return typeof row.symbol === "string" && typeof row.price === "number" && typeof row.liquidity === "number" && typeof row.tokenAddress === "string";
}

function selectSecurityRow(payload: any, address: string) {
  const result = payload?.result;
  if (!result || typeof result !== "object") return null;
  return result[address] ?? result[address.toLowerCase()] ?? result[address.toUpperCase()] ?? Object.values(result)[0] ?? null;
}

function sumTop10(holders: any): { value?: number; verified: boolean } {
  if (!Array.isArray(holders) || !holders.length) return { verified: false };
  const value = holders.slice(0, 10).reduce((sum: number, holder: any) => sum + pctValue(holder?.percent), 0);
  return { value: clamp(value, 0, 100), verified: true };
}

function emptySecurity(): SecurityResult {
  return {
    verified: false,
    source: "unavailable",
    quality: {
      sellability: false,
      honeypot: false,
      taxes: false,
      holders: false,
      top10: false,
      liquidityLock: false,
      authorities: false,
      ownership: false,
      bundled: false,
      smartMoney: false,
      socialVelocity: false,
    },
  };
}

async function fetchSecurity(chain: Chain, address: string): Promise<SecurityResult> {
  const cacheKey = `${chain}:${address}`;
  const cached = securityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;

  let output = emptySecurity();
  if (chain === "Solana") {
    const url = `${GOPLUS_BASE}/solana/token_security?contract_addresses=${encodeURIComponent(address)}`;
    const payload = await fetchJson<any>(url, { headers: goPlusHeaders() });
    const row: any = selectSecurityRow(payload, address);
    if (row) {
      const top10 = sumTop10(row.holders);
      const transferHookMalicious = bool1(row?.transfer_hook?.malicious_address);
      const nonTransferable = bool1(row.non_transferable);
      const mintAuthority = bool1(row?.mintable?.status ?? row.mintable);
      const freezeAuthority = bool1(row?.freezable?.status ?? row.freezable);
      const currentTransferFee = pctValue(row?.transfer_fee?.current_fee_rate?.fee_rate ? num(row.transfer_fee.current_fee_rate.fee_rate) / 10_000 : 0);
      const lpHolders = Array.isArray(row.lp_holders) ? row.lp_holders : [];
      const lockedLpPct = lpHolders.filter((h: any) => bool1(h?.is_locked)).reduce((s: number, h: any) => s + pctValue(h?.percent), 0);
      const explicitLocked = bool1(row.is_locked) || lockedLpPct > 0;
      const holderCount = num(row.holder_count, 0);
      output = {
        verified: true,
        source: "goplus",
        sellable: !nonTransferable && !transferHookMalicious,
        honeypot: nonTransferable || transferHookMalicious,
        buyTaxPct: currentTransferFee,
        sellTaxPct: currentTransferFee,
        holders: holderCount > 0 ? holderCount : undefined,
        top10Pct: top10.value,
        liquidityLocked: explicitLocked,
        mintAuthority,
        freezeAuthority,
        ownershipRenounced: true,
        proxyContract: false,
        quality: {
          sellability: true,
          honeypot: true,
          taxes: true,
          holders: holderCount > 0,
          top10: top10.verified,
          liquidityLock: Boolean(row.is_locked !== undefined || lpHolders.length),
          authorities: true,
          ownership: true,
          bundled: false,
          smartMoney: false,
          socialVelocity: false,
        },
      };
    }
  } else {
    const chainId = GOPLUS_CHAIN[chain];
    if (chainId) {
      const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${encodeURIComponent(address)}`;
      const payload = await fetchJson<any>(url, { headers: goPlusHeaders() });
      const row: any = selectSecurityRow(payload, address);
      if (row) {
        const top10 = sumTop10(row.holders);
        const holderCount = num(row.holder_count, 0);
        const cannotSellAll = bool1(row.cannot_sell_all);
        const honeypot = bool1(row.is_honeypot);
        const owner = String(row.owner_address ?? "").toLowerCase();
        const renounced = owner === "" || /^0x0{40}$/.test(owner) || owner === "0x000000000000000000000000000000000000dead" || bool1(row.owner_address === null);
        const lpHolders = Array.isArray(row.lp_holders) ? row.lp_holders : [];
        const lockedLpPct = lpHolders.filter((h: any) => bool1(h?.is_locked)).reduce((s: number, h: any) => s + pctValue(h?.percent), 0);
        output = {
          verified: true,
          source: "goplus",
          sellable: !cannotSellAll && !honeypot,
          honeypot,
          buyTaxPct: pctValue(row.buy_tax),
          sellTaxPct: pctValue(row.sell_tax),
          holders: holderCount > 0 ? holderCount : undefined,
          top10Pct: top10.value,
          liquidityLocked: lockedLpPct > 0,
          mintAuthority: false,
          freezeAuthority: false,
          ownershipRenounced: renounced && !bool1(row.can_take_back_ownership),
          proxyContract: bool1(row.is_proxy),
          quality: {
            sellability: row.cannot_sell_all !== undefined || row.is_honeypot !== undefined,
            honeypot: row.is_honeypot !== undefined,
            taxes: row.buy_tax !== undefined || row.sell_tax !== undefined,
            holders: holderCount > 0,
            top10: top10.verified,
            liquidityLock: lpHolders.length > 0,
            authorities: true,
            ownership: row.owner_address !== undefined || row.can_take_back_ownership !== undefined,
            bundled: false,
            smartMoney: false,
            socialVelocity: false,
          },
        };
      }
    }
  }

  securityCache.set(cacheKey, { at: Date.now(), value: output });
  return output;
}

function txBucket(pair: DexPair, key: string): DexTxBucket {
  return pair.txns?.[key] ?? {};
}

function volumeBucket(pair: DexPair, key: string) {
  return num(pair.volume?.[key], 0);
}

function priceChangeBucket(pair: DexPair, key: string) {
  return num(pair.priceChange?.[key], 0);
}

function chooseBestPair(pairs: DexPair[], tokenAddress?: string): DexPair | null {
  if (!pairs.length) return null;
  const filtered = tokenAddress
    ? pairs.filter((pair) => pair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase())
    : pairs;
  const pool = filtered.length ? filtered : pairs;
  return [...pool].sort((a, b) => {
    const aScore = num(a.liquidity?.usd) * 0.65 + volumeBucket(a, "h24") * 0.35;
    const bScore = num(b.liquidity?.usd) * 0.65 + volumeBucket(b, "h24") * 0.35;
    return bScore - aScore;
  })[0] ?? null;
}

function candidateScore(pair: DexPair) {
  const created = num(pair.pairCreatedAt, Date.now());
  const ageMinutes = Math.max(1, (Date.now() - created) / 60_000);
  const liquidity = num(pair.liquidity?.usd);
  const marketCap = num(pair.marketCap, num(pair.fdv));
  const volume1h = volumeBucket(pair, "h1");
  const volume24h = volumeBucket(pair, "h24");
  const m5 = txBucket(pair, "m5");
  const h1 = txBucket(pair, "h1");
  const txs1h = num(h1.buys) + num(h1.sells);
  const txs5m = num(m5.buys) + num(m5.sells);
  const newness = ageMinutes <= 60 ? 30 : ageMinutes <= 360 ? 24 : ageMinutes <= 1440 ? 17 : ageMinutes <= 10080 ? 6 : 0;
  const liquidityScore = clamp(Math.log10(1 + Math.max(0, liquidity) / 10_000) * 14, 0, 28);
  const turnoverScore = marketCap > 0 ? clamp((volume24h / marketCap) * 18, 0, 24) : clamp(Math.log10(1 + volume24h / 10_000) * 8, 0, 18);
  const activityScore = clamp(Math.log10(1 + txs1h + txs5m * 6) * 9, 0, 18);
  const momentum = clamp(Math.max(-10, priceChangeBucket(pair, "h1")) * 0.25 + Math.max(-10, priceChangeBucket(pair, "m5")) * 0.4, -8, 15);
  const boost = clamp(num(pair.boosts?.active) * 1.5, 0, 8);
  return newness + liquidityScore + turnoverScore + activityScore + momentum + boost + Math.min(8, Math.log10(1 + volume1h) * 1.5);
}

async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  const dexChain = DEX_CHAIN[chain];
  const cached = discoveryCache.get(dexChain);
  if (cached && Date.now() - cached.at < 15_000) return cached.tokens;

  const [profiles, boosts, takeovers] = await Promise.all([
    fetchJson<DiscoveryToken[]>(`${DEX_BASE}/token-profiles/latest/v1`),
    fetchJson<DiscoveryToken[]>(`${DEX_BASE}/token-boosts/latest/v1`),
    fetchJson<DiscoveryToken[]>(`${DEX_BASE}/community-takeovers/latest/v1`),
  ]);
  const combined = [...(Array.isArray(profiles) ? profiles : []), ...(Array.isArray(boosts) ? boosts : []), ...(Array.isArray(takeovers) ? takeovers : [])]
    .filter((row) => row?.chainId === dexChain && typeof row.tokenAddress === "string" && row.tokenAddress.length > 10);
  const deduped: DiscoveryToken[] = [];
  const seen = new Set<string>();
  for (const row of combined) {
    const key = String(row.tokenAddress).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  discoveryCache.set(dexChain, { at: Date.now(), tokens: deduped.slice(0, 30) });
  return deduped.slice(0, 30);
}

async function dexPairsForAddresses(chain: Chain, addresses: string[]): Promise<DexPair[]> {
  if (!addresses.length) return [];
  const dexChain = DEX_CHAIN[chain];
  const url = `${DEX_BASE}/tokens/v1/${dexChain}/${addresses.slice(0, 30).map(encodeURIComponent).join(",")}`;
  const payload = await fetchJson<DexPair[]>(url);
  return Array.isArray(payload) ? payload : [];
}

async function dexPairsForToken(chain: Chain, address: string): Promise<DexPair[]> {
  const dexChain = DEX_CHAIN[chain];
  const payload = await fetchJson<DexPair[]>(`${DEX_BASE}/token-pairs/v1/${dexChain}/${encodeURIComponent(address)}`);
  return Array.isArray(payload) ? payload : [];
}

function inferredAssetClass(pair: DexPair, chain: Chain, ageMinutes: number, marketCap: number, volume24h: number): MarketSnapshot["assetClass"] {
  const dex = String(pair.dexId ?? "").toLowerCase();
  const address = String(pair.baseToken?.address ?? "");
  if (dex.includes("pump") || dex.includes("moonshot") || dex.includes("four") || (chain === "Solana" && address.toLowerCase().endsWith("pump"))) return "meme";
  if (ageMinutes <= 1440 && marketCap > 0 && marketCap <= 50_000_000 && volume24h / marketCap >= 0.25) return "meme";
  return "unknown";
}

function deriveVolumeAcceleration(pair: DexPair) {
  const h1 = volumeBucket(pair, "h1");
  const h6 = volumeBucket(pair, "h6");
  if (h6 <= h1 || h6 <= 0) return 0;
  const priorHourly = (h6 - h1) / 5;
  if (priorHourly <= 0) return 0;
  return clamp((h1 / priorHourly - 1) * 100, -100, 1000);
}

function deriveVolatility(pair: DexPair) {
  const m5 = Math.abs(priceChangeBucket(pair, "m5"));
  const h1 = Math.abs(priceChangeBucket(pair, "h1"));
  const h6 = Math.abs(priceChangeBucket(pair, "h6"));
  const h24 = Math.abs(priceChangeBucket(pair, "h24"));
  return clamp((m5 / 12 + h1 / 35 + h6 / 80 + h24 / 180) / 2.2, 0.05, 1.5);
}

function snapshotFromPair(chain: Chain, pair: DexPair, security: SecurityResult): MarketSnapshot | null {
  const price = num(pair.priceUsd, 0);
  const liquidity = num(pair.liquidity?.usd, 0);
  const tokenAddress = String(pair.baseToken?.address ?? "");
  if (!tokenAddress || price <= 0 || liquidity <= 0) return null;

  const createdAt = num(pair.pairCreatedAt, Date.now());
  const ageMinutes = Math.max(1, Math.round((Date.now() - createdAt) / 60_000));
  const marketCap = num(pair.marketCap, num(pair.fdv, 0));
  const m5 = txBucket(pair, "m5");
  const h1 = txBucket(pair, "h1");
  const buys = num(h1.buys, num(m5.buys));
  const sells = num(h1.sells, num(m5.sells));
  const buySellRatio = sells > 0 ? clamp(buys / sells, 0, 8) : buys > 0 ? 4 : 1;
  const volume5m = volumeBucket(pair, "m5");
  const volume1h = volumeBucket(pair, "h1");
  const volume24h = volumeBucket(pair, "h24");
  const tx1h = num(h1.buys) + num(h1.sells);
  const volumeAccelerationPct = deriveVolumeAcceleration(pair);
  const holders = security.holders ?? 0;
  const top10Pct = security.top10Pct ?? 0;
  const boostCount = num(pair.boosts?.active, 0);

  return {
    symbol: String(pair.baseToken?.symbol ?? "UNKNOWN").slice(0, 20),
    name: String(pair.baseToken?.name ?? pair.baseToken?.symbol ?? "Unknown token").slice(0, 80),
    tokenAddress,
    chain,
    chainFamily: chain === "Solana" ? "solana" : "evm",
    venue: `DEX Screener · ${pair.dexId ?? "DEX"}`,
    price,
    priceChange24h: priceChangeBucket(pair, "h24"),
    marketCap,
    liquidity,
    volume5m,
    volume24h,
    holders,
    ageMinutes,
    buySellRatio,
    smartMoneyBuys: 0,
    smartMoneySells: 0,
    socialVelocityPct: 0,
    top10Pct,
    bundledPct: 0,
    devRugHistory: 0,
    volatility: deriveVolatility(pair),
    sellable: security.sellable ?? false,
    honeypot: security.honeypot ?? false,
    buyTaxPct: security.buyTaxPct ?? 0,
    sellTaxPct: security.sellTaxPct ?? 0,
    liquidityLocked: security.liquidityLocked ?? false,
    mintAuthority: security.mintAuthority ?? false,
    freezeAuthority: security.freezeAuthority ?? false,
    ownershipRenounced: security.ownershipRenounced ?? false,
    proxyContract: security.proxyContract ?? false,
    volumeAccelerationPct,
    marketCapChange5mPct: priceChangeBucket(pair, "m5"),
    assetClass: inferredAssetClass(pair, chain, ageMinutes, marketCap, volume24h),
    launchMetrics: {
      holdersPerMinute: security.quality.holders && holders > 0 && ageMinutes <= 1440 ? holders / Math.max(1, ageMinutes) : undefined,
      transactionsPerMinute: tx1h > 0 ? tx1h / Math.min(60, Math.max(1, ageMinutes)) : undefined,
      volumeUsdPerMinute: ageMinutes <= 60 && volume1h > 0 ? volume1h / Math.max(1, ageMinutes) : volume1h > 0 ? volume1h / 60 : volume5m > 0 ? volume5m / 5 : undefined,
      volumeAccelerationPct,
    },
    dataProvenance: {
      live: true,
      marketSource: "dexscreener",
      securitySource: security.source,
      fetchedAt: new Date().toISOString(),
      pairAddress: pair.pairAddress,
      quality: security.quality,
      notes: [
        "Price, liquidity, transaction counts and volume are live DEX Screener observations.",
        security.verified ? "Contract/security fields were enriched by GoPlus." : "GoPlus security verification was unavailable; deterministic risk will fail closed.",
        boostCount > 0 ? `DEX Screener reports ${boostCount} active boost(s); no social-velocity score was fabricated from that.` : "Social velocity is unknown unless a dedicated social provider is connected.",
        "Bundled-supply and smart-money fields remain explicitly unverified unless a dedicated provider is connected.",
      ],
    },
  };
}

async function directLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const tokens = await discoveryTokens(chain);
  if (!tokens.length) return null;
  const addresses = tokens.map((row) => String(row.tokenAddress));
  const pairs = await dexPairsForAddresses(chain, addresses);
  if (!pairs.length) return null;

  const bestByToken = new Map<string, DexPair>();
  for (const address of addresses) {
    const pair = chooseBestPair(pairs, address);
    if (pair) bestByToken.set(address.toLowerCase(), pair);
  }
  const ranked = [...bestByToken.values()]
    .filter((pair) => num(pair.priceUsd) > 0 && num(pair.liquidity?.usd) >= 5_000)
    .sort((a, b) => candidateScore(b) - candidateScore(a));

  for (const pair of ranked.slice(0, 6)) {
    const address = String(pair.baseToken?.address ?? "");
    if (!address) continue;
    const security = await fetchSecurity(chain, address);
    const snapshot = snapshotFromPair(chain, pair, security);
    if (snapshot) return snapshot;
  }
  return null;
}

export function liveMarketDataMode(): "adapter" | "dexscreener" {
  return configuredLiveAdapterBase() ? "adapter" : "dexscreener";
}

export async function fetchLivePositionSnapshot(position: ManagedPosition): Promise<MarketSnapshot | null> {
  const base = configuredLiveAdapterBase();
  if (base) {
    const url = new URL("/snapshot", base);
    url.searchParams.set("chain", position.chain);
    url.searchParams.set("address", position.tokenAddress);
    const response = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (!response.ok) return null;
    const payload = await response.json();
    return looksLikeSnapshot(payload) ? payload : null;
  }

  const pairs = await dexPairsForToken(position.chain, position.tokenAddress);
  const pair = chooseBestPair(pairs, position.tokenAddress);
  if (!pair) return null;
  const security = await fetchSecurity(position.chain, position.tokenAddress);
  return snapshotFromPair(position.chain, pair, security);
}

export async function fetchLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const base = configuredLiveAdapterBase();
  if (base) {
    const url = new URL("/candidate", base);
    url.searchParams.set("chain", chain);
    const response = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (!response.ok) return null;
    const payload = await response.json();
    return looksLikeSnapshot(payload) ? payload : null;
  }
  return directLiveCandidate(chain);
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
