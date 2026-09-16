import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.24-fixed-training] ${message}`);
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
  console.log(`[v2.24-fixed-training] patched ${rel}`);
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
  // The Council decides whether there is an opportunity. Sizing does not add
  // another quality test: every approved PAPER buy/probe is one fixed $50 rep.
  if (request.mode === "paper" && request.side === "BUY") {
    const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
    if (portfolio.cashUsd + 0.005 < trainingTradeUsd) {
      const reason = \`Paper wallet has $\${portfolio.cashUsd.toFixed(2)} cash; waiting for an exit before the next fixed $\${trainingTradeUsd.toFixed(2)} training buy.\`;
      recordRejection(reason);
      addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER"} waiting for cash on $\${result.snapshot.symbol}: \${reason}\`, "execution");
      return false;
    }
    request = { ...request, notionalUsd: Number(trainingTradeUsd.toFixed(2)) };
    addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER BUY"} locked at $\${trainingTradeUsd.toFixed(2)} for $\${result.snapshot.symbol}. Win or lose, file the result and learn from it.\`, "execution");
  }

  const context = entryContext(result, portfolio);
  if (exploration) {
    context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;
  }`,
      "fixed paper BUY"
    );

    text = replaceRequired(
      text,
      `  const maxPct = Math.max(0.25, Math.min(3, Number(process.env.PAPER_EXPLORATION_MAX_PCT ?? 1.5)));
  const notionalUsd = Number(Math.min(portfolio.cashUsd, Math.max(2, portfolio.equityUsd * maxPct / 100)).toFixed(2));
  if (notionalUsd <= 0) return null;`,
      `  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  if (portfolio.cashUsd + 0.005 < trainingTradeUsd) return null;
  const notionalUsd = Number(trainingTradeUsd.toFixed(2));`,
      "fixed WATCH probe"
    );

    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      `  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);
  const capPct = maxGrossExposurePct(position);
  const capUsd = Math.max(0, portfolio.equityUsd * capPct / 100);
  const exposureRoomUsd = Math.max(0, capUsd - position.entryNotionalUsd);
  const requestedUsd = Math.min(initialNotional * step.addMultipleOfInitial, exposureRoomUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd < 0.01) return { ...position, pendingScaleLabel: undefined, lastAction: "HOLD", lastReason: \`Scale-in skipped: \${capPct.toFixed(2)}% gross exposure cap or available paper cash is already reached.\` };`,
      `  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);
  const capPct = maxGrossExposurePct(position);
  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  const requestedUsd = Math.min(trainingTradeUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd + 0.005 < trainingTradeUsd) {
    return {
      ...position,
      pendingScaleLabel: undefined,
      lastAction: "HOLD",
      lastReason: \`Scale-in signal remains valid, but only $\${portfolio.cashUsd.toFixed(2)} paper cash is available. Waiting for an exit before the next fixed $\${trainingTradeUsd.toFixed(2)} add.\`,
    };
  }`,
      "fixed winner add"
    );
    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      `  const threshold = Math.max(0, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? 1));`,
      `  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  const threshold = Math.max(trainingTradeUsd, Number(process.env.PAPER_AUTO_REFILL_THRESHOLD_USD ?? trainingTradeUsd));`,
      "research bankroll floor"
    );
    return text;
  });

  console.log("[v2.24-fixed-training] Council-approved paper opportunities use fixed $50 BUYs/probes/adds. No extra sizing-quality gate.");
}
