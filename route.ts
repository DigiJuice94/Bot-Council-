import { NextRequest, NextResponse } from "next/server";
import { runWarRoom } from "@/lib/engine";
import { fetchLiveCandidate } from "@/lib/market-data";
import { createDemoScoutCandidate } from "@/lib/discovery";
import { ensurePositionGuardianLoop } from "@/lib/position-manager";
import { classifyMarketRegime } from "@/lib/regime";
import { relevantMemoryHints, resolveAdaptiveWeights } from "@/lib/learning-store";
import { loadLatestProfitability } from "@/lib/profitability-store";
import type { Chain, MarketSnapshot, TradingMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
  let snapshot: MarketSnapshot | null = null;
  try {
    snapshot = await fetchLiveCandidate(requestedChain);
  } catch {
    snapshot = null;
  }
  if (!snapshot) snapshot = createDemoScoutCandidate(previous, requestedChain);

  const regime = classifyMarketRegime(snapshot);
  const [learning, memoryHints, profitability] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
  ]);

  const result = runWarRoom(snapshot, {
    mode,
    regime,
    agentWeights: learning.weights,
    learningSource: learning.source,
    memoryHints,
    profitability,
  });
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
      "X-Market-Data-Mode": process.env.MARKET_DATA_BASE_URL ? "adapter" : "demo",
      "X-Learning-Mode": learning.source,
    },
  });
}
