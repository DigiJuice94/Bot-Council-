import type { ManagedPosition } from "./types";

export const REGULAR_TRADE_MAX_HOLD_MINUTES = 20;

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
    updatedAt: now,
    lastAction: "EXIT",
    lastReason: "Exit: regular trade reached the 20-minute maximum hold.",
  };
}
