import { NextRequest, NextResponse } from "next/server";
import { executePaper } from "@/lib/execution";
import type { ExecutionRequest, MarketSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json() as { request?: ExecutionRequest; snapshot?: MarketSnapshot };
  if (!body.request || !body.snapshot) return NextResponse.json({ error: "request and snapshot are required" }, { status: 400 });
  if (body.request.mode !== "paper") return NextResponse.json({ error: "V2 paper endpoint rejects live orders" }, { status: 403 });
  const fill = await executePaper(body.request, body.snapshot);
  return NextResponse.json(fill, { headers: { "Cache-Control": "no-store" } });
}
