// Run before serving requests or starting the Council's runtime loops.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { resetPaperWalletPreserveLearning } = await import("./lib/paper-wallet");
    await resetPaperWalletPreserveLearning(
      "Fresh verified PAPER ledger requested for Portfolio Auditor release",
      "v3-portfolio-auditor-reset-20260918",
    );
    const { migrateEntityMemoryNamespace } = await import("./lib/agent-entity-store");
    await migrateEntityMemoryNamespace("tournament:team-10", "main:file-cabinet");
    const { migratePersistedPositionsToCanonicalPolicy } = await import("./lib/position-manager");
    await migratePersistedPositionsToCanonicalPolicy();
    // The scanner and Guardian are server jobs. Starting them here prevents a
    // closed browser tab from being mistaken for healthy inactivity.
    const { ensureAutonomousWarRoom } = await import("./lib/autopilot");
    ensureAutonomousWarRoom();
  }
}
