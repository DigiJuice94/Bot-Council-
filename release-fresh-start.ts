import { resetPaperWalletPreserveLearning } from "./paper-wallet";

const RELEASE_RESET_ID = "v3.4-sellability-investigator-reset-retry-20260918";
const RELEASE_RESET_REASON = "One-time fresh PAPER ledger retry for the V3.4 Sellability Investigator release";

const releaseState = globalThis as typeof globalThis & {
  __botWarRoomReleaseFreshStartV34?: Promise<void>;
};

/**
 * Blocks every PAPER runtime entry point until this release's one-time reset
 * has either completed or been confirmed as already completed in Redis.
 */
export function ensureReleaseFreshStart(): Promise<void> {
  if (releaseState.__botWarRoomReleaseFreshStartV34) {
    return releaseState.__botWarRoomReleaseFreshStartV34;
  }

  const reset = resetPaperWalletPreserveLearning(RELEASE_RESET_REASON, RELEASE_RESET_ID)
    .then(() => undefined)
    .catch((error) => {
      // A transient Redis/startup failure must not permanently poison this
      // process. The next request retries before any PAPER activity can run.
      releaseState.__botWarRoomReleaseFreshStartV34 = undefined;
      throw error;
    });

  releaseState.__botWarRoomReleaseFreshStartV34 = reset;
  return reset;
}
