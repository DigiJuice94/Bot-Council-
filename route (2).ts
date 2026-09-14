import { NextResponse } from "next/server";
import { createCoreExperiment } from "@/lib/experiments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(createCoreExperiment(["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"]), {
    headers: { "Cache-Control": "no-store" },
  });
}
