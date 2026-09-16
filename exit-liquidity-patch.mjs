import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.18.2-exit-fix] ${message}`);
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
  console.log(`[v2.18.2-exit-fix] patched ${rel}`);
}

export function applyExitLiquidityPatch(root = process.cwd()) {
  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '    maxSlippageBps: side === "BUY" ? 135 : 175,',
      '    maxSlippageBps: side === "BUY" ? 135 : suffix === "EXIT" ? 9000 : 750,',
      "paper SELL slippage policy"
    );
    return text;
  });

  patchFile(root, "lib/execution.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      '  const liquidityModelBps = Math.max(8, Math.round((request.notionalUsd / Math.max(snapshot.liquidity, 1)) * 10_000 * 0.65 + snapshot.volatility * 18));',
      `  // Linear impact could exceed 100% on thin pools and permanently trap paper exits.
  // Use a bounded constant-product-style impact curve instead: small trades behave
  // similarly to the old model, while very large trades asymptotically approach 65%.
  const tradeToLiquidity = request.notionalUsd / Math.max(snapshot.liquidity, 1);
  const liquidityModelBps = Math.max(8, Math.round((tradeToLiquidity / (1 + tradeToLiquidity)) * 6_500 + snapshot.volatility * 18));`,
      "bounded liquidity impact model"
    );

    const oldReject = `  const routeBps = route.estimatedSlippageBps ?? 0;
  const observedSlippageBps = Math.max(liquidityModelBps, routeBps);
  if (observedSlippageBps > request.maxSlippageBps) {
    throw new Error(\`Paper \${request.side} rejected: estimated live-route/liquidity impact \${observedSlippageBps} bps exceeds \${request.maxSlippageBps} bps limit.\`);
  }
  const simulatedSlippageBps = Math.min(request.maxSlippageBps, observedSlippageBps);
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000 : 1 - simulatedSlippageBps / 10_000;
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;

  return {
    id: \`PF-\${Date.now().toString(36).toUpperCase()}-\${Math.random().toString(36).slice(2, 6).toUpperCase()}\`,
    chain: request.chain,
    symbol: request.symbol,
    side: request.side,
    requestedUsd: request.notionalUsd,
    filledUsd: Number((request.notionalUsd * (1 - feeRate)).toFixed(4)),
    fillPrice: snapshot.price * priceImpact,
    slippageBps: simulatedSlippageBps,
    feeUsd: Number((request.notionalUsd * feeRate).toFixed(4)),
    routeVerified: route.verified && route.available,
    routeProvider: route.provider,
    routeNote: route.reason,
    createdAt: new Date().toISOString(),
  };`;

    const newReject = `  const routeBps = route.estimatedSlippageBps ?? 0;
  const observedSlippageBps = Math.max(liquidityModelBps, routeBps);
  const forcedPaperExit = request.mode === "paper" && request.side === "SELL" && request.decisionId.endsWith("-EXIT");

  // Entries and ordinary trims still respect their slippage ceiling.
  // A Guardian emergency/full exit must never become permanently stuck because the
  // market is already illiquid. In paper mode we instead record a distressed fill
  // with the modeled loss, capped below 100% so proceeds can never become negative.
  if (observedSlippageBps > request.maxSlippageBps && !forcedPaperExit) {
    throw new Error(\`Paper \${request.side} rejected: estimated live-route/liquidity impact \${observedSlippageBps} bps exceeds \${request.maxSlippageBps} bps limit.\`);
  }

  const simulatedSlippageBps = forcedPaperExit
    ? Math.min(9_000, observedSlippageBps)
    : Math.min(request.maxSlippageBps, observedSlippageBps);
  const priceImpact = request.side === "BUY" ? 1 + simulatedSlippageBps / 10_000 : 1 - simulatedSlippageBps / 10_000;
  const feeRate = snapshot.chainFamily === "solana" ? 0.0015 : 0.0025;
  const grossFilledUsd = request.side === "SELL"
    ? request.notionalUsd * Math.max(0.01, 1 - simulatedSlippageBps / 10_000)
    : request.notionalUsd;
  const feeUsd = grossFilledUsd * feeRate;
  const distressed = forcedPaperExit && observedSlippageBps > request.maxSlippageBps;

  return {
    id: \`PF-\${Date.now().toString(36).toUpperCase()}-\${Math.random().toString(36).slice(2, 6).toUpperCase()}\`,
    chain: request.chain,
    symbol: request.symbol,
    side: request.side,
    requestedUsd: request.notionalUsd,
    filledUsd: Number((grossFilledUsd - feeUsd).toFixed(4)),
    fillPrice: snapshot.price * priceImpact,
    slippageBps: simulatedSlippageBps,
    feeUsd: Number(feeUsd.toFixed(4)),
    routeVerified: route.verified && route.available,
    routeProvider: route.provider,
    routeNote: distressed
      ? \`DISTRESSED PAPER EXIT: normal limit \${request.maxSlippageBps} bps was exceeded; Guardian forced liquidation at modeled \${simulatedSlippageBps} bps impact instead of leaving the position trapped. Source estimate: \${observedSlippageBps} bps. \${route.reason}\`
      : route.reason,
    createdAt: new Date().toISOString(),
  };`;

    text = replaceRequired(text, oldReject, newReject, "paper execution slippage block");
    return text;
  });

  console.log("[v2.18.2-exit-fix] Guardian exits can no longer deadlock on the old 175 bps SELL cap; distressed paper exits now realize the modeled liquidity loss.");
}
