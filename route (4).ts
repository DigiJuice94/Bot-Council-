import { NextResponse } from "next/server";
import { getAutopilotStatus } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getAutopilotStatus();
  const { chat: _chat, ...dashboardStatus } = status;
  return NextResponse.json(dashboardStatus, { headers: { "Cache-Control": "no-store" } });
}
