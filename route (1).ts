import { NextRequest, NextResponse } from "next/server";
import { executePaper } from "@/lib/execution";
import { assessPaperEntryEligibility, registerPaperPosition } from "@/lib/position-manager";
import type { ExecutionRequest, ExitStrategy, MarketSnapshot, PositionEntryContext } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    request?: ExecutionRequest;
    snapshot?: MarketSnapshot;
    exitStrategy?: ExitStrategy;
    entryContext?: PositionEntryContext;
  };
  if (!body.request || !body.snapshot) return NextResponse.json({ error: "request and snapshot are required" }, { status: 400 });
  if (body.request.mode !== "paper") return NextResponse.json({ error: "Paper endpoint rejects live orders" }, { status: 403 });
  if (!body.exitStrategy) return NextResponse.json({ error: "exitStrategy is required so Guardian can own the position" }, { status: 400 });

  const eligibility = await assessPaperEntryEligibility({ request: body.request, snapshot: body.snapshot, entryContext: body.entryContext });
  if (!eligibility.allowed) return NextResponse.json({ error: eligibility.reason, eligibility }, { status: 409 });

  const fill = await executePaper(body.request, body.snapshot);
  const position = await registerPaperPosition({
    fill,
    request: body.request,
    snapshot: body.snapshot,
    exitStrategy: body.exitStrategy,
    entryContext: body.entryContext,
    reentryCount: eligibility.reentryCount,
  });
  return NextResponse.json({ ...fill, eligibility, positionId: position?.id }, { headers: { "Cache-Control": "no-store" } });
}
