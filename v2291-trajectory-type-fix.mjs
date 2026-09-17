import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.29.1-trajectory-type-fix] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.29.1-trajectory-type-fix] patched ${rel}`);
}

export function applyV2291TrajectoryTypeFix(root = process.cwd()) {
  patchFile(root, "lib/engine.ts", (input) => {
    let text = input;

    if (!text.includes("trajectoryPhase: \"INSUFFICIENT\"")) {
      const anchor = `    dumperEvidence: [], expectedPeakMultiple: 3, expectedTimeToPeakMinutes: 90, typicalRunnerDrawdownPct: 25,
  };`;
      if (!text.includes(anchor)) {
        fail("Could not find RunnerGenome heuristic fallback in lib/engine.ts");
      }
      text = text.replace(
        anchor,
        `    dumperEvidence: [], expectedPeakMultiple: 3, expectedTimeToPeakMinutes: 90, typicalRunnerDrawdownPct: 25,
    trajectoryScore: 50,
    trajectoryDumperRiskScore: 50,
    trajectoryConfidence: 0,
    trajectoryPhase: "INSUFFICIENT",
    trajectorySampleSize: 0,
    trajectoryChainSampleSize: 0,
    trajectoryEvidence: ["Trajectory Observer does not yet have a multi-snapshot sequence for this fallback call."],
  };`,
      );
    }

    return text;
  });

  patchFile(root, "lib/trajectory-observer.ts", (input) => {
    let text = input;
    if (text.includes("trajectoryOutcome: row.outcome,")) {
      text = text.replace(
        "trajectoryOutcome: row.outcome,",
        'trajectoryOutcome: row.outcome === "runner" || row.outcome === "dumper" ? row.outcome : undefined,',
      );
    }
    if (!text.includes('trajectoryOutcome: row.outcome === "runner" || row.outcome === "dumper" ? row.outcome : undefined,')) {
      fail("Trajectory outcome narrowing is missing");
    }
    return text;
  });

  console.log("[v2.29.1-trajectory-type-fix] RunnerGenome fallback now includes trajectory defaults and observer outcome typing is narrowed.");
}
