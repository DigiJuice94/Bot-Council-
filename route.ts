import { NextRequest, NextResponse } from "next/server";
import { runWarRoom } from "@/lib/engine";
import { createMockSnapshot } from "@/lib/mock-market";
import type { MarketSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let previous: MarketSnapshot | undefined;
  try {
    const body = await request.json();
    previous = body?.snapshot;
  } catch {
    previous = undefined;
  }

  const snapshot = createMockSnapshot(previous);
  return NextResponse.json(runWarRoom(snapshot), {
    headers: { "Cache-Control": "no-store" },
  });
}
