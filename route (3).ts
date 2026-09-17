import { NextResponse } from "next/server";
import { getAutopilotStatus } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getAutopilotStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
