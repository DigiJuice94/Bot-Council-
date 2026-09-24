import type { ManagedPosition, MarketSnapshot } from "./types";

export type SellAuditStatus = "pass" | "fail" | "unknown";
export type SellAuditProvider = "jupiter" | "zeroex" | "security" | "unsupported";

export type SellabilityAudit = {
  status: SellAuditStatus;
  provider: SellAuditProvider;
  checkedAt: string;
  routeVerified: boolean;
  reason: string;
  expectedOutUsd?: number;
  priceImpactPct?: number;
};

const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const EVM_PUBLIC_RPC: Partial<Record<MarketSnapshot["chain"], string>> = {
  Ethereum: "https://ethereum-rpc.publicnode.com",
  Base: "https://mainnet.base.org",
  "BNB Chain": "https://bsc-dataseed.binance.org",
};
const mintDecimals = new Map<string, number>();
function cacheDecimals(key: string, decimals: number) {
  if (mintDecimals.size >= 512) mintDecimals.delete(mintDecimals.keys().next().value!);
  mintDecimals.set(key, decimals);
}
const EVM_CONFIG: Partial<Record<MarketSnapshot["chain"], { chainId: number; stable: string; stableDecimals: number }>> = {
  Ethereum: { chainId: 1, stable: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", stableDecimals: 6 },
  Base: { chainId: 8453, stable: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", stableDecimals: 6 },
  "BNB Chain": { chainId: 56, stable: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", stableDecimals: 18 },
};

function finite(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function verifiedDecimals(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 30 ? value : undefined;
}

async function resolveDecimals(snapshot: MarketSnapshot): Promise<number | undefined> {
  const direct = verifiedDecimals(snapshot.tokenDecimals);
  if (direct !== undefined) return direct;
  const mintKey = `${snapshot.chain}:${snapshot.tokenAddress.toLowerCase()}`;
  const cached = mintDecimals.get(mintKey);
  if (cached !== undefined) return cached;
  if (snapshot.chain !== "Solana") {
    const url = EVM_PUBLIC_RPC[snapshot.chain];
    if (!url || !/^0x[0-9a-fA-F]{40}$/.test(snapshot.tokenAddress)) return undefined;
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: snapshot.tokenAddress, data: "0x313ce567" }, "latest"] }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return undefined;
      const payload = await response.json();
      const raw = payload?.result;
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(raw)) return undefined;
      const decimals = verifiedDecimals(Number(BigInt(raw)));
      if (decimals !== undefined) cacheDecimals(mintKey, decimals);
      return decimals;
    } catch { return undefined; }
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(snapshot.tokenAddress)) return undefined;
  const urls = [...new Set([process.env.SOLANA_RPC_URL, process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}` : undefined,
    SOLANA_PUBLIC_RPC].filter((url): url is string => Boolean(url)))];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [snapshot.tokenAddress] }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const decimals = verifiedDecimals(payload?.result?.value?.decimals);
      if (decimals === undefined) continue;
      cacheDecimals(mintKey, decimals);
      return decimals;
    } catch { /* another configured RPC may still be available */ }
  }
  return undefined;
}

function rawAmount(quantity: number, decimals: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const scale = 10 ** Math.min(decimals, 15);
  const scaled = quantity * scale;
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  let integer = BigInt(Math.max(1, Math.floor(scaled)));
  if (decimals > 15) integer *= 10n ** BigInt(decimals - 15);
  return integer.toString();
}

function hardSecurityFailure(snapshot: MarketSnapshot): SellabilityAudit | null {
  const checkedAt = new Date().toISOString();
  if (!Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0) {
    return { status: "fail", provider: "security", checkedAt, routeVerified: true, reason: "Market data reports zero executable liquidity." };
  }
  if (snapshot.honeypot) {
    return { status: "fail", provider: "security", checkedAt, routeVerified: true, reason: "Security evidence flags a honeypot." };
  }
  if (snapshot.dataProvenance?.quality?.sellability && snapshot.sellable === false) {
    return { status: "fail", provider: "security", checkedAt, routeVerified: true, reason: "Verified security evidence explicitly reports the token as unsellable." };
  }
  return null;
}

async function auditJupiter(snapshot: MarketSnapshot, quantity: number): Promise<SellabilityAudit> {
  const checkedAt = new Date().toISOString();
  const decimals = await resolveDecimals(snapshot);
  if (decimals === undefined) {
    return { status: "unknown", provider: "jupiter", checkedAt, routeVerified: false, reason: "Sellability verifier could not determine token decimals for a reverse Jupiter quote." };
  }
  const amount = rawAmount(quantity, Number(decimals));
  if (!amount) return { status: "unknown", provider: "jupiter", checkedAt, routeVerified: false, reason: "Sellability verifier could not construct the token amount for a reverse Jupiter quote." };

  const apiKey = process.env.JUPITER_API_KEY;
  const endpoints = apiKey
    ? ["https://api.jup.ag/swap/v1/quote", "https://lite-api.jup.ag/swap/v1/quote"]
    : ["https://lite-api.jup.ag/swap/v1/quote"];
  let lastProviderError = "Jupiter reverse quote unavailable.";

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("inputMint", snapshot.tokenAddress);
      url.searchParams.set("outputMint", SOLANA_USDC);
      url.searchParams.set("amount", amount);
      url.searchParams.set("slippageBps", "5000");
      url.searchParams.set("restrictIntermediateTokens", "false");
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "Bot-War-Room/3.6.1" };
      if (apiKey && endpoint.includes("api.jup.ag")) headers["x-api-key"] = apiKey;
      const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(5_000) });
      const text = await response.text();
      let payload: any = null;
      try { payload = text ? JSON.parse(text) : null; } catch { /* leave null */ }

      if (!response.ok) {
        // Provider/API errors are coverage failures, not proof that the token is locked.
        // Audit is observational: UNKNOWN must never become a chain/buy/sell blocker.
        lastProviderError = `Jupiter provider returned HTTP ${response.status}${payload?.error ? `: ${String(payload.error).slice(0, 120)}` : ""}.`;
        continue;
      }

      const outAmount = finite(payload?.outAmount);
      const routePlan = Array.isArray(payload?.routePlan) ? payload.routePlan : [];
      const impact = finite(payload?.priceImpactPct);
      if (!outAmount || outAmount <= 0 || routePlan.length === 0) {
        return { status: "fail", provider: "jupiter", checkedAt, routeVerified: true, reason: "Jupiter returned no executable token→USDC sell route." };
      }
      return {
        status: "pass",
        provider: "jupiter",
        checkedAt,
        routeVerified: true,
        expectedOutUsd: outAmount / 1_000_000,
        priceImpactPct: impact,
        reason: "Jupiter confirmed an executable reverse sell route.",
      };
    } catch (error) {
      lastProviderError = error instanceof Error ? error.message : String(error);
    }
  }

  return { status: "unknown", provider: "jupiter", checkedAt, routeVerified: false, reason: `Jupiter sell-route verification unavailable: ${lastProviderError}` };
}

async function auditZeroEx(snapshot: MarketSnapshot, quantity: number): Promise<SellabilityAudit> {
  const checkedAt = new Date().toISOString();
  const config = EVM_CONFIG[snapshot.chain];
  if (!config) return { status: "unknown", provider: "unsupported", checkedAt, routeVerified: false, reason: `No executable reverse-route provider is configured for ${snapshot.chain}.` };
  const apiKey = process.env.ZEROEX_API_KEY;
  if (!apiKey) return { status: "unknown", provider: "zeroex", checkedAt, routeVerified: false, reason: "ZEROEX_API_KEY is not configured, so the bot cannot prove an executable EVM sell route." };
  const decimals = await resolveDecimals(snapshot);
  if (decimals === undefined) return { status: "unknown", provider: "zeroex", checkedAt, routeVerified: false, reason: "Sellability verifier could not determine token decimals for the 0x reverse quote." };
  const amount = rawAmount(quantity, Number(decimals));
  if (!amount) return { status: "unknown", provider: "zeroex", checkedAt, routeVerified: false, reason: "Sellability verifier could not construct the token amount for the 0x reverse quote." };

  try {
    const url = new URL("https://api.0x.org/swap/allowance-holder/price");
    url.searchParams.set("chainId", String(config.chainId));
    url.searchParams.set("sellToken", snapshot.tokenAddress);
    url.searchParams.set("buyToken", config.stable);
    url.searchParams.set("sellAmount", amount);
    const response = await fetch(url, {
      headers: { Accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2", "User-Agent": "Bot-War-Room/3.6.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* leave null */ }

    if (!response.ok) {
      // A request/provider error is not positive evidence that capital is locked.
      return { status: "unknown", provider: "zeroex", checkedAt, routeVerified: false, reason: `0x sell-route verification unavailable (HTTP ${response.status}${payload?.reason ? `: ${String(payload.reason).slice(0, 120)}` : ""}).` };
    }
    if (payload?.liquidityAvailable === false) {
      return { status: "fail", provider: "zeroex", checkedAt, routeVerified: true, reason: "0x explicitly reports liquidityAvailable=false." };
    }
    const buyAmount = finite(payload?.buyAmount);
    if (!buyAmount || buyAmount <= 0) {
      return { status: "fail", provider: "zeroex", checkedAt, routeVerified: true, reason: "0x returned no positive output for the sell quote." };
    }
    const expectedOutUsd = buyAmount / 10 ** config.stableDecimals;
    const markedUsd = Math.max(0, quantity * snapshot.price);
    const impliedImpact = markedUsd > 0 ? Math.max(0, (1 - expectedOutUsd / markedUsd) * 100) : undefined;
    return {
      status: "pass",
      provider: "zeroex",
      checkedAt,
      routeVerified: true,
      expectedOutUsd,
      priceImpactPct: impliedImpact,
      reason: "0x confirmed an executable reverse sell route.",
    };
  } catch (error) {
    return { status: "unknown", provider: "zeroex", checkedAt, routeVerified: false, reason: `0x sell-route verification unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function auditSellQuantity(snapshot: MarketSnapshot, quantity: number): Promise<SellabilityAudit> {
  const hard = hardSecurityFailure(snapshot);
  if (hard) return hard;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { status: "unknown", provider: "security", checkedAt: new Date().toISOString(), routeVerified: false, reason: "Token quantity is invalid for sell verification." };
  }
  return snapshot.chain === "Solana" ? auditJupiter(snapshot, quantity) : auditZeroEx(snapshot, quantity);
}

export async function auditEntrySellability(snapshot: MarketSnapshot, notionalUsd: number): Promise<SellabilityAudit> {
  const quantity = notionalUsd / Math.max(snapshot.price, 1e-12);
  return auditSellQuantity(snapshot, quantity);
}

export async function auditPositionSellability(position: ManagedPosition, snapshot: MarketSnapshot, quantityOverride?: number): Promise<SellabilityAudit> {
  const quantity = quantityOverride ?? Math.max(0, position.remainingQuantity);
  return auditSellQuantity(snapshot, quantity);
}
