import { NextResponse } from "next/server";
import { resetPaperWalletPreserveLearning } from "@/lib/paper-wallet";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await resetPaperWalletPreserveLearning("Manual dashboard reset");
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Paper wallet reset to $${result.wallet.startingCashUsd.toFixed(2)}. Learning and all-time history preserved.`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
