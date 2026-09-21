import { NextResponse } from "next/server";
import { getTournamentView } from "@/lib/tournament";
import { ensureAutonomousWarRoom } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    ensureAutonomousWarRoom();
    return NextResponse.json(await getTournamentView(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
