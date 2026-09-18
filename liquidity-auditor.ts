import type { ExecutionRequest, MarketSnapshot } from "./types";

const NETWORK: Record<MarketSnapshot["chain"], string> = {
  Solana: "solana", Ethereum: "eth", Base: "base", "BNB Chain": "bsc",
  Monad: "monad", HyperEVM: "hyperevm", "Robinhood Chain": "robinhood",
};

export type LiquidityAudit = {
  allowed: boolean;
  reason: string;
  independentLiquidityUsd?: number;
};

// This auditor checks the exact pool using a second market-data operator.
// A token-level total would allow liquidity in an unrelated pool to approve
// a buy against the empty pool actually selected for execution.
export async function auditEntryLiquidity(snapshot: MarketSnapshot, request: ExecutionRequest): Promise<LiquidityAudit> {
  const primary = snapshot.liquidity;
  const pairAddress = snapshot.dataProvenance?.pairAddress;
  if (!Number.isFinite(primary) || primary <= 0) {
    return { allowed: false, reason: "primary market snapshot reports zero executable liquidity" };
  }
  if (!Number.isFinite(request.notionalUsd) || request.notionalUsd <= 0) {
    return { allowed: false, reason: "paper order size is invalid" };
  }
  if (!pairAddress) {
    return { allowed: false, reason: "the execution pool address is missing; an independent check cannot identify the same pool" };
  }

  const network = NETWORK[snapshot.chain];
  let payload: any;
  try {
    const response = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pairAddress)}`,
      { headers: { Accept: "application/json;version=20230203" }, cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return { allowed: false, reason: `independent GeckoTerminal pool check returned HTTP ${response.status}` };
    payload = await response.json();
  } catch {
    return { allowed: false, reason: "independent GeckoTerminal pool check is unavailable" };
  }

  const pool = payload?.data;
  const observedAddress = pool?.attributes?.address;
  const baseTokenId = pool?.relationships?.base_token?.data?.id;
  const expectedTokenId = `${network}_${snapshot.tokenAddress}`;
  if (typeof observedAddress !== "string" || observedAddress.toLowerCase() !== pairAddress.toLowerCase() ||
      typeof baseTokenId !== "string" || baseTokenId.toLowerCase() !== expectedTokenId.toLowerCase()) {
    return { allowed: false, reason: "independent provider did not confirm the exact pool and token being bought" };
  }

  const rawReserve = pool?.attributes?.reserve_in_usd;
  const reserve = rawReserve == null || rawReserve === "" ? NaN : Number(rawReserve);
  if (!Number.isFinite(reserve) || reserve <= 0) {
    return { allowed: false, reason: "independent provider reports zero or unknown pool liquidity" };
  }
  const earlyRunner = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;
  const configuredFloor = Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000);
  const floor = earlyRunner ? Math.max(500, Number.isFinite(configuredFloor) ? configuredFloor : 1_000) : 15_000;
  const minimum = Math.max(floor, request.notionalUsd * 10);
  if (reserve < minimum || reserve < primary * 0.5) {
    return {
      allowed: false,
      independentLiquidityUsd: reserve,
      reason: `independent pool reserve $${reserve.toFixed(2)} is below $${minimum.toFixed(2)} minimum or under half the primary $${primary.toFixed(2)} report`,
    };
  }
  return {
    allowed: true,
    independentLiquidityUsd: reserve,
    reason: `exact pool and token confirmed independently; $${reserve.toFixed(2)} GeckoTerminal reserve versus $${primary.toFixed(2)} primary liquidity`,
  };
}
