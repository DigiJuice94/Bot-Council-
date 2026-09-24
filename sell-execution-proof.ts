import type { SellabilityAudit } from "./sellability-auditor";

export const SELL_PROOF_MAX_AGE_MS = 60_000;

export function isFreshVerifiedSellProof(
  audit: SellabilityAudit | null | undefined,
  nowMs = Date.now(),
): audit is SellabilityAudit & { status: "pass"; routeVerified: true } {
  if (!audit || audit.status !== "pass" || audit.routeVerified !== true) return false;
  const checkedMs = Date.parse(audit.checkedAt);
  return Number.isFinite(checkedMs) && nowMs >= checkedMs && nowMs - checkedMs <= SELL_PROOF_MAX_AGE_MS;
}
