import { NextRequest, NextResponse } from "next/server";
import { runWarRoom } from "@/lib/engine";
import { fetchLiveCandidate, liveMarketDataMode } from "@/lib/market-data";
import { ensurePositionGuardianLoop } from "@/lib/position-manager";
import { classifyMarketRegime } from "@/lib/regime";
import { relevantMemoryHints, resolveAdaptiveWeights } from "@/lib/learning-store";
import { loadLatestProfitability } from "@/lib/profitability-store";
import { getPaperPortfolioContext } from "@/lib/paper-wallet";
import type { Chain, MarketSnapshot, TradingMode } from "@/lib/types";
import { ensureReleaseFreshStart } from "@/lib/release-fresh-start";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await ensureReleaseFreshStart();
  ensurePositionGuardianLoop();
  let previous: MarketSnapshot | undefined;
  let chain: Chain | undefined;
  let mode: TradingMode = "paper";
  try {
    const body = await request.json();
    previous = body?.snapshot;
    chain = body?.chain;
    mode = body?.mode === "live" ? "live" : "paper";
  } catch {
    previous = undefined;
  }

  const requestedChain = chain ?? previous?.chain ?? "Solana";
  const snapshot = await fetchLiveCandidate(requestedChain);
  if (!snapshot) {
    return NextResponse.json({
      ok: false,
      chain: requestedChain,
      dataMode: liveMarketDataMode(),
      message: "No qualifying real market candidate is available right now. Demo/fake candidates are disabled.",
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Market-Data-Mode": liveMarketDataMode() },
    });
  }

  const regime = classifyMarketRegime(snapshot);
  const [learning, memoryHints, profitability, portfolio] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
    getPaperPortfolioContext(snapshot.chain),
  ]);

  const result = runWarRoom(snapshot, {
    mode,
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
    portfolio,
  });
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
      "X-Market-Data-Mode": liveMarketDataMode(),
      "X-Learning-Mode": learning.source,
    },
  });
}
