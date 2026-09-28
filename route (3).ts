import { NextResponse } from "next/server";
import { ensurePositionGuardianLoop, refreshPositionGuardian } from "@/lib/position-manager";
import { listManagedPositions } from "@/lib/position-store";

export const dynamic = "force-dynamic";

// GET — position reads. ?light=1 is the dashboard's lightweight path: it
// returns { positions } without waiting on the heavier guardian refresh, so
// research/status generation can never hold back visible position updates.
// Light mode also trims each position to the fields the dashboard renders.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("light") === "1") {
    const rows = (await listManagedPositions()).map((position) => ({
      id: position.id,
      symbol: position.symbol,
      chain: position.chain,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      remainingQuantity: position.remainingQuantity,
      remainingNotionalUsd: position.remainingNotionalUsd,
      pnlPct: position.pnlPct,
      openedAt: position.openedAt,
    }));
    return NextResponse.json({ positions: rows, generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }
  ensurePositionGuardianLoop();
  const report = await refreshPositionGuardian();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}

// V2.12 deliberately disables client/manual paper order injection.
// The only code path allowed to create a new paper position is the server-side autonomous Council in lib/autopilot.ts.
export async function POST() {
  return NextResponse.json({
    error: "Manual paper execution is disabled in V2.12. The autonomous War Room owns the paper wallet and only real-provider Council decisions may create entries.",
  }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
