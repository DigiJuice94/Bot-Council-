import { getTournamentView } from "./tournament";

export type CabinetKind = "main" | "rug" | "proof";

function round(v:number){ return Number(v.toFixed(6)); }

export async function buildCabinetExport(kind: CabinetKind) {
  const view = await getTournamentView();
  const team = view.teams[0];
  const generatedAt = new Date().toISOString();
  if (!team) return { kind, generatedAt, error: "No promoted wallet state available" };

  if (kind === "main") return {
    kind, generatedAt, build: "V3.6.3 Monitoring / Proof-of-Work",
    purpose: "Read-only export of accumulated council/file-cabinet intelligence. This export does not alter trading behavior.",
    fileCabinetEvidence: view.fileCabinetEvidence,
    councilRuns: team.councilRuns,
    opportunityCount: view.opportunityCount,
    rejectionCounts: team.rejectionCounts,
    lastCouncil: team.lastCouncil ?? null,
    rolePerformance: team.rolePerformance,
  };

  if (kind === "rug") {
    const positions = team.positions.filter(p => p.status === "unsellable" || !!p.lockedReason);
    return {
      kind, generatedAt, build: "V3.6.3 Monitoring / Proof-of-Work",
      purpose: "Read-only rug/locked-capital evidence for post-mortem analysis.",
      summary: { incidents: positions.length, lockedCapitalLossUsd: round(team.lockedCapitalLossUsd) },
      incidents: positions.map(p => ({
        id:p.id, chain:p.chain, tokenAddress:p.tokenAddress, symbol:p.symbol, openedAt:p.openedAt, closedAt:p.closedAt ?? null,
        entryPrice:p.entryPrice, lastMarkPrice:p.markPrice, entryNotionalUsd:p.entryNotionalUsd, remainingQuantity:p.remainingQuantity,
        realizedPnlUsd:p.realizedPnlUsd, lockedReason:p.lockedReason ?? null, exitReason:p.exitReason ?? null,
        sellabilityFailureCount:p.sellabilityFailureCount ?? 0, deadlineRefreshFailures:p.deadlineRefreshFailures ?? 0,
        decisionId:p.decisionId, memberOpinions:p.memberOpinions,
      }))
    };
  }

  const positionById = new Map(team.positions.map(p => [p.id, p]));
  const evidence = team.trades.map(t => {
    const positionId = t.id.replace(/-(BUY|TRIM|SELL|LOCKED).*$/, "");
    const p = positionById.get(positionId);
    const expectedValue = round(t.quantity * t.price);
    const valueDelta = round(t.valueUsd - expectedValue);
    const mathConfirmed = Math.abs(valueDelta) <= 0.02 || t.action === "LOCKED";
    return { ...t, expectedGrossValueUsd: expectedValue, recordedValueDeltaUsd:valueDelta, mathConfirmed,
      positionStatus:p?.status ?? "unknown", decisionId:p?.decisionId ?? null, tokenAddress:p?.tokenAddress ?? null,
      evidenceStatus: mathConfirmed ? "CONFIRMED_INTERNAL" : "UNCONFIRMED",
      note: t.note,
    };
  });
  const confirmed = evidence.filter(e => e.evidenceStatus === "CONFIRMED_INTERNAL").length;
  const openValueUsd = round(team.openValueUsd);
  const independentlyReconstructedEquityUsd = round(team.cashUsd + openValueUsd);
  return {
    kind, generatedAt, build: "V3.6.3 Monitoring / Proof-of-Work",
    purpose: "Read-only audit evidence. CONFIRMED_INTERNAL proves ledger/math consistency only; live execution requires wallet/chain evidence.",
    heartbeat: {
      generatedAt: view.generatedAt, lastOpportunityAt:view.lastOpportunityAt ?? null, lastMarkRefreshAt:view.lastMarkRefreshAt ?? null,
      opportunityCount:view.opportunityCount, councilRuns:team.councilRuns, lastRejectionReason:team.lastRejectionReason ?? null,
      rejectionCounts:team.rejectionCounts,
    },
    reconciliation: {
      startingCashUsd:team.startingCashUsd, cashUsd:team.cashUsd, openValueUsd, reportedEquityUsd:team.equityUsd,
      independentlyReconstructedEquityUsd, equityDeltaUsd:round(team.equityUsd-independentlyReconstructedEquityUsd),
      reportedRealizedPnlUsd:team.realizedPnlUsd, reportedUnrealizedPnlUsd:team.unrealizedPnlUsd, reportedTotalPnlUsd:team.totalPnlUsd,
      accountingVerified:team.accountingVerified, accountingDeltaUsd:team.accountingDeltaUsd,
    },
    verification: { records:evidence.length, confirmedInternal:confirmed, unconfirmed:evidence.length-confirmed },
    trades:evidence,
    positions:team.positions,
  };
}
