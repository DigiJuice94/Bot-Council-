import { NextRequest, NextResponse } from "next/server";
import { classifyMarketRegime } from "@/lib/regime";
import { getAutopilotStatus } from "@/lib/autopilot";
import { getLearningSnapshot } from "@/lib/learning-store";
import type { MarketSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET — the dashboard's primary live source: paper wallet, latest + recent
// council decisions, open positions, research snapshot. Never throws shaped
// data the dashboard can't parse: this is the AutopilotStatus contract the
// War Room dashboard has consumed since V2.
export async function GET() {
  const status = await getAutopilotStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { snapshot?: MarketSnapshot };
  if (!body.snapshot) return NextResponse.json({ error: "snapshot is required" }, { status: 400 });
  const regime = classifyMarketRegime(body.snapshot);
  return NextResponse.json(await getLearningSnapshot(regime, body.snapshot), { headers: { "Cache-Control": "no-store" } });
}
