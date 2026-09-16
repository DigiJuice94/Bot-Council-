import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.22-training-size] ${message}`);
  process.exit(1);
}

function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find patch anchor: ${label}`);
  return text.replace(search, replacement);
}

function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.22-training-size] patched ${rel}`);
}

export function applyTrainingTradeSizePatch(root = process.cwd()) {
  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      `async function executeRequest(result: WarRoomResult, portfolio: PortfolioRiskContext, request: ExecutionRequest, exploration: boolean) {
  const context = entryContext(result, portfolio);
  if (exploration) {
    context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;
  }`,
      `async function executeRequest(result: WarRoomResult, portfolio: PortfolioRiskContext, request: ExecutionRequest, exploration: boolean) {
  // V2.22 training rule: no micro paper entries. A setup must deserve enough
  // risk budget for a meaningful trade, otherwise we observe it without buying.
  if (request.mode === "paper" && request.side === "BUY") {
    const minimumBuyUsd = Math.max(10, Number(process.env.PAPER_MIN_BUY_USD ?? 50));
    // Once Council / exploration has already approved the setup, soft sizing penalties
    // cannot reduce it below the meaningful $50 paper-training floor.
    // Only real cash / portfolio / chain capacity can prevent the floor.
    const totalRoomPct = Math.max(0, portfolio.maxTotalExposurePct - portfolio.totalExposurePct);
    const chainRoomPct = Math.max(0, portfolio.maxChainExposurePct - portfolio.chainExposurePct);
    const totalRoomUsd = Math.max(0, portfolio.equityUsd * totalRoomPct / 100);
    const chainRoomUsd = Math.max(0, portfolio.equityUsd * chainRoomPct / 100);
    const trainingCapacityUsd = Math.min(
      Math.max(0, portfolio.cashUsd),
      totalRoomUsd,
      chainRoomUsd,
    );
    if (trainingCapacityUsd + 0.005 < minimumBuyUsd) {
      const reason = \`Training entry waiting on capacity: only $\${trainingCapacityUsd.toFixed(2)} remains inside cash / portfolio / chain limits, below the $\${minimumBuyUsd.toFixed(2)} minimum. This is not a quality rejection.\`;
      recordRejection(reason);
      addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER"} waiting on capacity for $\${result.snapshot.symbol}: \${reason}\`, "execution");
      return false;
    }
    request = {
      ...request,
      notionalUsd: Number(Math.min(trainingCapacityUsd, Math.max(minimumBuyUsd, request.notionalUsd)).toFixed(2)),
    };
    addChat(
      "Executor",
      \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER"} sizing $\${result.snapshot.symbol} at $\${request.notionalUsd.toFixed(2)}. Approved setups cannot be shrunk into micro trades by soft sizing warnings; hard safety vetoes still apply.\`,
      "execution",
    );
  }

  const context = entryContext(result, portfolio);
  if (exploration) {
    context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;
  }`,
      "minimum paper BUY enforcement"
    );

    text = replaceRequired(
      text,
      `  const maxPct = Math.max(0.25, Math.min(3, Number(process.env.PAPER_EXPLORATION_MAX_PCT ?? 1.5)));
  const notionalUsd = Number(Math.min(portfolio.cashUsd, Math.max(2, portfolio.equityUsd * maxPct / 100)).toFixed(2));
  if (notionalUsd <= 0) return null;`,
      `  const minimumBuyUsd = Math.max(10, Number(process.env.PAPER_MIN_BUY_USD ?? 50));
  const maxPct = Math.max(5, Math.min(10, Number(process.env.PAPER_EXPLORATION_MAX_PCT ?? 6)));
  const targetProbeUsd = Math.max(minimumBuyUsd, portfolio.equityUsd * maxPct / 100);
  // Final execution checks actual portfolio/chain capacity. Do not suppress an
  // otherwise qualified probe just because soft sizing would have been a micro trade.
  const notionalUsd = Number(Math.min(Math.max(0, portfolio.cashUsd), targetProbeUsd).toFixed(2));
  if (notionalUsd + 0.005 < minimumBuyUsd) return null;`,
      "meaningful WATCH probe sizing"
    );

    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      `  const requestedUsd = Math.min(initialNotional * step.addMultipleOfInitial, exposureRoomUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd < 0.01) return { ...position, pendingScaleLabel: undefined, lastAction: "HOLD", lastReason: \`Scale-in skipped: \${capPct.toFixed(2)}% gross exposure cap or available paper cash is already reached.\` };`,
      `  const requestedUsd = Math.min(initialNotional * step.addMultipleOfInitial, exposureRoomUsd, Math.max(0, portfolio.cashUsd));
  const minimumScaleUsd = Math.max(10, Number(process.env.PAPER_MIN_SCALE_IN_USD ?? process.env.PAPER_MIN_BUY_USD ?? 50));
  if (requestedUsd + 0.005 < minimumScaleUsd) {
    return {
      ...position,
      pendingScaleLabel: undefined,
      lastAction: "HOLD",
      lastReason: \`Scale-in skipped: only $\${requestedUsd.toFixed(2)} is available inside the \${capPct.toFixed(2)}% gross exposure/cash limit, below the $\${minimumScaleUsd.toFixed(2)} training minimum. No micro add.\`,
    };
  }`,
      "minimum paper scale-in enforcement"
    );

    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      `  const threshold = Math.max(0, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? 1));`,
      `  const minimumTrainingBuyUsd = Math.max(10, Number(process.env.PAPER_MIN_BUY_USD ?? 50));
  const threshold = Math.max(minimumTrainingBuyUsd, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? minimumTrainingBuyUsd));`,
      "training bankroll refill floor"
    );

    return text;
  });

  console.log("[v2.22.1-training-size] Approved paper setups receive at least $50 whenever cash and exposure capacity allow; soft sizing warnings no longer starve training trades.");
}
