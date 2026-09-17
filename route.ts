import { NextResponse } from "next/server";
import { ensurePositionGuardianLoop, refreshPositionGuardian } from "@/lib/position-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  ensurePositionGuardianLoop();
  const report = await refreshPositionGuardian();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
