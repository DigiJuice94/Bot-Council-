import { NextRequest, NextResponse } from "next/server";
import { getTradeJournal } from "@/lib/trade-journal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  return NextResponse.json(await getTradeJournal(limit), { headers: { "Cache-Control": "no-store" } });
}
