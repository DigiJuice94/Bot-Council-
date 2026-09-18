import { NextRequest, NextResponse } from "next/server";
import { runProfitabilityBenchmark, type BenchmarkConfig } from "@/lib/backtest";
import { saveLatestProfitability, loadLatestProfitability } from "@/lib/profitability-store";
import { fetchHistoricalFrames } from "@/lib/market-data";
import type { Chain, HistoricalFrame } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await loadLatestProfitability();
  return NextResponse.json({
    status: metrics ? "measured" : "awaiting-data",
    metrics,
    message: metrics ? "Latest reproducible benchmark loaded." : "No real historical benchmark has been run yet.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { frames?: HistoricalFrame[]; config?: BenchmarkConfig; fetchFromAdapter?: boolean; chain?: Chain; limit?: number };
  let frames = Array.isArray(body.frames) ? body.frames : [];
  if (!frames.length && body.fetchFromAdapter && body.chain) frames = await fetchHistoricalFrames(body.chain, body.limit ?? 5000);
  if (!frames.length) return NextResponse.json({ error: "Provide frames[] or set fetchFromAdapter=true with a chain and a configured /history market-data adapter." }, { status: 400 });
  if (frames.length > 50_000) return NextResponse.json({ error: "Maximum 50,000 historical frames per benchmark run" }, { status: 413 });
  const report = runProfitabilityBenchmark(frames, body.config ?? {});
  await saveLatestProfitability(report.metrics);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
