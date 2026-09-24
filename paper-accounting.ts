import type { ManagedPosition, PaperWalletFillRecord, PaperWalletState } from "./types";

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const ledgerAmount = (value: number) => Number(finite(value).toFixed(6));
export const money = (value: number) => Number(finite(value).toFixed(2));

export function isCreditedPaperFill(fill: PaperWalletFillRecord): boolean {
  if (!fill.id || !Number.isFinite(fill.requestedUsd) || !Number.isFinite(fill.filledUsd)) return false;
  if (fill.side === "BUY") return fill.requestedUsd > 0;
  if (fill.routeVerified === true) return fill.filledUsd >= 0;
  // A PAPER simulation can be counted, but it must never masquerade as a
  // reverse-route-verified execution.
  return fill.sellExecutionKind === "liquidity_model" && fill.routeVerified === false
    && fill.routeProvider === "liquidity-model"
    && Number.isFinite(fill.observedLiquidityUsd) && Number(fill.observedLiquidityUsd) > 0
    && Number.isFinite(fill.filledUsd) && fill.filledUsd >= 0
    && fill.filledUsd <= Number(fill.observedLiquidityUsd) * 0.5 + 0.0001
    && Number.isFinite(Date.parse(fill.liquidityObservedAt ?? ""))
    && Math.abs(Date.parse(fill.createdAt) - Date.parse(fill.liquidityObservedAt!)) <= 120_000;
}

export function uniquePaperFills(fills: PaperWalletFillRecord[]): PaperWalletFillRecord[] {
  const seen = new Set<string>();
  return fills.filter((fill) => {
    if (!fill.id || seen.has(fill.id)) return false;
    seen.add(fill.id);
    return true;
  });
}

export function reconstructCashUsd(state: Pick<PaperWalletState, "startingCashUsd" | "capitalContributionsUsd" | "recentFills">): number {
  const fills = uniquePaperFills(state.recentFills).filter(isCreditedPaperFill);
  const cash = fills.reduce(
    (sum, fill) => sum + (fill.side === "BUY" ? -finite(fill.requestedUsd) : finite(fill.filledUsd)),
    finite(state.startingCashUsd) + finite(state.capitalContributionsUsd),
  );
  return ledgerAmount(cash);
}

export function reconcilePaperWalletState(state: PaperWalletState): { state: PaperWalletState; changed: boolean; ledgerComplete: boolean } {
  const unique = uniquePaperFills(state.recentFills);
  const expected = Math.max(0, finite(state.buyFills) + finite(state.sellFills));
  // Completeness is determined before de-duplication. If a prior retry counted
  // the same fill twice, the raw rows are present and can be repaired safely.
  const ledgerComplete = state.recentFills.length >= expected;
  if (!ledgerComplete) return { state, changed: false, ledgerComplete };

  const credited = unique.filter(isCreditedPaperFill);
  const cashUsd = reconstructCashUsd({ ...state, recentFills: unique });
  const buyFills = credited.filter((fill) => fill.side === "BUY").length;
  const sellFills = credited.filter((fill) => fill.side === "SELL").length;
  const totalFeesUsd = ledgerAmount(credited.reduce((sum, fill) => sum + finite(fill.feeUsd), 0));
  const changed = Math.abs(finite(state.cashUsd) - cashUsd) > 0.0000005
    || state.recentFills.length !== unique.length
    || state.buyFills !== buyFills
    || state.sellFills !== sellFills
    || Math.abs(finite(state.totalFeesUsd) - totalFeesUsd) > 0.0000005;
  return {
    changed,
    ledgerComplete,
    state: changed ? { ...state, cashUsd, buyFills, sellFills, totalFeesUsd, recentFills: unique } : state,
  };
}

export function uniqueManagedPositions(positions: ManagedPosition[]): ManagedPosition[] {
  const byId = new Map<string, ManagedPosition>();
  for (const position of positions) {
    const existing = byId.get(position.id);
    if (!existing || Date.parse(position.updatedAt) >= Date.parse(existing.updatedAt)) byId.set(position.id, position);
  }
  return [...byId.values()];
}

export function reconstructPortfolio(state: PaperWalletState, positionsInput: ManagedPosition[]) {
  const positions = uniqueManagedPositions(positionsInput);
  const active = positions.filter((position) => position.status === "open" || position.status === "exit_pending");
  // Unverified exits have unsold tokens but no verifiable liquid mark. Include
  // their full remaining cost in provisional locked capital, never in equity.
  const unsellable = positions.filter((position) => position.status === "unsellable" || position.status === "exit_unverified");
  const cashUsd = reconstructCashUsd(state);
  const openValueRaw = active.reduce((sum, position) => sum + Math.max(0, finite(position.remainingQuantity) * finite(position.markPrice)), 0);
  const openCostRaw = [...active, ...unsellable.filter((position) => position.status === "exit_unverified")]
    .reduce((sum, position) => sum + Math.max(0, finite(position.entryNotionalUsd) - finite(position.realizedCostUsd)), 0);
  const lockedCapitalLossRaw = unsellable.reduce(
    (sum, position) => sum + Math.max(0, finite(position.lockedCapitalLossUsd) || finite(position.entryNotionalUsd) - finite(position.realizedCostUsd)),
    0,
  );
  const equityRaw = cashUsd + openValueRaw;
  const contributions = finite(state.capitalContributionsUsd);
  const totalPnlRaw = equityRaw - finite(state.startingCashUsd) - contributions;
  const unrealizedRaw = openValueRaw - openCostRaw;
  return {
    positions,
    active,
    unsellable,
    cashUsd: money(cashUsd),
    openExposureUsd: money(openValueRaw),
    openCostUsd: money(openCostRaw),
    unrealizedPnlUsd: money(unrealizedRaw),
    realizedPnlUsd: money(totalPnlRaw - unrealizedRaw),
    totalPnlUsd: money(totalPnlRaw),
    equityUsd: money(equityRaw),
    lockedCapitalLossUsd: money(lockedCapitalLossRaw),
  };
}
