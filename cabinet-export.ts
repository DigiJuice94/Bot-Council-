import { getAutopilotTelemetrySnapshot } from "./autopilot";
import { getPaperWallet, getPaperWalletResetMeta } from "./paper-wallet";
import { getPositionGuardianTelemetry } from "./position-manager";
import { listManagedPositions } from "./position-store";
import { getProviderHealth } from "./provider-health";
import { getWaterfallProviderHealth } from "./provider-waterfall";
import { isCreditedPaperFill, reconstructCashUsd, reconstructPortfolio, uniqueManagedPositions, uniquePaperFills } from "./paper-accounting";
import { getRunnerResearchSnapshot } from "./runner-research";
import { getTradeJournal } from "./trade-journal";
import type { ManagedPosition, PaperWalletFillRecord, PaperWalletSnapshot } from "./types";

export type CabinetKind = "main" | "rug" | "proof";
type VerificationState = "CONFIRMED" | "PARTIALLY_CONFIRMED" | "UNCONFIRMED" | "DISCREPANCY";

const SCHEMA_VERSION = "bot-war-room-cabinet/v1";
const BUILD = "V3.6.3.12 Liquidity Paper Exits / Verified or Modeled";
const round = (value: number, digits = 6) => Number((Number.isFinite(value) ? value : 0).toFixed(digits));
const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function reconstructedTrade(position: ManagedPosition, fills: PaperWalletFillRecord[], decision: any) {
  const ordered = uniquePaperFills(fills).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const credited = ordered.filter(isCreditedPaperFill);
  const buys = credited.filter((fill) => fill.side === "BUY");
  const sells = credited.filter((fill) => fill.side === "SELL");
  const uncreditedSells = ordered.filter((fill) => fill.side === "SELL" && !isCreditedPaperFill(fill));
  const buyQuantity = buys.reduce((sum, fill) => sum + amount(fill.quantity ?? (fill.fillPrice > 0 ? fill.filledUsd / fill.fillPrice : 0)), 0);
  const soldQuantity = sells.reduce((sum, fill) => sum + amount(fill.quantity ?? (fill.fillPrice > 0 ? fill.requestedUsd / fill.fillPrice : 0)), 0);
  const totalCostUsd = buys.reduce((sum, fill) => sum + amount(fill.requestedUsd), 0);
  const claimedProceedsUsd = amount(position.realizedProceedsUsd);
  const reconstructedProceedsUsd = sells.reduce((sum, fill) => sum + amount(fill.filledUsd), 0);
  const averageCostPerToken = buyQuantity > 0 ? totalCostUsd / buyQuantity : 0;
  const reconstructedRemainingQuantity = Math.max(0, buyQuantity - soldQuantity);
  const reconstructedCostSoldUsd = Math.min(totalCostUsd, soldQuantity * averageCostPerToken);
  const reconstructedRemainingCostUsd = Math.max(0, totalCostUsd - reconstructedCostSoldUsd);
  const reconstructedRealizedPnlUsd = position.status === "unsellable"
    ? reconstructedProceedsUsd - totalCostUsd
    : reconstructedProceedsUsd - reconstructedCostSoldUsd;
  const reconstructedUnrealizedPnlUsd = position.status === "open" || position.status === "exit_pending" || position.status === "exit_unverified"
    ? reconstructedRemainingQuantity * amount(position.markPrice) - reconstructedRemainingCostUsd
    : 0;
  const quantityDelta = round(amount(position.remainingQuantity) - reconstructedRemainingQuantity);
  const proceedsDeltaUsd = round(claimedProceedsUsd - reconstructedProceedsUsd);
  const realizedPnlDeltaUsd = round(amount(position.realizedPnlUsd) - reconstructedRealizedPnlUsd);
  const sufficientEvidence = buys.length > 0 && Boolean(decision);
  const hasMaterialDiscrepancy = Math.abs(quantityDelta) > Math.max(0.000001, buyQuantity * 0.000001)
    || Math.abs(proceedsDeltaUsd) > 0.02
    || (position.status !== "open" && position.status !== "exit_pending" && position.status !== "exit_unverified" && Math.abs(realizedPnlDeltaUsd) > 0.02);
  const sellEvidenceResolved = position.status === "exit_unverified" ? false : position.status === "unsellable"
    ? Boolean(position.unsellableReason || position.sellAuditStatus === "fail")
    : uncreditedSells.length === 0 && sells.every((fill) => fill.routeVerified === true);
  const verificationState: VerificationState = hasMaterialDiscrepancy
    ? "DISCREPANCY"
    : !sufficientEvidence
      ? "UNCONFIRMED"
      : position.status === "open" || position.status === "exit_pending" || !sellEvidenceResolved
        ? "PARTIALLY_CONFIRMED"
        : "CONFIRMED";
  const firstBuy = buys[0];
  const lastSell = sells.at(-1);
  return {
    verificationState,
    verificationBasis: "Independent reconstruction from persisted paper fills, position state and Council decision evidence.",
    tradeId: position.id,
    decisionId: position.decisionId,
    token: { symbol: position.symbol, contractAddress: position.tokenAddress, chain: position.chain },
    status: position.status,
    entry: {
      timestamp: firstBuy?.createdAt ?? position.openedAt,
      quotedPrice: amount(firstBuy?.fillPrice ?? position.entryPrice),
      amountCommittedUsd: totalCostUsd || amount(position.entryNotionalUsd),
      expectedOrAcquiredQuantity: round(buyQuantity || amount(position.initialQuantity ?? position.quantity)),
      liquidityAvailableUsd: amount(position.entryContext?.snapshot?.liquidity),
      sellableAtEntry: position.entryContext?.snapshot?.sellable,
      routeVerified: firstBuy?.routeVerified,
      routeProvider: firstBuy?.routeProvider,
    },
    councilEvidence: decision ?? position.entryContext?.councilProcess ?? null,
    fills: ordered,
    partialSales: sells.filter((fill) => fill.action === "TRIM"),
    remaining: {
      botReportedQuantity: amount(position.remainingQuantity),
      independentlyReconstructedQuantity: round(reconstructedRemainingQuantity),
      quantityDelta,
      residualQuantity: amount(position.remainingQuantity),
      markPrice: amount(position.markPrice),
    },
    exit: {
      timestamp: lastSell?.createdAt ?? position.closedAt ?? position.unsellableAt,
      quotedPrice: lastSell?.fillPrice,
      claimedProceedsUsd,
      independentlyReconstructedProceedsUsd: round(reconstructedProceedsUsd),
      proceedsDeltaUsd,
      claimedRealizedPnlUsd: amount(position.realizedPnlUsd),
      independentlyReconstructedRealizedPnlUsd: round(reconstructedRealizedPnlUsd),
      realizedPnlDeltaUsd,
      claimedUnrealizedPnlUsd: round(amount(position.remainingQuantity) * amount(position.markPrice) - amount(position.remainingNotionalUsd)),
      independentlyReconstructedUnrealizedPnlUsd: round(reconstructedUnrealizedPnlUsd),
    },
    sellability: {
      status: position.sellAuditStatus ?? "unknown",
      provider: position.sellAuditProvider,
      checkedAt: position.sellAuditCheckedAt,
      reason: position.sellAuditReason ?? position.unsellableReason,
      expectedOutUsd: position.sellAuditExpectedOutUsd,
      lockedCapitalLossUsd: amount(position.lockedCapitalLossUsd),
    },
    errorsOrFailures: [
      position.unsellableReason,
      position.lastReason,
      ...uncreditedSells.map((fill) => `SELL ${fill.id} was not credited because executable route evidence was not verified.`),
      ...ordered.map((fill) => fill.routeNote),
    ].filter(Boolean),
    updatedAt: position.updatedAt,
  };
}

function reconstructWallet(wallet: PaperWalletSnapshot, positions: ManagedPosition[]) {
  const chronological = uniquePaperFills(wallet.recentFills).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let reconstructedCashUsd = amount(wallet.startingCashUsd) + amount(wallet.capitalContributionsUsd);
  const cashLedger = chronological.map((fill) => {
    const credited = isCreditedPaperFill(fill);
    if (credited) reconstructedCashUsd += fill.side === "BUY" ? -amount(fill.requestedUsd) : amount(fill.filledUsd);
    const reportedCashAfterUsd = typeof fill.cashAfterUsd === "number" ? fill.cashAfterUsd : null;
    return {
      fillId: fill.id,
      at: fill.createdAt,
      side: fill.side,
      credited,
      reconstructedCashAfterUsd: round(reconstructedCashUsd, 2),
      reportedCashAfterUsd,
      deltaUsd: reportedCashAfterUsd == null ? null : round(reportedCashAfterUsd - reconstructedCashUsd, 2),
    };
  });
  reconstructedCashUsd = reconstructCashUsd(wallet);
  const accounting = reconstructPortfolio(wallet, positions);
  const independentlyReconstructedOpenValueUsd = accounting.openExposureUsd;
  const independentlyReconstructedOpenCostUsd = accounting.openCostUsd;
  const independentlyReconstructedEquityUsd = accounting.equityUsd;
  const independentlyReconstructedTotalPnlUsd = accounting.totalPnlUsd;
  const ledgerComplete = chronological.length >= wallet.buyFills + wallet.sellFills;
  const cashDeltaUsd = round(amount(wallet.cashUsd) - reconstructedCashUsd, 2);
  const equityDeltaUsd = round(amount(wallet.equityUsd) - independentlyReconstructedEquityUsd, 2);
  return {
    ledgerComplete,
    expectedFillCount: wallet.buyFills + wallet.sellFills,
    availableFillCount: wallet.recentFills.length,
    startingCashUsd: wallet.startingCashUsd,
    capitalContributionsUsd: wallet.capitalContributionsUsd ?? 0,
    reportedCashUsd: wallet.cashUsd,
    independentlyReconstructedCashUsd: round(reconstructedCashUsd, 2),
    cashDeltaUsd,
    reportedOpenValueUsd: wallet.openExposureUsd,
    independentlyReconstructedOpenValueUsd,
    reportedOpenCostUsd: wallet.openCostUsd,
    independentlyReconstructedOpenCostUsd,
    reportedEquityUsd: wallet.equityUsd,
    independentlyReconstructedEquityUsd,
    equityDeltaUsd,
    reportedRealizedPnlUsd: wallet.realizedPnlUsd,
    reportedUnrealizedPnlUsd: wallet.unrealizedPnlUsd,
    reportedTotalPnlUsd: wallet.totalPnlUsd,
    independentlyReconstructedTotalPnlUsd,
    lockedCapitalLossUsd: wallet.lockedCapitalLossUsd,
    accountingVerified: ledgerComplete && Math.abs(cashDeltaUsd) <= 0.01 && Math.abs(equityDeltaUsd) <= 0.01,
    cashLedger,
  };
}

function operationalHealth(positions: ManagedPosition[]) {
  const scanner = getAutopilotTelemetrySnapshot();
  const guardian = getPositionGuardianTelemetry();
  const now = Date.now();
  const lastSuccessMs = scanner.lastSuccessfulCycleAt ? new Date(scanner.lastSuccessfulCycleAt).getTime() : 0;
  const lastAttemptMs = scanner.lastCycleAttemptAt ? new Date(scanner.lastCycleAttemptAt).getTime() : 0;
  const activeCycleMs = scanner.activeCycleStartedAt ? new Date(scanner.activeCycleStartedAt).getTime() : 0;
  const allowedSilenceMs = Math.max(60_000, scanner.intervalMs * 10);
  const activeCycleStuck = activeCycleMs > 0 && now - activeCycleMs > allowedSilenceMs;
  const completedCycleStale = lastSuccessMs > 0
    ? now - lastSuccessMs > allowedSilenceMs
    : activeCycleMs === 0 && lastAttemptMs > 0 && now - lastAttemptMs > allowedSilenceMs;
  const scannerStale = scanner.running && (activeCycleStuck || completedCycleStale);
  const stuckPositions = positions.filter((position) => position.status === "exit_pending" && now - new Date(position.updatedAt).getTime() > 60_000);
  const lastSuccessfulMarkRefresh = positions.map((position) => position.lastMarketDataAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const state = !scanner.running || scannerStale || Boolean(scanner.lastError) || stuckPositions.length
    ? "OPERATIONAL_FAILURE"
    : scanner.entriesCompleted === 0 && scanner.councilDecisionsCompleted === 0
      ? "INITIALIZING"
      : scanner.entriesCompleted === 0 || scanner.entriesAttempted === scanner.entryFailures
        ? "HEALTHY_INACTIVITY"
        : "ACTIVE_TRADING";
  return {
    state,
    evaluatedAt: new Date(now).toISOString(),
    scanner,
    guardian,
    lastSuccessfulMarkRefresh,
    stuckOrPendingOperations: stuckPositions.map((position) => ({ positionId: position.id, symbol: position.symbol, status: position.status, updatedAt: position.updatedAt, lastReason: position.lastReason })),
  };
}

export async function buildCabinetExport(kind: CabinetKind) {
  const generatedAt = new Date().toISOString();
  const [journal, storedPositions, wallet, resetMeta] = await Promise.all([getTradeJournal(1_000), listManagedPositions(), getPaperWallet(), getPaperWalletResetMeta()]);
  const positions = uniqueManagedPositions(storedPositions);
  const providers = [...getProviderHealth(), ...getWaterfallProviderHealth()];
  const research = kind === "proof" ? null : await getRunnerResearchSnapshot({ positions, providers, walletResetCount: resetMeta.resets });
  const common = { schemaVersion: SCHEMA_VERSION, build: BUILD, generatedAt, mode: "paper" as const, storage: { wallet: wallet.storage, research: process.env.REDIS_URL ? "redis" : "memory" } };

  if (kind === "main") return {
    ...common,
    kind,
    purpose: "Portable Main File Cabinet evidence: accumulated research, Council decisions, fills and position outcomes.",
    summary: { decisions: journal.decisions.length, fills: wallet.recentFills.length, positions: positions.length, casesStudied: research?.casesStudied ?? 0, confirmedTells: research?.confirmedTells ?? 0 },
    accumulatedKnowledge: research,
    decisions: journal.decisions,
    fills: wallet.recentFills,
    positions,
  };

  if (kind === "rug") {
    const incidents = positions.filter((position) => position.status === "unsellable" || position.status === "exit_unverified" || position.unsellableReason || amount(position.lockedCapitalLossUsd) > 0);
    return {
      ...common,
      kind,
      purpose: "Portable rug, honeypot, unsellable-token and locked-capital intelligence.",
      summary: { incidents: incidents.length, lockedCapitalLossUsd: round(incidents.reduce((sum, position) => sum + amount(position.lockedCapitalLossUsd), 0), 2), learnedRugCases: research?.rugCases ?? 0 },
      learnedRugIntelligence: { recentRugCases: research?.recentRugCases ?? [], dumperContrasts: research?.topDumpTells ?? [], recentLessons: research?.recentBotLessons.filter((lesson) => lesson.agentId === "rug" || lesson.agentId === "bear") ?? [] },
      incidents,
    };
  }

  const decisions = new Map(journal.decisions.map((decision: any) => [decision.decisionId, decision]));
  const fillsByPosition = new Map<string, PaperWalletFillRecord[]>();
  for (const fill of wallet.recentFills) {
    const key = fill.positionId ?? `orphan:${fill.id}`;
    fillsByPosition.set(key, [...(fillsByPosition.get(key) ?? []), fill]);
  }
  const trades = positions.map((position) => reconstructedTrade(position, fillsByPosition.get(position.id) ?? [], decisions.get(position.decisionId)));
  const representedFillIds = new Set(trades.flatMap((trade) => trade.fills.map((fill) => fill.id)));
  const orphanFills = wallet.recentFills.filter((fill) => !representedFillIds.has(fill.id)).map((fill) => ({ verificationState: "UNCONFIRMED" as const, fill, reason: "The fill does not reference a persisted position, so a complete trade cannot be reconstructed." }));
  const count = (state: VerificationState) => trades.filter((trade) => trade.verificationState === state).length;
  const settled = positions.filter((position) => position.status === "closed" || position.status === "unsellable");
  const verifiedIds = new Set(trades.filter((trade) => trade.verificationState === "CONFIRMED").map((trade) => trade.tradeId));
  const reportedPnlUsd = round(settled.reduce((sum, position) => sum + amount(position.realizedPnlUsd), 0), 2);
  const verifiedPnlUsd = round(trades.filter((trade) => trade.verificationState === "CONFIRMED").reduce((sum, trade) => sum + amount(trade.exit.independentlyReconstructedRealizedPnlUsd), 0), 2);
  const reconciliation = reconstructWallet(wallet, positions);
  return {
    ...common,
    kind,
    purpose: "Observational Proof of Work. It reconstructs stored paper evidence without approving, rejecting or modifying trades.",
    limitations: [
      "CONFIRMED means persisted paper evidence and independent arithmetic agree; it is not blockchain confirmation.",
      "PARTIALLY_CONFIRMED means arithmetic agrees but route, sellability, lifecycle or other evidence is unresolved.",
      "Future live execution must reconcile submitted and confirmed transactions, received quantities, proceeds and network fees against wallet/chain truth.",
    ],
    performance: {
      totalTradesReported: positions.length,
      confirmedTrades: count("CONFIRMED"),
      partiallyConfirmedTrades: count("PARTIALLY_CONFIRMED"),
      unconfirmedTrades: count("UNCONFIRMED") + orphanFills.length,
      discrepancies: count("DISCREPANCY"),
      reportedWins: settled.filter((position) => position.realizedPnlUsd > 0).length,
      verifiedWins: settled.filter((position) => verifiedIds.has(position.id) && position.realizedPnlUsd > 0).length,
      reportedLosses: settled.filter((position) => position.realizedPnlUsd <= 0).length,
      verifiedLosses: settled.filter((position) => verifiedIds.has(position.id) && position.realizedPnlUsd <= 0).length,
      reportedSettledPnlUsd: reportedPnlUsd,
      independentlyVerifiedSettledPnlUsd: verifiedPnlUsd,
      pnlDependentOnUnconfirmedEvidenceUsd: round(reportedPnlUsd - verifiedPnlUsd, 2),
    },
    reconciliation,
    operationalHealth: operationalHealth(positions),
    providerHealth: providers,
    opportunityAudit: { decisions: journal.decisions, shadowReviews: getAutopilotTelemetrySnapshot().recentShadowReviews },
    trades,
    orphanFills,
  };
}
