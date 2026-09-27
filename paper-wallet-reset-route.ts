import { NextResponse } from "next/server";
import { resetPaperWalletPreserveLearning } from "@/lib/paper-wallet";

export const dynamic = "force-dynamic";

// POST /api/paper-wallet/reset — restart the paper wallet: cash back to the
// configured starting amount, all paper positions / fills / portfolio history
// cleared. Learned research is preserved (see resetPaperWalletPreserveLearning).
// Requires a JSON body of { "confirm": "RESET" } so the reset can never be
// triggered by a stray GET, prefetch, or crawler.
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const confirm = (body as { confirm?: unknown } | null)?.confirm;
  if (confirm !== "RESET") {
    return NextResponse.json(
      { error: 'Request body must be { "confirm": "RESET" }.' },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { wallet, resetMeta, clearedOpenPositions } =
      await resetPaperWalletPreserveLearning("Manual dashboard reset");
    return NextResponse.json(
      {
        ok: true,
        clearedOpenPositions,
        resets: resetMeta.resets,
        wallet: {
          cashUsd: wallet.cashUsd,
          equityUsd: wallet.equityUsd,
        },
        resetAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Paper wallet reset failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
