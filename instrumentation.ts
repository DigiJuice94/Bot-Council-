// Run before serving requests or starting the Council's runtime loops.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { ensureReleaseFreshStart } = await import("./lib/release-fresh-start");
    await ensureReleaseFreshStart();
  }
}
