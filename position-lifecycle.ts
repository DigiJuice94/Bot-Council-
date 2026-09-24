import type { ManagedPosition } from "./types";

export const REGULAR_TRADE_MAX_HOLD_MINUTES = 20;
export const EXIT_VERIFICATION_GRACE_MS = 2 * 60_000;

/**
 * Enforce the already-established turnover deadline without inventing a fill.
 * Execution still requires a fresh snapshot and a verified reverse route.
 */
export function markOverduePositionExitPending(position: ManagedPosition, nowMs = Date.now()): ManagedPosition {
  if (position.status !== "open") return position;
  const openedMs = Date.parse(position.openedAt);
  if (!Number.isFinite(openedMs) || nowMs - openedMs < REGULAR_TRADE_MAX_HOLD_MINUTES * 60_000) return position;
  const now = new Date(nowMs).toISOString();
  return {
    ...position,
    status: "exit_pending",
    exitPendingAt: now,
    updatedAt: now,
    lastAction: "EXIT",
    lastReason: "Exit: regular trade reached the 20-minute maximum hold.",
  };
}

/** Preserve unsold quantity for later verified recovery while freeing the active slot.
 * Zero proceeds and zero positive mark are credited for an unverified exit.
 */
export function parkUnverifiedExit(position: ManagedPosition, nowMs = Date.now()): ManagedPosition {
  if (position.status !== "exit_pending") return position;
  const openedMs = Date.parse(position.openedAt);
  const pendingMs = Date.parse(position.exitPendingAt ?? "");
  const deadlineMs = Number.isFinite(openedMs) ? openedMs + REGULAR_TRADE_MAX_HOLD_MINUTES * 60_000 : Infinity;
  // A regular 20-minute exit gets its route attempt in this Guardian cycle,
  // then leaves the active wallet immediately if unverified. Earlier exit
  // signals get two minutes to retry, bounded by the same 20-minute limit.
  const eligibleAt = Number.isFinite(pendingMs)
    ? Math.min(pendingMs + EXIT_VERIFICATION_GRACE_MS, deadlineMs)
    : deadlineMs;
  if (nowMs < eligibleAt) return position;
  const now = new Date(nowMs).toISOString();
  return {
    ...position,
    status: "exit_unverified",
    markPrice: 0,
    unverifiedExitAt: now,
    unverifiedExitReason: position.sellAuditReason || "No independently verified sell route was available at the exit deadline.",
    updatedAt: now,
    lastAction: "EXIT",
    lastReason: `Unverified exit: paper position removed from liquid equity with no sale or proceeds credited. ${position.sellAuditReason ?? "Reverse sell route could not be verified."} Sell verification will continue.`,
  };
}
