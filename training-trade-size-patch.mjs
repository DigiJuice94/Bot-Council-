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
    const riskCapacityUsd = Math.max(0, portfolio.equityUsd * Math.max(0, result.risk.maxPositionPct) / 100);
    const trainingCapacityUsd = Math.min(Math.max(0, portfolio.cashUsd), riskCapacityUsd);
    if (trainingCapacityUsd + 0.005 < minimumBuyUsd) {
      const reason = \`Training entry skipped: setup only supports $\${trainingCapacityUsd.toFixed(2)} within current risk/cash limits, below the $\${minimumBuyUsd.toFixed(2)} paper-training minimum.\`;
      recordRejection(reason);
      addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER"} skipped for $\${result.snapshot.symbol}: \${reason}\`, "execution");
      return false;
    }
    request = {
      ...request,
      notionalUsd: Number(Math.min(trainingCapacityUsd, Math.max(minimumBuyUsd, request.notionalUsd)).toFixed(2)),
    };
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
  const probeCapacityUsd = Math.min(portfolio.cashUsd, portfolio.equityUsd * maxPct / 100);
  if (probeCapacityUsd + 0.005 < minimumBuyUsd) return null;
  const notionalUsd = Number(Math.min(probeCapacityUsd, Math.max(minimumBuyUsd, portfolio.equityUsd * maxPct / 100)).toFixed(2));`,
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

  console.log("[v2.22-training-size] Training mode now requires $50+ new paper BUYs and $50+ scale-ins by default. Small exits/trims remain allowed so Guardian can manage risk.");
}
