// Run before serving requests or starting the Council's runtime loops.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { resetPaperWalletPreserveLearning } = await import("./lib/paper-wallet");
    await resetPaperWalletPreserveLearning(
      "Fresh verified PAPER ledger requested for Portfolio Auditor release",
      "v3-portfolio-auditor-reset-20260918",
    );
  }
}
