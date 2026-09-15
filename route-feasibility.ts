import { markProviderFailure, markProviderSuccess } from "./provider-health";
import type { ExecutionRequest, MarketSnapshot } from "./types";

const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
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

export async function verifyPaperRoute(request: ExecutionRequest, snapshot: MarketSnapshot): Promise<RouteFeasibility> {
  // Jupiter is currently used as an independent, real route check for Solana buys.
  // Paper execution never submits or signs a transaction.
  if (request.chain !== "Solana" || request.side !== "BUY") {
    return {
      verified: false,
      available: snapshot.liquidity > 0,
      provider: "liquidity-model",
      reason: "Jupiter route verification applies to Solana BUYs; other paper routes use observed DEX liquidity.",
    };
  }

  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) {
    return {
      verified: false,
      available: snapshot.liquidity > 0,
      provider: "liquidity-model",
      reason: "JUPITER_API_KEY is not configured; paper fill uses observed DEX liquidity and is marked route-unverified.",
    };
  }

  try {
    const url = new URL(JUPITER_QUOTE_URL);
    url.searchParams.set("inputMint", USDC_SOLANA_MINT);
    url.searchParams.set("outputMint", request.tokenAddress);
    url.searchParams.set("amount", String(Math.max(1, Math.round(request.notionalUsd * 1_000_000))));
    url.searchParams.set("slippageBps", String(Math.max(1, Math.round(request.maxSlippageBps))));
    url.searchParams.set("restrictIntermediateTokens", "true");

    const response = await fetch(url, {
      headers: { Accept: "application/json", "x-api-key": apiKey, "User-Agent": "Bot-War-Room/2.12" },
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
    if (!hasRoute) throw new Error("Jupiter returned no executable route for the paper order size.");

    markProviderSuccess("jupiter");
    return {
      verified: true,
      available: true,
      provider: "jupiter",
      priceImpactPct,
      estimatedSlippageBps: priceImpactPct == null ? undefined : Math.max(0, Math.round(Math.abs(priceImpactPct) * 100)),
      outAmount,
      reason: `Jupiter returned a live route${priceImpactPct == null ? "" : ` with ${priceImpactPct.toFixed(3)}% quoted price impact`}.`,
    };
  } catch (error) {
    markProviderFailure("jupiter", error);
    return {
      verified: true,
      available: false,
      provider: "jupiter",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
