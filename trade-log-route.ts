import { NextResponse } from "next/server";
import { getPaperWallet } from "@/lib/paper-wallet";
import { listManagedPositions } from "@/lib/position-store";

export const dynamic = "force-dynamic";

// GET /api/trade-log — recent paper fills, newest first.
// Shape mirrors /api/journal's fill rows ({ rows, totalStored }) so every
// dashboard ledger parses it identically: each row carries id, createdAt,
// symbol, chain, side, action, requestedUsd, filledUsd, fillPrice,
// realizedPnlAfterUsd and portfolioEquityAfterUsd.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 100));
  const [wallet, positions] = await Promise.all([getPaperWallet(), listManagedPositions()]);
  const byId = new Map(positions.map((position) => [position.id, position]));

  const rows = wallet.recentFills.slice(0, limit).map((fill) => {
    const position = fill.positionId ? byId.get(fill.positionId) : undefined;
    return {
      ...fill,
      action: fill.action ?? (fill.side === "BUY" ? "ENTRY" : fill.remainingQuantityAfter === 0 ? "EXIT" : "TRIM"),
      remainingQuantityAfter: fill.remainingQuantityAfter ?? position?.remainingQuantity,
      entryPrice: position?.initialEntryPrice ?? position?.entryPrice,
      entryQuantity: position?.initialQuantity ?? position?.quantity,
      imageUrl: position?.imageUrl,
      status: position?.status,
      realizedPnlAfterUsd: fill.positionRealizedPnlAfterUsd,
    };
  });

  return NextResponse.json({
    rows,
    totalStored: wallet.recentFills.length,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
