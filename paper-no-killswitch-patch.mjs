import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.26.2-paper-no-killswitch] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.26.2-paper-no-killswitch] patched ${rel}`);
}

export function applyPaperNoKillSwitchPatch(root = process.cwd()) {
  patchFile(root, "lib/risk.ts", (input) => {
    let text = input;

    // PAPER mode must never stop research because the wallet is down, because too
    // many positions exist, or because portfolio/chain exposure crossed an old
    // mature-strategy threshold. Actual paper cash remains the capital boundary.
    const memoryAnchor = '  const paperCanExploreUnknowns = !p.liveTradingEnabled && process.env.PAPER_FAIL_CLOSED_UNKNOWN !== "true";';
    if (!text.includes("const paperResearchMode = !p.liveTradingEnabled;")) {
      if (!text.includes(memoryAnchor)) fail("Could not find paper-mode risk anchor");
      text = text.replace(
        memoryAnchor,
        `${memoryAnchor}
  const paperResearchMode = !p.liveTradingEnabled;`,
      );
    }

    const comment = "    // PAPER Runner Lab is allowed to spend the actual paper cash while it learns.";
    const commentAt = text.indexOf(comment);
    if (commentAt >= 0) {
      const blockStart = text.lastIndexOf("  if (earlyRunnerLane) {", commentAt);
      const blockEnd = text.indexOf("  if ((q?.top10 ?? true)", commentAt);
      if (blockStart < 0 || blockEnd < 0) fail("Could not locate old paper portfolio kill-switch block");
      const replacement = `  if (paperResearchMode) {
    passedChecks.push("Paper Runner Lab has NO daily-loss kill switch");
    passedChecks.push("Paper Runner Lab has NO max-open-position kill switch");
    passedChecks.push("Paper Runner Lab has NO portfolio-exposure kill switch");
    passedChecks.push("Paper Runner Lab has NO chain-exposure kill switch");
    passedChecks.push("Actual paper-wallet cash is the only portfolio capital boundary");
  } else {
    check(p.dailyPnlPct > -p.maxDailyLossPct, "Live daily loss limit available", "Live daily loss kill-switch triggered");
    check(p.openPositions < p.maxOpenPositions, "Live open-position capacity available", "Live maximum open positions reached");
    check(p.totalExposurePct < p.maxTotalExposurePct, "Live portfolio exposure below cap", "Live maximum portfolio exposure reached");
    check(p.chainExposurePct < p.maxChainExposurePct, "Live chain exposure below cap", "Live maximum chain exposure reached");
  }

`;
      text = text.slice(0, blockStart) + replacement + text.slice(blockEnd);
    } else if (!text.includes('Paper Runner Lab has NO daily-loss kill switch')) {
      fail("Could not find generated PAPER Runner Lab risk block");
    }

    // Never let old exposure math drive paper maxPositionPct to zero. The $50+
    // adaptive sizing layer owns paper notional after the Council chooses a setup.
    const oldExposure = `  if (!earlyRunnerLane) {
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  }`;
    const newExposure = `  if (!paperResearchMode) {
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  } else if (!hardBlocks.length) {
    // Keep execution-plan math non-zero; actual PAPER sizing is replaced downstream
    // by Runner Genome sizing with a $50 minimum and current wallet cash ceiling.
    maxPositionPct = Math.max(maxPositionPct, 0.25);
  }`;
    if (text.includes(oldExposure)) text = text.replace(oldExposure, newExposure);
    else if (!text.includes("if (!paperResearchMode) {")) fail("Could not harden paper exposure sizing");

    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;

    // These fields remain in the shared type for live-mode compatibility, but in
    // PAPER Runner Lab they are deliberately non-binding.
    text = text.replace(
      /maxDailyLossPct:\s*Number\(process\.env\.PAPER_MAX_DAILY_LOSS_PCT\s*\?\?\s*[^)]+\)/,
      'maxDailyLossPct: Number(process.env.PAPER_MAX_DAILY_LOSS_PCT ?? 10000)',
    );
    text = text.replace(
      /maxOpenPositions:\s*Number\(process\.env\.PAPER_MAX_OPEN_POSITIONS\s*\?\?\s*[^)]+\)/,
      'maxOpenPositions: Number(process.env.PAPER_MAX_OPEN_POSITIONS ?? 10000)',
    );
    text = text.replace(
      /maxTotalExposurePct:\s*Number\(process\.env\.PAPER_MAX_TOTAL_EXPOSURE_PCT\s*\?\?\s*[^)]+\)/,
      'maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 10000)',
    );
    text = text.replace(
      /maxChainExposurePct:\s*Number\(process\.env\.PAPER_MAX_CHAIN_EXPOSURE_PCT\s*\?\?\s*[^)]+\)/,
      'maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 10000)',
    );

    if (!text.includes("PAPER_MAX_DAILY_LOSS_PCT ?? 10000")) fail("Could not neutralize paper daily-loss field");
    if (!text.includes("PAPER_MAX_OPEN_POSITIONS ?? 10000")) fail("Could not neutralize paper open-position field");
    return text;
  });

  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;

    // Belt-and-suspenders enforcement: the autonomous scanner is not allowed to
    // silently route back through the legacy synthetic Council.
    if (text.includes('import { runWarRoom } from "./engine";')) {
      text = text.replace('import { runWarRoom } from "./engine";', 'import { runIndependentCouncil } from "./agent-entity-runtime";');
    }
    if (text.includes("  const result = runWarRoom(snapshot, {")) {
      text = text.replace("  const result = runWarRoom(snapshot, {", "  const result = await runIndependentCouncil(snapshot, {");
    }
    if (!text.includes('import { runIndependentCouncil } from "./agent-entity-runtime";')) {
      fail("Independent Council import missing after all patches");
    }
    if (!text.includes("  const result = await runIndependentCouncil(snapshot, {")) {
      fail("Autonomous scanner is not using runIndependentCouncil");
    }

    const resultBoundary = "  });\n\n  await observeCouncilResult(result);";
    if (!text.includes("Independent Council trace missing; refusing legacy synthetic decision")) {
      if (!text.includes(resultBoundary)) fail("Could not find Council result boundary");
      text = text.replace(
        resultBoundary,
        `  });

  if (!result.independentCouncil) {
    throw new Error("Independent Council trace missing; refusing legacy synthetic decision");
  }

  await observeCouncilResult(result);`,
      );
    }

    text = text.replace(
      'addChat("CIO", `$${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 roles aligned/ready. Wallet equity $${portfolio.equityUsd.toFixed(2)}.`, "council");',
      'addChat("CIO", `$${snapshot.symbol}: ${result.decision} at ${result.conviction}% conviction. ${result.councilProcess.alignedBots}/8 independent entities aligned after meeting. PAPER kill switches OFF. Wallet equity $${portfolio.equityUsd.toFixed(2)}.`, "council");',
    );

    return text;
  });

  console.log("[v2.26.2-paper-no-killswitch] PAPER Runner Lab portfolio kill switches removed. Hard token-safety checks, route feasibility, and real cash accounting remain.");
}
