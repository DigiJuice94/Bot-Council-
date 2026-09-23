import { NextResponse } from "next/server";
import { getAutopilotStatus } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getAutopilotStatus();
  const { chat: _chat, ...dashboardStatus } = status;
  return NextResponse.json({
    ...dashboardStatus,
    paperWallet: { ...dashboardStatus.paperWallet, recentFills: dashboardStatus.paperWallet.recentFills.slice(0, 40) },
  }, { headers: { "Cache-Control": "no-store" } });
}
