import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// V2.12 deliberately disables client/manual paper order injection.
// The only code path allowed to create a new paper position is the server-side autonomous Council in lib/autopilot.ts.
export async function POST() {
  return NextResponse.json({
    error: "Manual paper execution is disabled in V2.12. The autonomous War Room owns the paper wallet and only real-provider Council decisions may create entries.",
  }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
