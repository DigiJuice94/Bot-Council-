import { NextRequest, NextResponse } from "next/server";
import { runWarRoom } from "@/lib/engine";
import { createMockSnapshot } from "@/lib/mock-market";
import type { Chain, MarketSnapshot, TradingMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

  const snapshot = createMockSnapshot(previous, chain);
  return NextResponse.json(runWarRoom(snapshot, { mode }), { headers: { "Cache-Control": "no-store" } });
}
