import { NextResponse } from "next/server";
import { getPaperWallet } from "@/lib/paper-wallet";
import { listManagedPositions } from "@/lib/position-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
  const limit = Math.max(25, Math.min(1_000, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 500));
  const [wallet, positions] = await Promise.all([getPaperWallet(), listManagedPositions()]);
  const byId = new Map(positions.map((position) => [position.id, position]));

  const rows = wallet.recentFills.slice(0, limit).map((fill) => {
    const position = fill.positionId ? byId.get(fill.positionId) : undefined;
    const quantity = fill.quantity ?? (fill.side === "BUY"
      ? fill.filledUsd / Math.max(fill.fillPrice, 1e-12)
      : fill.requestedUsd * Math.max(0.01, 1 - fill.slippageBps / 10_000) / Math.max(fill.fillPrice, 1e-12));
    const nextUntaken = position?.exitStrategy?.takeProfits?.find((level) => !position.takenProfitLabels.includes(level.label));
    const nextTargetPrice = fill.nextTargetPrice ?? (nextUntaken && position
      ? position.entryPrice * (1 + nextUntaken.gainPct / 100)
      : undefined);
    return {
      ...fill,
      action: fill.action ?? (fill.side === "BUY" ? "ENTRY" : fill.remainingQuantityAfter === 0 ? "EXIT" : "TRIM"),
      quantity,
      remainingQuantityAfter: fill.remainingQuantityAfter ?? position?.remainingQuantity,
      portfolioEquityAfterUsd: fill.portfolioEquityAfterUsd,
      entryPrice: position?.initialEntryPrice ?? position?.entryPrice,
      entryQuantity: position?.initialQuantity ?? position?.quantity,
      imageUrl: position?.imageUrl,
      status: position?.status,
      realizedPnlAfterUsd: fill.positionRealizedPnlAfterUsd,
      nextTargetPrice,
    };
  });

  return NextResponse.json({
    rows,
    totalStored: wallet.recentFills.length,
    accountingVerified: wallet.accountingVerified,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
