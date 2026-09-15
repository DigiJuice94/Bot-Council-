import { markProviderFailure, markProviderSuccess } from "./provider-health";
import { markAuxProviderFailure, markAuxProviderSuccess } from "./provider-waterfall";
import type { ExecutionRequest, MarketSnapshot } from "./types";

const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
const ZEROEX_SOLANA_URL = "https://api.0x.org/solana/swap-instructions";
const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type RouteFeasibility = {
  verified: boolean;
  available: boolean;
  provider: "jupiter" | "liquidity-model";
  priceImpactPct?: number;
  estimatedSlippageBps?: number;
  outAmount?: string;
  reason: string;
};

function toFinite(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function jupiterRoute(request: ExecutionRequest): Promise<RouteFeasibility | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL(JUPITER_QUOTE_URL);
    url.searchParams.set("inputMint", USDC_SOLANA_MINT);
    url.searchParams.set("outputMint", request.tokenAddress);
    url.searchParams.set("amount", String(Math.max(1, Math.round(request.notionalUsd * 1_000_000))));
    url.searchParams.set("slippageBps", String(Math.max(1, Math.round(request.maxSlippageBps))));
    url.searchParams.set("restrictIntermediateTokens", "true");
    const response = await fetch(url, {
      headers: { Accept: "application/json", "x-api-key": apiKey, "User-Agent": "Bot-War-Room/2.14" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Jupiter quote HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
    }
    const payload = await response.json() as any;
    const outAmount = payload?.outAmount != null ? String(payload.outAmount) : undefined;
    const priceImpactPct = toFinite(payload?.priceImpactPct);
    const hasRoute = Boolean(outAmount && Number(outAmount) > 0 && (Array.isArray(payload?.routePlan) ? payload.routePlan.length > 0 : true));
    if (!hasRoute) throw new Error("Jupiter returned no route for the paper order size.");
    markProviderSuccess("jupiter");
    return {
      verified: true,
      available: true,
      provider: "jupiter",
      priceImpactPct,
      estimatedSlippageBps: priceImpactPct == null ? undefined : Math.max(0, Math.round(Math.abs(priceImpactPct) * 100)),
      outAmount,
      reason: `Jupiter returned a live paper-route check${priceImpactPct == null ? "" : ` with ${priceImpactPct.toFixed(3)}% quoted price impact`}.`,
    };
  } catch (error) {
    markProviderFailure("jupiter", error);
    return null;
  }
}

async function zeroExRoute(request: ExecutionRequest): Promise<RouteFeasibility | null> {
  const apiKey = process.env.ZEROEX_API_KEY;
  const taker = process.env.SOLANA_WALLET_ADDRESS ?? process.env.SOLANA_TAKER_ADDRESS;
  if (!apiKey || !taker) return null;
  try {
    const response = await fetch(ZEROEX_SOLANA_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "0x-api-key": apiKey,
        "User-Agent": "Bot-War-Room/2.14",
      },
      body: JSON.stringify({
        token_in: USDC_SOLANA_MINT,
        token_out: request.tokenAddress,
        amount_in: Math.max(1, Math.round(request.notionalUsd * 1_000_000)),
        taker,
        slippage_bps: Math.max(1, Math.round(request.maxSlippageBps)),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_500),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`0x Solana HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
    }
    const payload = await response.json() as any;
    if (payload?.liquidityAvailable === false || payload?.error) throw new Error(payload?.reason ?? payload?.message ?? "0x returned no Solana route");
    markAuxProviderSuccess("zeroex");
    return {
      verified: true,
      available: true,
      provider: "liquidity-model",
      reason: "0x Solana returned live swap instructions, so route feasibility is independently verified even though the paper fill remains simulated.",
    };
  } catch (error) {
    markAuxProviderFailure("zeroex", error);
    return null;
  }
}

export async function verifyPaperRoute(request: ExecutionRequest, snapshot: MarketSnapshot): Promise<RouteFeasibility> {
  if (request.chain !== "Solana" || request.side !== "BUY") {
    return {
      verified: false,
      available: snapshot.liquidity > 0,
      provider: "liquidity-model",
      reason: "Paper routes outside Solana use observed DEX liquidity plus the internal slippage model.",
    };
  }

  const jupiter = await jupiterRoute(request);
  if (jupiter) return jupiter;

  const zeroEx = await zeroExRoute(request);
  if (zeroEx) return zeroEx;

  return {
    verified: false,
    available: snapshot.liquidity > 0,
    provider: "liquidity-model",
    reason: "Jupiter/0x route verification is unavailable, so PAPER mode continues with observed live DEX liquidity. No real transaction is submitted or signed.",
  };
}
