export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { ensureAutonomousWarRoom } = await import("./lib/autopilot");
    ensureAutonomousWarRoom();
  }
}
