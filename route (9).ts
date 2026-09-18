import { NextRequest, NextResponse } from "next/server";
import { classifyMarketRegime } from "@/lib/regime";
import { getLearningSnapshot } from "@/lib/learning-store";
import type { MarketSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json() as { snapshot?: MarketSnapshot };
  if (!body.snapshot) return NextResponse.json({ error: "snapshot is required" }, { status: 400 });
  const regime = classifyMarketRegime(body.snapshot);
  return NextResponse.json(await getLearningSnapshot(regime, body.snapshot), { headers: { "Cache-Control": "no-store" } });
}
