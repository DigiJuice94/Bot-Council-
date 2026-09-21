// Start the promoted winner when the server process starts. Discovery must not
// depend on somebody keeping the dashboard open.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { ensureAutonomousWarRoom } = await import("./lib/autopilot");
    ensureAutonomousWarRoom();
  }
}
