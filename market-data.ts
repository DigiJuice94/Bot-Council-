import { markProviderFailure, markProviderSuccess } from "./provider-health";
import type { Chain, DataQuality, HistoricalFrame, ManagedPosition, MarketSnapshot } from "./types";

const DEX_BASE = "https://api.dexscreener.com";
const BIRDEYE_BASE = "https://public-api.birdeye.so";
const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const GECKO_CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 6_500;
const CANDIDATE_COOLDOWN_MS = 90_000;

const DEX_CHAIN: Record<Chain, string> = {
  Solana: "solana",
  Ethereum: "ethereum",
  Base: "base",
  "BNB Chain": "bsc",
  Monad: "monad",
  HyperEVM: "hyperevm",
  "Robinhood Chain": "robinhood",
};

const GECKO_CHAIN: Partial<Record<Chain, string>> = {
  Solana: "solana",
  Ethereum: "eth",
  Base: "base",
  "BNB Chain": "bsc",
  Monad: "monad",
  HyperEVM: "hyperevm",
};

const BIRDEYE_CHAIN: Partial<Record<Chain, string>> = {
  Solana: "solana",
  Ethereum: "ethereum",
  Base: "base",
  "BNB Chain": "bsc",
  Monad: "monad",
  // Robinhood Chain is intentionally omitted because Birdeye's current supported-network list does not include it.
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
  info?: { imageUrl?: string; socials?: Array<{ platform?: string; handle?: string }> | null } | null;
  boosts?: { active?: number } | null;
};

type DiscoveryToken = {
  chainId: string;
  tokenAddress: string;
  source: "birdeye" | "geckoterminal" | "dexscreener";
  listedAt?: number;
  reportedLiquidity?: number;
  symbol?: string;
  name?: string;
  imageUrl?: string;
};

type SecuritySource = "birdeye" | "goplus" | "helius" | "multi" | "unavailable";
type SecurityResult = {
  verified: boolean;
  source: SecuritySource;
  sellable?: boolean;
  honeypot?: boolean;
  buyTaxPct?: number;
  sellTaxPct?: number;
  holders?: number;
  top10Pct?: number;
  bundledPct?: number;
  liquidityLocked?: boolean;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
  ownershipRenounced?: boolean;
  proxyContract?: boolean;
  quality: DataQuality;
  notes: string[];
};

type MarketDataGlobal = typeof globalThis & {
  __bwrDexDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;
  __bwrDexLatestAll?: { at: number; rows: any[] };
  __bwrDexLatestPending?: Promise<any[]>;
  __bwrGeckoDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;
  __bwrSecurityCacheV12?: Map<string, { at: number; value: SecurityResult }>;
  __bwrCandidateSeen?: Map<string, number>;
};

const globalCache = globalThis as MarketDataGlobal;
const dexDiscoveryCache = globalCache.__bwrDexDiscoveryCache ??= new Map();
const geckoDiscoveryCache = globalCache.__bwrGeckoDiscoveryCache ??= new Map();
const securityCache = globalCache.__bwrSecurityCacheV12 ??= new Map();
const candidateSeen = globalCache.__bwrCandidateSeen ??= new Map();

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function optionalNum(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function bool1(value: unknown) { return value === "1" || value === 1 || value === true || String(value).toLowerCase() === "true"; }
function hasOwn(obj: any, key: string) { return Boolean(obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key)); }
function pctValue(value: unknown): number {
  const n = num(value, 0);
  return Math.abs(n) <= 1 ? n * 100 : n;
}
function firstValue(obj: any, keys: string[]): unknown {
  for (const key of keys) if (hasOwn(obj, key)) return obj[key];
  return undefined;
}
function firstNumber(obj: any, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = firstValue(obj, [key]);
    const n = optionalNum(value);
    if (n !== undefined) return n;
  }
  return undefined;
}
function firstBoolean(obj: any, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    const value = obj[key];
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "boolean") return value;
    return bool1(value);
  }
  return undefined;
}

function blankQuality(): DataQuality {
  return {
    sellability: false, honeypot: false, taxes: false, holders: false, top10: false,
    liquidityLock: false, authorities: false, ownership: false, bundled: false,
    smartMoney: false, socialVelocity: false, routeFeasibility: false,
  };
}

function emptySecurity(): SecurityResult {
  return { verified: false, source: "unavailable", quality: blankQuality(), notes: [] };
}

function adapterHeaders() {
  const output: Record<string, string> = { Accept: "application/json", "User-Agent": "Bot-War-Room/2.12" };
  if (process.env.MARKET_DATA_API_KEY) output.Authorization = `Bearer ${process.env.MARKET_DATA_API_KEY}`;
  return output;
}
function birdeyeHeaders(chain: string) {
  return { Accept: "application/json", "User-Agent": "Bot-War-Room/2.12", "X-API-KEY": process.env.BIRDEYE_API_KEY ?? "", "x-chain": chain };
}
function goPlusHeaders() {
  const output: Record<string, string> = { Accept: "application/json", "User-Agent": "Bot-War-Room/2.12" };
  const token = process.env.GOPLUS_API_TOKEN ?? process.env.GOPLUS_API_KEY;
  if (token) output.Authorization = `Bearer ${token}`;
  return output;
}

async function fetchJson<T>(url: string, provider: "birdeye" | "geckoterminal" | "dexscreener" | "goplus" | "helius", options?: RequestInit, softFailure = false): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", "User-Agent": "Bot-War-Room/2.12", ...(options?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${provider} HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }
    const payload = await response.json() as T;
    markProviderSuccess(provider);
    return payload;
  } catch (error) {
    if (!softFailure) markProviderFailure(provider, error);
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

function nestedArray(payload: any): any[] {
  const candidates = [payload?.data?.items, payload?.data?.tokens, payload?.data?.list, payload?.data, payload?.items, payload?.tokens, payload];
  return candidates.find(Array.isArray) ?? [];
}

function discoveryRow(row: any, chainId: string, source: DiscoveryToken["source"]): DiscoveryToken | null {
  const tokenAddress = String(row?.address ?? row?.tokenAddress ?? row?.token_address ?? row?.mint ?? row?.baseAddress ?? "");
  if (tokenAddress.length < 8) return null;
  const timestamp = firstNumber(row, ["liquidityAddedAt", "liquidity_added_at", "listedAt", "listed_at", "createdAt", "created_at", "blockUnixTime"]);
  return {
    chainId,
    tokenAddress,
    source,
    listedAt: timestamp ? (timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp) : undefined,
    reportedLiquidity: firstNumber(row, ["liquidity", "liquidityUsd", "liquidity_usd"]),
    symbol: row?.symbol ? String(row.symbol) : undefined,
    name: row?.name ? String(row.name) : undefined,
    imageUrl: [row?.imageUrl, row?.image_url, row?.logoURI, row?.logo_uri, row?.logoUrl, row?.logo, row?.icon]
      .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) as string | undefined,
  };
}

async function geckoNewPools(chain: Chain): Promise<DiscoveryToken[]> {
  const network = GECKO_CHAIN[chain];
  if (!network) return [];
  const cached = geckoDiscoveryCache.get(network);
  if (cached && Date.now() - cached.at < GECKO_CACHE_MS) return cached.tokens;

  const payload = await fetchJson<any>(
    `${GECKO_BASE}/networks/${network}/new_pools?page=1&include=base_token`,
    "geckoterminal",
    { headers: { Accept: "application/json;version=20230203" } }
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const tokens: DiscoveryToken[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const relId = String(row?.relationships?.base_token?.data?.id ?? "");
    const prefix = `${network}_`;
    const tokenAddress = relId.startsWith(prefix) ? relId.slice(prefix.length) : relId.includes("_") ? relId.slice(relId.indexOf("_") + 1) : relId;
    if (tokenAddress.length < 8) continue;
    const key = tokenAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const attrs = row?.attributes ?? {};
    const created = Date.parse(String(attrs.pool_created_at ?? ""));
    tokens.push({
      chainId: DEX_CHAIN[chain],
      tokenAddress,
      source: "geckoterminal",
      listedAt: Number.isFinite(created) ? created : undefined,
      reportedLiquidity: optionalNum(attrs.reserve_in_usd),
      symbol: undefined,
      name: String(attrs.name ?? "").slice(0, 80) || undefined,
      imageUrl: typeof attrs.image_url === "string" && /^https?:\/\//i.test(attrs.image_url) ? attrs.image_url : undefined,
    });
  }

  geckoDiscoveryCache.set(network, { at: Date.now(), tokens: tokens.slice(0, 30) });
  return tokens.slice(0, 30);
}

async function birdeyeNewListings(chain: Chain): Promise<DiscoveryToken[]> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  const chainId = BIRDEYE_CHAIN[chain];
  if (!apiKey || !chainId) return [];
  const url = new URL(`${BIRDEYE_BASE}/defi/v2/tokens/new_listing`);
  url.searchParams.set("limit", "20");
  if (chain === "Solana") url.searchParams.set("meme_platform_enabled", "true");
  const payload = await fetchJson<any>(url.toString(), "birdeye", { headers: birdeyeHeaders(chainId) });
  if (!payload) return [];
  return nestedArray(payload).map((row) => discoveryRow(row, DEX_CHAIN[chain], "birdeye")).filter(Boolean) as DiscoveryToken[];
}

async function latestDexListings(): Promise<any[]> {
  const cached = globalCache.__bwrDexLatestAll;
  if (cached && Date.now() - cached.at < 15_000) return cached.rows;
  if (globalCache.__bwrDexLatestPending) return globalCache.__bwrDexLatestPending;
  const endpoints = ["token-profiles/latest/v1", "token-boosts/latest/v1", "community-takeovers/latest/v1"];
  const pending = Promise.all(endpoints.map((path) => fetchJson<any[]>(`${DEX_BASE}/${path}`, "dexscreener")))
    .then((results) => {
      const rows = results.flatMap((value) => Array.isArray(value) ? value : []);
      globalCache.__bwrDexLatestAll = { at: Date.now(), rows };
      return rows;
    }).finally(() => { globalCache.__bwrDexLatestPending = undefined; });
  globalCache.__bwrDexLatestPending = pending;
  return pending;
}

async function dexDiscoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  const dexChain = DEX_CHAIN[chain];
  const cached = dexDiscoveryCache.get(dexChain);
  if (cached && Date.now() - cached.at < 15_000) return cached.tokens;
  const combined = (await latestDexListings())
    .filter((row) => row?.chainId === dexChain)
    .map((row) => discoveryRow({ ...row, address: row.tokenAddress }, dexChain, "dexscreener"))
    .filter(Boolean) as DiscoveryToken[];
  const out: DiscoveryToken[] = [];
  const seen = new Set<string>();
  for (const token of combined) {
    const key = token.tokenAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  dexDiscoveryCache.set(dexChain, { at: Date.now(), tokens: out.slice(0, 30) });
  return out.slice(0, 30);
}

async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  // V2.25: merge all fresh-listing sources instead of stopping at the first provider.
  // This is critical for $10K-$50K runners because one provider may see a pool before another.
  const [fromBirdeye, fromGecko, fromDex] = await Promise.all([
    birdeyeNewListings(chain), geckoNewPools(chain), dexDiscoveryTokens(chain),
  ]);
  const merged: DiscoveryToken[] = [];
  const seen = new Set<string>();
  for (const token of [...fromBirdeye, ...fromGecko, ...fromDex]) {
    const key = token.tokenAddress.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
  }
  return merged.sort((a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0)).slice(0, 60);
}

async function dexPairsForAddresses(chain: Chain, addresses: string[]): Promise<DexPair[]> {
  if (!addresses.length) return [];
  const url = `${DEX_BASE}/tokens/v1/${DEX_CHAIN[chain]}/${addresses.slice(0, 30).map(encodeURIComponent).join(",")}`;
  const payload = await fetchJson<DexPair[]>(url, "dexscreener");
  return Array.isArray(payload) ? payload : [];
}
async function dexPairsForToken(chain: Chain, address: string): Promise<DexPair[]> {
  const payload = await fetchJson<DexPair[]>(`${DEX_BASE}/token-pairs/v1/${DEX_CHAIN[chain]}/${encodeURIComponent(address)}`, "dexscreener");
  return Array.isArray(payload) ? payload : [];
}
function chooseBestPair(pairs: DexPair[], tokenAddress: string) {
  const wanted = tokenAddress.toLowerCase();
  return pairs.filter((pair) => String(pair.baseToken?.address ?? "").toLowerCase() === wanted)
    .sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
}
function txBucket(pair: DexPair, bucket: string): DexTxBucket { return pair.txns?.[bucket] ?? {}; }
function volumeBucket(pair: DexPair, bucket: string) { return num(pair.volume?.[bucket]); }
function priceChangeBucket(pair: DexPair, bucket: string) { return num(pair.priceChange?.[bucket]); }
function candidateScore(pair: DexPair) {
  const liquidity = Math.max(1, num(pair.liquidity?.usd));
  const liq = Math.log10(liquidity);
  const volume1h = volumeBucket(pair, "h1") || volumeBucket(pair, "h24");
  const volume = Math.log10(Math.max(1, volume1h));
  const tx = txBucket(pair, "h1");
  const m5 = txBucket(pair, "m5");
  const buys = num(m5.buys, num(tx.buys));
  const sells = num(m5.sells, num(tx.sells));
  const activity = Math.log10(Math.max(1, num(tx.buys) + num(tx.sells)));
  const pressure = sells > 0 ? Math.max(0, Math.min(3, buys / sells)) : buys > 0 ? 2.5 : 1;
  const ageMinutes = pair.pairCreatedAt ? Math.max(1, (Date.now() - num(pair.pairCreatedAt)) / 60_000) : 1440;
  const freshness = ageMinutes <= 30 ? 7 : ageMinutes <= 120 ? 5 : ageMinutes <= 360 ? 2.5 : ageMinutes <= 1440 ? 1 : 0;
  const mc = num(pair.marketCap, num(pair.fdv, 0));
  const earlyRunnerBonus = mc >= 10_000 && mc <= 50_000 ? 9 : mc >= 8_000 && mc <= 80_000 ? 6 : mc > 0 && mc <= 150_000 ? 2 : 0;
  const turnover = mc > 0 ? Math.min(5, volume1h / mc) : 0;
  return liq * 0.8 + volume * 1.1 + activity * 1.15 + freshness + earlyRunnerBonus + pressure * 1.7 + turnover * 1.8;
}

function sumTop10(holders: any): { value?: number; verified: boolean } {
  if (!Array.isArray(holders) || !holders.length) return { verified: false };
  const value = holders.slice(0, 10).reduce((sum: number, holder: any) => sum + pctValue(holder?.percent ?? holder?.percentage), 0);
  return { value: clamp(value, 0, 100), verified: true };
}
function selectGoPlusRow(payload: any, address: string) {
  const result = payload?.result;
  if (!result || typeof result !== "object") return null;
  return result[address] ?? result[address.toLowerCase()] ?? result[address.toUpperCase()] ?? Object.values(result)[0] ?? null;
}

async function birdeyeSecurity(chain: Chain, address: string): Promise<SecurityResult> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  const chainId = BIRDEYE_CHAIN[chain];
  if (!apiKey || !chainId) return emptySecurity();
  const url = new URL(`${BIRDEYE_BASE}/defi/token_security`);
  url.searchParams.set("address", address);
  const payload = await fetchJson<any>(url.toString(), "birdeye", { headers: birdeyeHeaders(chainId) });
  const row = payload?.data ?? payload?.result ?? null;
  if (!row || typeof row !== "object") return emptySecurity();

  const q = blankQuality();
  const out = emptySecurity();
  out.source = "birdeye";
  out.verified = true;

  const holderCount = firstNumber(row, ["holderCount", "holder_count", "holders"]);
  if (holderCount !== undefined) { out.holders = holderCount; q.holders = true; }
  const top10 = firstNumber(row, ["top10HolderPercent", "top10_holder_percent", "top10HolderPercentage", "top10_holder_percentage"]);
  if (top10 !== undefined) { out.top10Pct = clamp(pctValue(top10), 0, 100); q.top10 = true; }

  const buyTax = firstNumber(row, ["buyTax", "buy_tax", "buyTaxPct", "buy_tax_pct"]);
  const sellTax = firstNumber(row, ["sellTax", "sell_tax", "sellTaxPct", "sell_tax_pct"]);
  if (buyTax !== undefined || sellTax !== undefined) {
    out.buyTaxPct = pctValue(buyTax ?? 0); out.sellTaxPct = pctValue(sellTax ?? 0); q.taxes = true;
  }
  const honeypot = firstBoolean(row, ["isHoneypot", "is_honeypot", "honeypot"]);
  if (honeypot !== undefined) { out.honeypot = honeypot; q.honeypot = true; out.sellable = !honeypot; q.sellability = true; }

  const lock = firstBoolean(row, ["liquidityLocked", "liquidity_locked", "lpLocked", "lp_locked", "isLiquidityLocked"]);
  if (lock !== undefined) { out.liquidityLocked = lock; q.liquidityLock = true; }
  const proxy = firstBoolean(row, ["isProxy", "is_proxy", "proxyContract", "proxy_contract"]);
  if (proxy !== undefined) out.proxyContract = proxy;

  if (chain === "Solana") {
    // Only mark authority safety verified when both authority domains are explicitly present.
    const hasMintAuthorityField = hasOwn(row, "ownerAddress") || hasOwn(row, "owner_address") || hasOwn(row, "mintAuthority") || hasOwn(row, "mint_authority");
    const hasFreezeAuthorityField = hasOwn(row, "freezeAuthority") || hasOwn(row, "freeze_authority") || hasOwn(row, "freezeable");
    if (hasMintAuthorityField) {
      const owner = firstValue(row, ["ownerAddress", "owner_address", "mintAuthority", "mint_authority"]);
      out.mintAuthority = Boolean(owner);
    }
    if (hasFreezeAuthorityField) {
      const authority = firstValue(row, ["freezeAuthority", "freeze_authority"]);
      const freezeable = firstBoolean(row, ["freezeable"]);
      out.freezeAuthority = Boolean(authority) || freezeable === true;
    }
    q.authorities = hasMintAuthorityField && hasFreezeAuthorityField;
    const nonTransferable = firstBoolean(row, ["nonTransferable", "non_transferable"]);
    if (nonTransferable !== undefined) {
      out.sellable = !nonTransferable;
      out.honeypot = nonTransferable;
      q.sellability = true;
      q.honeypot = true;
    }
    out.ownershipRenounced = out.mintAuthority === false;
    q.ownership = q.authorities;
  } else {
    const owner = firstValue(row, ["ownerAddress", "owner_address", "owner"]);
    if (owner !== undefined) {
      const text = String(owner ?? "").toLowerCase();
      out.ownershipRenounced = !text || /^0x0+$/.test(text) || text === "0x000000000000000000000000000000000000dead";
      q.ownership = true;
    }
  }
  out.quality = q;
  out.notes.push("Birdeye token-security enrichment received.");
  return out;
}

async function goPlusSecurity(chain: Chain, address: string): Promise<SecurityResult> {
  let url: string | undefined;
  if (chain === "Solana") url = `${GOPLUS_BASE}/solana/token_security?contract_addresses=${encodeURIComponent(address)}`;
  else if (GOPLUS_CHAIN[chain]) url = `${GOPLUS_BASE}/token_security/${GOPLUS_CHAIN[chain]}?contract_addresses=${encodeURIComponent(address)}`;
  if (!url) return emptySecurity();
  const payload = await fetchJson<any>(url, "goplus", { headers: goPlusHeaders() });
  const row: any = selectGoPlusRow(payload, address);
  if (!row) return emptySecurity();

  const q = blankQuality();
  const out = emptySecurity();
  out.verified = true;
  out.source = "goplus";
  const top10 = sumTop10(row.holders);
  if (top10.verified) { out.top10Pct = top10.value; q.top10 = true; }
  const holderCount = firstNumber(row, ["holder_count", "holderCount"]);
  if (holderCount !== undefined && holderCount > 0) { out.holders = holderCount; q.holders = true; }

  if (chain === "Solana") {
    const hasTransferabilityEvidence = hasOwn(row, "non_transferable") || (row?.transfer_hook && typeof row.transfer_hook === "object");
    const transferHookMalicious = bool1(row?.transfer_hook?.malicious_address);
    const nonTransferable = bool1(row.non_transferable);
    if (hasTransferabilityEvidence) {
      out.sellable = !nonTransferable && !transferHookMalicious;
      out.honeypot = nonTransferable || transferHookMalicious;
      q.sellability = true; q.honeypot = true;
    }
    const hasMintEvidence = hasOwn(row, "mintable");
    const hasFreezeEvidence = hasOwn(row, "freezable");
    const mintFlag = firstBoolean(row, ["mintable"]);
    const freezeFlag = firstBoolean(row, ["freezable"]);
    if (hasMintEvidence) out.mintAuthority = bool1(row?.mintable?.status) || mintFlag === true;
    if (hasFreezeEvidence) out.freezeAuthority = bool1(row?.freezable?.status) || freezeFlag === true;
    q.authorities = hasMintEvidence && hasFreezeEvidence;
    const hasTransferFeeEvidence = hasOwn(row, "transfer_fee");
    const currentTransferFee = pctValue(row?.transfer_fee?.current_fee_rate?.fee_rate ? num(row.transfer_fee.current_fee_rate.fee_rate) / 10_000 : 0);
    if (hasTransferFeeEvidence) { out.buyTaxPct = currentTransferFee; out.sellTaxPct = currentTransferFee; q.taxes = true; }
    const lpHolders = Array.isArray(row.lp_holders) ? row.lp_holders : [];
    const lockedLpPct = lpHolders.filter((h: any) => bool1(h?.is_locked)).reduce((s: number, h: any) => s + pctValue(h?.percent), 0);
    out.liquidityLocked = bool1(row.is_locked) || lockedLpPct > 0;
    q.liquidityLock = hasOwn(row, "is_locked") || lpHolders.length > 0;
    out.ownershipRenounced = !out.mintAuthority; q.ownership = true;
    out.proxyContract = false;
  } else {
    const hasHoneypotEvidence = hasOwn(row, "is_honeypot");
    const hasSellEvidence = hasHoneypotEvidence || hasOwn(row, "cannot_sell_all");
    const cannotSellAll = bool1(row.cannot_sell_all);
    const honeypot = bool1(row.is_honeypot);
    if (hasHoneypotEvidence) { out.honeypot = honeypot; q.honeypot = true; }
    if (hasSellEvidence) { out.sellable = !honeypot && !cannotSellAll; q.sellability = true; }
    out.buyTaxPct = pctValue(row.buy_tax); out.sellTaxPct = pctValue(row.sell_tax); q.taxes = hasOwn(row, "buy_tax") || hasOwn(row, "sell_tax");
    const owner = String(row.owner_address ?? "").toLowerCase();
    out.ownershipRenounced = !owner || /^0x0+$/.test(owner) || owner === "0x000000000000000000000000000000000000dead";
    q.ownership = hasOwn(row, "owner_address");
    out.proxyContract = bool1(row.is_proxy);
    const lpHolders = Array.isArray(row.lp_holders) ? row.lp_holders : [];
    out.liquidityLocked = lpHolders.some((h: any) => bool1(h?.is_locked));
    q.liquidityLock = lpHolders.length > 0;
  }
  out.quality = q;
  out.notes.push("GoPlus token-security enrichment received.");
  return out;
}

function heliusRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`;
  return undefined;
}
async function heliusRpc(method: string, params: any): Promise<any | null> {
  const url = heliusRpcUrl();
  if (!url) return null;
  return fetchJson<any>(url, "helius", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `bwr-${method}`, method, params }),
  });
}

async function heliusSecurity(address: string): Promise<SecurityResult> {
  if (!heliusRpcUrl()) return emptySecurity();
  const [account, supply, largest, tokenAccounts] = await Promise.all([
    heliusRpc("getAccountInfo", [address, { encoding: "jsonParsed" }]),
    heliusRpc("getTokenSupply", [address]),
    heliusRpc("getTokenLargestAccounts", [address]),
    heliusRpc("getTokenAccounts", { page: 1, limit: 1, displayOptions: {}, mint: address }),
  ]);
  const out = emptySecurity();
  const q = blankQuality();
  const info = account?.result?.value?.data?.parsed?.info;
  if (info) {
    out.mintAuthority = Boolean(info.mintAuthority);
    out.freezeAuthority = Boolean(info.freezeAuthority);
    out.ownershipRenounced = !out.mintAuthority;
    q.authorities = true; q.ownership = true;
  }
  const supplyRaw = optionalNum(supply?.result?.value?.amount);
  const largestRows = largest?.result?.value;
  if (supplyRaw && Array.isArray(largestRows)) {
    const topRaw = largestRows.slice(0, 10).reduce((sum: number, row: any) => sum + num(row?.amount), 0);
    out.top10Pct = clamp(topRaw / supplyRaw * 100, 0, 100);
    q.top10 = true;
  }
  const total = optionalNum(tokenAccounts?.result?.total);
  if (total !== undefined && total >= 0) { out.holders = total; q.holders = true; }
  out.verified = q.authorities || q.top10 || q.holders;
  out.source = out.verified ? "helius" : "unavailable";
  out.quality = q;
  if (out.verified) out.notes.push("Helius RPC verified Solana mint authorities/holder structure where available.");
  return out;
}

function findTaggedPercent(node: any, targetTag: string, depth = 0): number | undefined {
  if (!node || typeof node !== "object" || depth > 7) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findTaggedPercent(item, targetTag, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const tag = String(node.tag ?? node.type ?? node.name ?? node.label ?? "").toLowerCase();
  if (tag === targetTag.toLowerCase()) {
    const n = firstNumber(node, ["percent", "percentage", "pct", "supplyPercent", "supply_percent", "percentOfSupply", "percent_of_supply"]);
    if (n !== undefined) return clamp(pctValue(n), 0, 100);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === targetTag.toLowerCase() && value && typeof value === "object") {
      const n = firstNumber(value, ["percent", "percentage", "pct", "supplyPercent", "supply_percent", "percentOfSupply", "percent_of_supply"]);
      if (n !== undefined) return clamp(pctValue(n), 0, 100);
    }
    const nested = findTaggedPercent(value, targetTag, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

async function birdeyeHolderProfile(address: string): Promise<Partial<SecurityResult>> {
  if (!process.env.BIRDEYE_API_KEY) return {};
  const url = new URL(`${BIRDEYE_BASE}/token/v1/holder-profile`);
  url.searchParams.set("token_address", address);
  const payload = await fetchJson<any>(url.toString(), "birdeye", { headers: birdeyeHeaders("solana") }, true);
  const data = payload?.data;
  if (!data || typeof data !== "object") return {};
  const bundledPct = findTaggedPercent(data, "bundler");
  const top10Pct = firstNumber(data, ["top10HolderPercent", "top10_holder_percent", "top10Percent", "top10_percent"]);
  const holders = firstNumber(data, ["holderCount", "holder_count", "holders"]);
  return {
    bundledPct,
    top10Pct: top10Pct === undefined ? undefined : clamp(pctValue(top10Pct), 0, 100),
    holders,
  };
}

function mergeSecurity(results: SecurityResult[], holderProfile?: Partial<SecurityResult>): SecurityResult {
  const usable = results.filter((result) => result.verified);
  const out = emptySecurity();
  if (!usable.length && !holderProfile) return out;
  const choose = <K extends keyof SecurityResult>(key: K): SecurityResult[K] | undefined => {
    for (const result of usable) if (result[key] !== undefined) return result[key];
    return undefined;
  };
  out.verified = usable.length > 0;
  out.source = usable.length > 1 ? "multi" : usable[0]?.source ?? "unavailable";
  out.sellable = choose("sellable"); out.honeypot = choose("honeypot");
  out.buyTaxPct = choose("buyTaxPct"); out.sellTaxPct = choose("sellTaxPct");
  out.holders = holderProfile?.holders ?? choose("holders");
  out.top10Pct = holderProfile?.top10Pct ?? choose("top10Pct");
  out.bundledPct = holderProfile?.bundledPct ?? choose("bundledPct");
  out.liquidityLocked = choose("liquidityLocked"); out.mintAuthority = choose("mintAuthority");
  out.freezeAuthority = choose("freezeAuthority"); out.ownershipRenounced = choose("ownershipRenounced"); out.proxyContract = choose("proxyContract");
  out.quality = blankQuality();
  for (const key of Object.keys(out.quality) as Array<keyof DataQuality>) {
    out.quality[key] = usable.some((result) => Boolean(result.quality[key])) as never;
  }
  if (holderProfile?.bundledPct !== undefined) out.quality.bundled = true;
  if (holderProfile?.top10Pct !== undefined) out.quality.top10 = true;
  if (holderProfile?.holders !== undefined) out.quality.holders = true;
  out.notes = usable.flatMap((result) => result.notes);
  if (holderProfile?.bundledPct !== undefined) out.notes.push(`Birdeye holder profile reports ${holderProfile.bundledPct.toFixed(1)}% bundled supply.`);
  return out;
}

async function fetchSecurity(chain: Chain, address: string): Promise<SecurityResult> {
  const cacheKey = `${chain}:${address}`;
  const cached = securityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const [birdeye, goplus, helius, holderProfile] = await Promise.all([
    birdeyeSecurity(chain, address),
    goPlusSecurity(chain, address),
    chain === "Solana" ? heliusSecurity(address) : Promise.resolve(emptySecurity()),
    chain === "Solana" ? birdeyeHolderProfile(address) : Promise.resolve({}),
  ]);
  const output = mergeSecurity([birdeye, goplus, helius], holderProfile);
  securityCache.set(cacheKey, { at: Date.now(), value: output });
  return output;
}

function deriveVolumeAcceleration(pair: DexPair) {
  const h1 = volumeBucket(pair, "h1");
  const h6 = volumeBucket(pair, "h6");
  if (h6 <= h1 || h6 <= 0) return 0;
  const priorHourly = (h6 - h1) / 5;
  return priorHourly > 0 ? clamp((h1 / priorHourly - 1) * 100, -100, 1000) : 0;
}
function deriveVolatility(pair: DexPair) {
  const m5 = Math.abs(priceChangeBucket(pair, "m5"));
  const h1 = Math.abs(priceChangeBucket(pair, "h1"));
  const h6 = Math.abs(priceChangeBucket(pair, "h6"));
  const h24 = Math.abs(priceChangeBucket(pair, "h24"));
  return clamp((m5 / 12 + h1 / 35 + h6 / 80 + h24 / 180) / 2.2, 0.05, 1.5);
}
function inferredAssetClass(pair: DexPair, chain: Chain, ageMinutes: number, marketCap: number, volume24h: number): MarketSnapshot["assetClass"] {
  const dex = String(pair.dexId ?? "").toLowerCase();
  const address = String(pair.baseToken?.address ?? "");
  if (dex.includes("pump") || dex.includes("moonshot") || dex.includes("four") || (chain === "Solana" && address.toLowerCase().endsWith("pump"))) return "meme";
  if (ageMinutes <= 1440 && marketCap > 0 && marketCap <= 50_000_000 && volume24h / Math.max(marketCap, 1) >= 0.25) return "meme";
  return "unknown";
}

function launchpadState(pair: DexPair, chain: Chain, tokenAddress: string): NonNullable<MarketSnapshot["launchpad"]> | undefined {
  const dex = String(pair.dexId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const address = tokenAddress.toLowerCase();
  const platform = dex.includes("pumpfun") || address.endsWith("pump") ? "pumpfun"
    : dex.includes("moonshot") ? "moonshot"
      : dex.includes("fourmeme") || dex === "four" ? "fourmeme"
        : dex.includes("fomo") ? "fomo"
          : undefined;
  if (!platform) return undefined;
  const bondingVenue = (platform === "pumpfun" && dex === "pumpfun") ||
    (platform === "moonshot" && dex.includes("moonshot")) ||
    (platform === "fourmeme" && (dex.includes("fourmeme") || dex === "four")) ||
    (platform === "fomo" && dex.includes("fomo"));
  if (bondingVenue) {
    return {
      detected: true,
      platform,
      status: "bonding",
      evidence: `${pair.dexId ?? platform} is the launchpad/bonding venue; no post-graduation DEX pool is verified.`,
    };
  }
  const pairAddress = String(pair.pairAddress ?? "");
  const liquidity = num(pair.liquidity?.usd, 0);
  return {
    detected: true,
    platform,
    status: pairAddress && liquidity > 0 ? "graduated" : "unknown",
    evidence: pairAddress && liquidity > 0
      ? `Post-launchpad ${pair.dexId ?? "DEX"} pool ${pairAddress.slice(0, 8)}… has executable liquidity.`
      : "Launchpad origin detected, but a post-graduation DEX pool could not be verified.",
  };
}

function snapshotFromPair(chain: Chain, pair: DexPair, security: SecurityResult, discoverySource: DiscoveryToken["source"] = "dexscreener", fallbackImageUrl?: string, allowNonExecutable = false, fallbackPrice = 0): MarketSnapshot | null {
  const reportedPrice = num(pair.priceUsd, 0);
  const price = reportedPrice > 0 ? reportedPrice : Math.max(0, fallbackPrice);
  const liquidity = num(pair.liquidity?.usd, 0);
  const tokenAddress = String(pair.baseToken?.address ?? "");
  if (!tokenAddress || (!allowNonExecutable && (price <= 0 || liquidity <= 0))) return null;
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
  const bundledPct = security.bundledPct ?? 0;
  const boostCount = num(pair.boosts?.active, 0);
  const q = { ...security.quality };
  const launchpad = launchpadState(pair, chain, tokenAddress);

  return {
    symbol: String(pair.baseToken?.symbol ?? "UNKNOWN").replace(/^\$/, "").slice(0, 20),
    name: String(pair.baseToken?.name ?? pair.baseToken?.symbol ?? "Unknown token").slice(0, 80),
    imageUrl: typeof pair.info?.imageUrl === "string" && /^https?:\/\//i.test(pair.info.imageUrl)
      ? pair.info.imageUrl
      : fallbackImageUrl,
    tokenAddress, chain, chainFamily: chain === "Solana" ? "solana" : "evm", venue: `DEX Screener · ${pair.dexId ?? "DEX"}`,
    price, priceChange24h: priceChangeBucket(pair, "h24"), marketCap, liquidity, volume5m, volume24h, holders, ageMinutes, buySellRatio,
    smartMoneyBuys: 0, smartMoneySells: 0, socialVelocityPct: 0, top10Pct, bundledPct, devRugHistory: 0,
    volatility: deriveVolatility(pair), sellable: security.sellable ?? false, honeypot: security.honeypot ?? false,
    buyTaxPct: security.buyTaxPct ?? 0, sellTaxPct: security.sellTaxPct ?? 0, liquidityLocked: security.liquidityLocked ?? false,
    mintAuthority: security.mintAuthority ?? false, freezeAuthority: security.freezeAuthority ?? false,
    ownershipRenounced: security.ownershipRenounced ?? false, proxyContract: security.proxyContract ?? false,
    volumeAccelerationPct, marketCapChange5mPct: priceChangeBucket(pair, "m5"),
    assetClass: inferredAssetClass(pair, chain, ageMinutes, marketCap, volume24h),
    launchpad,
    launchMetrics: {
      holdersPerMinute: q.holders && holders > 0 && ageMinutes <= 1440 ? holders / Math.max(1, ageMinutes) : undefined,
      transactionsPerMinute: tx1h > 0 ? tx1h / Math.min(60, Math.max(1, ageMinutes)) : undefined,
      volumeUsdPerMinute: ageMinutes <= 60 && volume1h > 0 ? volume1h / Math.max(1, ageMinutes) : volume1h > 0 ? volume1h / 60 : volume5m > 0 ? volume5m / 5 : undefined,
      volumeAccelerationPct,
    },
    dataProvenance: {
      live: true,
      marketSource: discoverySource,
      securitySource: security.source,
      fetchedAt: new Date().toISOString(), pairAddress: pair.pairAddress, quality: q,
      notes: [
        `${discoverySource === "birdeye" ? "Birdeye New Listing" : discoverySource === "geckoterminal" ? "GeckoTerminal New Pool" : "DEX Screener live discovery"} found this real candidate; DEX Screener supplies live pair price/liquidity/volume/transactions.`,
        ...security.notes,
        q.sellability && q.honeypot ? "Sellability/honeypot evidence is verified." : "Sellability/honeypot evidence is incomplete; deterministic risk fails closed.",
        q.authorities || chain !== "Solana" ? "Authority evidence is available where applicable." : "Solana mint/freeze authority evidence is incomplete; deterministic risk fails closed.",
        q.bundled ? "Bundled-supply evidence is available." : "Bundled-supply evidence is unverified and cannot be treated as zero-risk.",
        boostCount > 0 ? `DEX Screener reports ${boostCount} active boost(s); no social score is fabricated from boosts.` : "Dedicated social velocity is not connected; Social Scout treats that domain as unverified.",
        ...(launchpad ? [`Launchpad graduation: ${launchpad.status.toUpperCase()} · ${launchpad.evidence}`] : []),
        "Smart-money counts remain unverified unless a dedicated provider supplies them; zero is not treated as verified flow.",
      ],
    },
  };
}

function unseen(tokens: DiscoveryToken[]) {
  const now = Date.now();
  for (const [key, at] of candidateSeen) if (now - at > CANDIDATE_COOLDOWN_MS * 3) candidateSeen.delete(key);
  const fresh = tokens.filter((token) => now - (candidateSeen.get(`${token.chainId}:${token.tokenAddress.toLowerCase()}`) ?? 0) >= CANDIDATE_COOLDOWN_MS);
  return fresh;
}
function markSeen(token: DiscoveryToken) { candidateSeen.set(`${token.chainId}:${token.tokenAddress.toLowerCase()}`, Date.now()); }

async function directLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const tokens = unseen(await discoveryTokens(chain));
  if (!tokens.length) return null;
  const addresses = tokens.map((row) => row.tokenAddress);
  const pairs = await dexPairsForAddresses(chain, addresses);
  if (!pairs.length) return null;
  const tokenByAddress = new Map(tokens.map((token) => [token.tokenAddress.toLowerCase(), token]));
  const ranked = addresses.map((address) => chooseBestPair(pairs, address)).filter(Boolean) as DexPair[];
  ranked.sort((a, b) => candidateScore(b) - candidateScore(a));

  // Return one real candidate per cycle so the council can evaluate broadly instead of replaying one token forever.
  for (const pair of ranked.slice(0, 24)) {
    const address = String(pair.baseToken?.address ?? "");
    if (!address || num(pair.priceUsd) <= 0 || num(pair.liquidity?.usd) < Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_DISCOVERY_MIN_LIQUIDITY_USD ?? 1_000))) continue;
    const token = tokenByAddress.get(address.toLowerCase());
    if (token) markSeen(token);
    const security = await fetchSecurity(chain, address);
    const snapshot = snapshotFromPair(chain, pair, security, token?.source ?? "dexscreener", token?.imageUrl);
    if (snapshot) return snapshot;
  }
  return null;
}

export function liveMarketDataMode(): "adapter" | "birdeye" | "dexscreener" {
  if (configuredLiveAdapterBase()) return "adapter";
  return process.env.BIRDEYE_API_KEY ? "birdeye" : "dexscreener";
}

export async function fetchLivePositionSnapshot(position: ManagedPosition): Promise<MarketSnapshot | null> {
  const base = configuredLiveAdapterBase();
  if (base) {
    try {
      const url = new URL("/snapshot", base);
      url.searchParams.set("chain", position.chain); url.searchParams.set("address", position.tokenAddress);
      const response = await fetch(url, { headers: adapterHeaders(), cache: "no-store", signal: AbortSignal.timeout(4_500) });
      if (!response.ok) return null;
      const payload = await response.json();
      return looksLikeSnapshot(payload) ? payload : null;
    } catch { return null; }
  }
  const pairs = await dexPairsForToken(position.chain, position.tokenAddress);
  const pair = chooseBestPair(pairs, position.tokenAddress);
  if (!pair) return null;
  const security = await fetchSecurity(position.chain, position.tokenAddress);
  // Held positions must retain a zero-liquidity snapshot so Guardian can mark
  // them unsellable. Candidate discovery still rejects the same snapshot.
  return snapshotFromPair(position.chain, pair, security, process.env.BIRDEYE_API_KEY && BIRDEYE_CHAIN[position.chain] ? "birdeye" : "dexscreener", position.imageUrl, true, position.markPrice);
}

export async function fetchLiveCandidate(chain: Chain): Promise<MarketSnapshot | null> {
  const base = configuredLiveAdapterBase();
  if (base) {
    try {
      const url = new URL("/candidate", base); url.searchParams.set("chain", chain);
      const response = await fetch(url, { headers: adapterHeaders(), cache: "no-store", signal: AbortSignal.timeout(4_500) });
      if (!response.ok) return null;
      const payload = await response.json();
      return looksLikeSnapshot(payload) ? payload : null;
    } catch { return null; }
  }
  return directLiveCandidate(chain);
}

export async function fetchHistoricalFrames(chain: Chain, limit = 5000): Promise<HistoricalFrame[]> {
  const base = process.env.MARKET_DATA_BASE_URL;
  if (!base) return [];
  try {
    const url = new URL("/history", base);
    url.searchParams.set("chain", chain); url.searchParams.set("limit", String(Math.min(50_000, Math.max(1, limit))));
    const response = await fetch(url, { headers: adapterHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload.filter((row) => row && typeof row === "object" && looksLikeSnapshot((row as HistoricalFrame).snapshot)) as HistoricalFrame[] : [];
  } catch { return []; }
}
