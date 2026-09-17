// Run before serving requests or starting the Council's runtime loops.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { resetPaperWalletPreserveLearning } = await import("./lib/paper-wallet");
    await resetPaperWalletPreserveLearning(
      "Fresh PAPER run requested for always-live chat release",
      "v3-fresh-fresh-reset-20260917",
    );
  }
}
