import { recordAgentPerformance, saveAgentMemory, snapshotBuckets } from "./learning-store";
import type { ManagedPosition, MarketSnapshot, ResearchAgentId } from "./types";

const ids: ResearchAgentId[] = ["launch", "social", "wallet", "quant", "contract", "bear"];

export async function reflectOnClosedPosition(position: ManagedPosition, finalSnapshot: MarketSnapshot): Promise<void> {
  const context = position.entryContext;
  if (!context) return;
  const realizedReturnPct = position.entryNotionalUsd > 0 ? position.realizedPnlUsd / position.entryNotionalUsd * 100 : position.pnlPct;
  const buckets = snapshotBuckets(context.snapshot);
  const obviousExternalShock = Boolean(finalSnapshot.context?.benchmark24hPct !== undefined && finalSnapshot.context.benchmark24hPct <= -8);

  for (const agentId of ids) {
    const read = context.preMeeting.find((row) => row.agentId === agentId);
    if (!read) continue;
    const expectedUp = agentId === "bear" ? read.score >= 58 : read.score >= 58;
    const realizedUp = realizedReturnPct > 0;
    const directionalCorrect = expectedUp === realizedUp;
    const reasoningSupported = obviousExternalShock && !directionalCorrect ? null : directionalCorrect;
    const edgePct = realizedReturnPct * ((read.score - 50) / 50);
    await recordAgentPerformance({ agentId, regimeId: context.regime.id, chain: context.snapshot.chain, marketCapBucket: buckets.marketCapBucket, ageBucket: buckets.ageBucket, directionalCorrect, reasoningSupported, edgePct });

    const lesson = directionalCorrect
      ? `${agentId} read was directionally supported in ${context.regime.label}; preserve the evidence pattern but do not increase risk without more samples.`
      : obviousExternalShock
        ? `${agentId} read lost during a broad shock; mark outcome unclear rather than treating it as a pure reasoning failure.`
        : `${agentId} read was not supported in ${context.regime.label}; reduce confidence in this pattern until similar evidence proves itself.`;

    await saveAgentMemory({
      id: `MEM-${position.id}-${agentId}`,
      agentId,
      regimeId: context.regime.id,
      chain: position.chain,
      marketCapBucket: buckets.marketCapBucket,
      ageBucket: buckets.ageBucket,
      entryScore: read.score,
      entryThesis: read.thesis,
      realizedReturnPct: Number(realizedReturnPct.toFixed(3)),
      maxFavorableExcursionPct: position.maxFavorableExcursionPct,
      maxAdverseExcursionPct: position.maxAdverseExcursionPct,
      reasoningOutcome: reasoningSupported === null ? "unclear" : reasoningSupported ? "supported" : "unsupported",
      lesson,
      createdAt: new Date().toISOString(),
    });
  }
}
