import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.17-sizing] ${message}`);
  process.exit(1);
}

function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.17-sizing] patched ${rel}`);
}

function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find patch anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyPositionSizingPatch(root = process.cwd()) {
  patchFile(root, "lib/risk.ts", (input) => {
    let text = input;

    const oldSizing = `  let maxPositionPct = 2;
  if (warnings.length >= 1) maxPositionPct = 1.25;
  if (warnings.length >= 2) maxPositionPct = 0.75;
  if (warnings.length >= 3) maxPositionPct = 0.5;
  if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 0.5);
  if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 0.25);
  if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 0.5);`;

    const newSizing = `  // V2.17: paper research can take materially larger positions so wins/losses
  // teach the Runner Genome with meaningful portfolio impact. Live remains conservative.
  const paperMode = !p.liveTradingEnabled;
  const configuredPaperMax = Math.max(1, Math.min(12, Number(process.env.PAPER_MAX_POSITION_PCT ?? 7.5)));
  const configuredLiveMax = Math.max(0.25, Math.min(5, Number(process.env.LIVE_MAX_POSITION_PCT ?? 2)));
  let maxPositionPct = paperMode ? configuredPaperMax : configuredLiveMax;

  if (paperMode) {
    if (warnings.length >= 1) maxPositionPct = Math.min(maxPositionPct, 5);
    if (warnings.length >= 2) maxPositionPct = Math.min(maxPositionPct, 3);
    if (warnings.length >= 3) maxPositionPct = Math.min(maxPositionPct, 1.5);
    if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 2.5);
    if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 1);
    if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 2);
  } else {
    if (warnings.length >= 1) maxPositionPct = Math.min(maxPositionPct, 1.25);
    if (warnings.length >= 2) maxPositionPct = Math.min(maxPositionPct, 0.75);
    if (warnings.length >= 3) maxPositionPct = Math.min(maxPositionPct, 0.5);
    if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 0.5);
    if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 0.25);
    if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 0.5);
  }`;

    text = replaceRequired(text, oldSizing, newSizing, "risk position sizing ladder");
    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 35),',
      '    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 60),',
      "paper max total exposure"
    );
    text = replaceRequired(
      text,
      '    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 15),',
      '    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 30),',
      "paper max chain exposure"
    );
    return text;
  });

  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  const maxPct = Math.max(0.1, Math.min(1, Number(process.env.PAPER_EXPLORATION_MAX_PCT ?? 0.5)));',
      '  const maxPct = Math.max(0.25, Math.min(3, Number(process.env.PAPER_EXPLORATION_MAX_PCT ?? 1.5)));',
      "paper exploration position cap"
    );
    return text;
  });

  patchFile(root, "lib/position-policy.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  if (typeof initialPct === "number" && initialPct > 0) return Number(Math.min(5, Math.max(initialPct, initialPct * 2.8)).toFixed(3));\n  return position.maxGrossExposurePct ?? 5;',
      '  const cap = Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)));\n  if (typeof initialPct === "number" && initialPct > 0) return Number(Math.min(cap, Math.max(initialPct, initialPct * 2.8)).toFixed(3));\n  return position.maxGrossExposurePct ?? cap;',
      "winner max gross exposure"
    );
    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '    maxGrossExposurePct: safe(position.maxGrossExposurePct, 5),',
      '    maxGrossExposurePct: safe(position.maxGrossExposurePct, Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)))),',
      "normalized max gross exposure"
    );
    text = replaceRequired(
      text,
      '  const maxExposure = typeof initialAllocationPct === "number" && initialAllocationPct > 0 ? Math.min(5, initialAllocationPct * 2.8) : 5;',
      '  const winnerCap = Math.max(5, Math.min(20, Number(process.env.PAPER_WINNER_MAX_GROSS_PCT ?? 15)));\n  const maxExposure = typeof initialAllocationPct === "number" && initialAllocationPct > 0 ? Math.min(winnerCap, initialAllocationPct * 2.8) : winnerCap;',
      "registered max gross exposure"
    );
    return text;
  });

  console.log("[v2.17-sizing] Paper sizing expanded: up to 7.5% initial, 1.5% probes, 60% portfolio exposure, 30% chain exposure, 15% confirmed-winner gross cap. Live defaults remain conservative.");
}
