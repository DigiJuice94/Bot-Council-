import { NextResponse } from "next/server";
import { ensurePositionGuardianLoop, refreshPositionGuardian } from "@/lib/position-manager";
import { listManagedPositions } from "@/lib/position-store";
import { ensureReleaseFreshStart } from "@/lib/release-fresh-start";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureReleaseFreshStart();
  // The dashboard's trade table uses this lightweight path so research/status
  // generation cannot hold back visible position updates.
  if (new URL(request.url).searchParams.get("light") === "1") {
    return NextResponse.json({ positions: await listManagedPositions(), generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }
  ensurePositionGuardianLoop();
  const report = await refreshPositionGuardian();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
