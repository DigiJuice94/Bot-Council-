import type { ExecutionRequest, WarRoomResult } from "./types";
import type { RunnerResearchSnapshot } from "./runner-research";

export type LiveDispatchResult = {
  attempted: boolean;
  dispatched: boolean;
  reason: string;
  statusCode?: number;
};

/**
 * V2.14 keeps real-key custody outside the dashboard process.
 * Once Code Deciphered is achieved, AUTO_ENABLE_LIVE_ON_CODE_DECIPHERED can
 * automatically mirror approved Council entries to a dedicated live executor.
 * The executor must be configured explicitly through Railway secrets.
 */
export async function maybeDispatchLiveTrade(args: {
  result: WarRoomResult;
  paperRequest: ExecutionRequest;
  research: RunnerResearchSnapshot;
}): Promise<LiveDispatchResult> {
  const { result, paperRequest, research } = args;
  if (!research.codeDeciphered) return { attempted: false, dispatched: false, reason: "Code Deciphered requirement has not been reached." };
  if (!research.liveAutoEnableRequested) return { attempted: false, dispatched: false, reason: "Automatic live unlock is disabled by environment setting." };
  const url = process.env.LIVE_EXECUTOR_URL;
  const token = process.env.LIVE_EXECUTOR_TOKEN;
  if (!url || !token) return { attempted: false, dispatched: false, reason: "Code Deciphered reached, but the dedicated live executor is not configured." };

  const maxUsd = Math.max(1, Number(process.env.LIVE_MAX_NOTIONAL_USD ?? 25));
  const liveRequest: ExecutionRequest = {
    ...paperRequest,
    mode: "live",
    notionalUsd: Number(Math.min(paperRequest.notionalUsd, maxUsd).toFixed(2)),
    decisionId: `${paperRequest.decisionId}-LIVE`,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bot-War-Room/2.14",
      },
      body: JSON.stringify({
        request: liveRequest,
        proof: {
          codeDeciphered: true,
          codeProgressPct: research.codeProgressPct,
          freshCoinWins: research.freshCoinWins,
          oosAccuracyPct: research.oosAccuracyPct,
          profitFactor: research.paperProfitFactor,
          confirmedTells: research.confirmedTells,
          decisionId: result.decisionId,
          symbol: result.snapshot.symbol,
          chain: result.snapshot.chain,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) return { attempted: true, dispatched: false, statusCode: response.status, reason: `Live executor rejected request (${response.status})${body ? `: ${body.slice(0, 180)}` : ""}` };
    return { attempted: true, dispatched: true, statusCode: response.status, reason: `Live executor accepted the Code Deciphered trade for $${liveRequest.notionalUsd.toFixed(2)}.` };
  } catch (error) {
    return { attempted: true, dispatched: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
