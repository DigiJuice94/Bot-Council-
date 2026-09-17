import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.29-trajectory-observer] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.29-trajectory-observer] patched ${rel}`);
}
function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyV229TrajectoryObserverPatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;

    if (!text.includes("trajectoryScore: number;")) {
      text = replaceRequired(
        text,
        "  typicalRunnerDrawdownPct: number;\n};",
        `  typicalRunnerDrawdownPct: number;
  trajectoryScore: number;
  trajectoryDumperRiskScore: number;
  trajectoryConfidence: number;
  trajectoryPhase: "INSUFFICIENT" | "IGNITION" | "ACCELERATION" | "PULLBACK" | "RECOVERY" | "DISTRIBUTION" | "STALLED";
  trajectorySampleSize: number;
  trajectoryChainSampleSize: number;
  trajectoryEvidence: string[];
};`,
        "Runner Genome trajectory fields",
      );
    }

    return text;
  });

  patchFile(root, "lib/agent-entity-store.ts", (input) => {
    let text = input;
    text = text.replace(
      '  kind: "decision" | "outcome";',
      '  kind: "decision" | "outcome" | "trajectory";',
    );
    if (!text.includes('kind: "decision" | "outcome" | "trajectory";')) fail("Could not extend private entity memory for trajectory lessons");
    if (!text.includes("trajectoryPhase?: string;")) {
      text = replaceRequired(
        text,
        "  profitCapturePct?: number;\n  lesson: string;",
        `  profitCapturePct?: number;
  trajectoryPhase?: string;
  trajectoryScore?: number;
  trajectoryDumperRiskScore?: number;
  trajectoryOutcome?: "runner" | "dumper";
  lesson: string;`,
        "structured trajectory memory fields",
      );
    }
    return text;
  });

  patchFile(root, "lib/runner-research.ts", (input) => {
    let text = input;

    if (!text.includes('from "./trajectory-observer"')) {
      text = replaceRequired(
        text,
        'import { recordIndependentCouncilOutcome } from "./agent-entity-store";',
        `import { recordIndependentCouncilOutcome } from "./agent-entity-store";
import { distributeTrajectoryOutcomeLesson, getTrajectoryGuidance, getTrajectoryObserverSnapshot, snapshotToTrajectoryObservation, type TrajectoryObserverSnapshot } from "./trajectory-observer";`,
        "Trajectory Observer import",
      );
    }

    text = text.replace(
      "const REVIEW_INTERVAL_MS = 2 * 60_000;",
      'const REVIEW_INTERVAL_MS = Math.max(15_000, Number(process.env.TRAJECTORY_OBSERVER_REVIEW_MS ?? 30_000));',
    );

    text = text.replace(
      'export type BotRole = "launch" | "social" | "wallet" | "quant" | "contract" | "bear" | "cio" | "executor";',
      'export type BotRole = "launch" | "social" | "wallet" | "quant" | "contract" | "bear" | "cio" | "executor" | "observer";',
    );

    if (!text.includes("trajectoryObserver: TrajectoryObserverSnapshot;")) {
      text = replaceRequired(
        text,
        "  dailyAutopsy: string[];\n  generatedAt: string;",
        `  dailyAutopsy: string[];
  trajectoryObserver: TrajectoryObserverSnapshot;
  generatedAt: string;`,
        "research snapshot observer field",
      );
    }

    if (!text.includes("trajectoryScore: number;")) {
      text = replaceRequired(
        text,
        "  typicalRunnerDrawdownPct: number;\n};",
        `  typicalRunnerDrawdownPct: number;
  trajectoryScore: number;
  trajectoryDumperRiskScore: number;
  trajectoryConfidence: number;
  trajectoryPhase: "INSUFFICIENT" | "IGNITION" | "ACCELERATION" | "PULLBACK" | "RECOVERY" | "DISTRIBUTION" | "STALLED";
  trajectorySampleSize: number;
  trajectoryChainSampleSize: number;
  trajectoryEvidence: string[];
};`,
        "runner-research RunnerGenome trajectory fields",
      );
    }

    const oldOutcome = `  if (priorOutcome !== row.outcome && row.outcome !== "open") {
    row.botNotes = [...row.botNotes, ...outcomeResearchNotes(row)].slice(-MAX_BOT_NOTES_PER_CASE);
  }`;
    if (!text.includes("Feedback distributed privately to all 8 Council entities")) {
      text = replaceRequired(
        text,
        oldOutcome,
        `  if (priorOutcome !== row.outcome && row.outcome !== "open") {
    row.botNotes = [...row.botNotes, ...outcomeResearchNotes(row)].slice(-MAX_BOT_NOTES_PER_CASE);
    const trajectoryNotes = await distributeTrajectoryOutcomeLesson(row);
    if (trajectoryNotes.length) {
      row.botNotes = [
        ...row.botNotes,
        ...trajectoryNotes.map((message) => ({ at: now, agentId: "observer" as const, message })),
      ].slice(-MAX_BOT_NOTES_PER_CASE);
    }
  }`,
        "outcome distributes trajectory lessons",
      );
    }

    if (!text.includes("const currentTrajectoryCase = await readCase")) {
      const modelAnchor = "  const model = await genomeModel();\n  const features = snapshotFeatures(snapshot);";
      text = replaceRequired(
        text,
        modelAnchor,
        `  const model = await genomeModel();
  const currentTrajectoryCase = await readCase(caseId(snapshot));
  const trajectory = getTrajectoryGuidance({
    chain: snapshot.chain,
    currentObservations: currentTrajectoryCase?.observations?.length
      ? [...currentTrajectoryCase.observations, snapshotToTrajectoryObservation(snapshot)]
      : [snapshotToTrajectoryObservation(snapshot)],
    trainingCases: model.rows.map((item) => item.row),
  });
  const features = snapshotFeatures(snapshot);`,
        "current trajectory guidance",
      );
    }

    const baseEntryLine = "  const entryScore = clampScore(heuristic * (1 - learnedWeight) + learnedRunnerPct * learnedWeight);";
    if (!text.includes("const trajectoryWeight = trajectory.observationsUsed >= 2")) {
      text = replaceRequired(
        text,
        baseEntryLine,
        `  const staticEntryScore = clampScore(heuristic * (1 - learnedWeight) + learnedRunnerPct * learnedWeight);
  const trajectoryWeight = trajectory.observationsUsed >= 2
    ? Math.min(0.32, trajectory.confidence / 100 * 0.32)
    : 0;
  const entryScore = clampScore(staticEntryScore * (1 - trajectoryWeight) + trajectory.score * trajectoryWeight);`,
        "trajectory blends into entry score",
      );
    }

    const oldDumper = "  const dumperRiskScore = clampScore((100 - entryScore) * 0.72 + safetyDumperPenalty + flowDumperPenalty);";
    if (!text.includes("const staticDumperRiskScore")) {
      text = replaceRequired(
        text,
        oldDumper,
        `  const staticDumperRiskScore = clampScore((100 - entryScore) * 0.72 + safetyDumperPenalty + flowDumperPenalty);
  const dumperRiskScore = trajectoryWeight > 0
    ? clampScore(staticDumperRiskScore * (1 - trajectoryWeight * 0.85) + trajectory.dumperRiskScore * (trajectoryWeight * 0.85))
    : staticDumperRiskScore;`,
        "trajectory blends into dumper risk",
      );
    }

    const confidenceLine = "  const confidence = clampScore(30 + Math.min(45, model.rows.length * 0.45) + evidenceCount * 4);";
    if (!text.includes("trajectory.confidence * 0.18")) {
      text = replaceRequired(
        text,
        confidenceLine,
        "  const confidence = clampScore(30 + Math.min(45, model.rows.length * 0.45) + evidenceCount * 4 + trajectory.confidence * 0.18);",
        "trajectory confidence contributes",
      );
    }

    if (!text.includes("Trajectory Observer ${trajectory.phase}")) {
      const runnerEvidenceEnd = `    neighborWeight > 0 ? \`${"${nearest.filter((x) => x.row.outcome === \"runner\").length}/${nearest.length} nearest labeled cases are runners after distance weighting."}\` : \`No mature labeled-neighbor set yet; heuristic evidence carries the score.\`,
  ];`;
      if (!text.includes(runnerEvidenceEnd)) fail("Could not find runnerEvidence end");
      text = text.replace(
        runnerEvidenceEnd,
        `    neighborWeight > 0 ? \`${"${nearest.filter((x) => x.row.outcome === \"runner\").length}/${nearest.length} nearest labeled cases are runners after distance weighting."}\` : \`No mature labeled-neighbor set yet; heuristic evidence carries the score.\`,
    \`Trajectory Observer ${"${trajectory.phase}"} · sequence score ${"${trajectory.score.toFixed(0)}"}/100 · ${"${trajectory.observationsUsed}"} observations · confidence ${"${trajectory.confidence.toFixed(0)}"}%.\`,
    ...trajectory.evidence.slice(0, 2),
  ];`,
      );
    }

    if (!text.includes("trajectoryScore: trajectory.score,")) {
      const returnAnchor = "    typicalRunnerDrawdownPct: Number(typicalRunnerDrawdownPct.toFixed(1)),\n  };";
      text = replaceRequired(
        text,
        returnAnchor,
        `    typicalRunnerDrawdownPct: Number(typicalRunnerDrawdownPct.toFixed(1)),
    trajectoryScore: trajectory.score,
    trajectoryDumperRiskScore: trajectory.dumperRiskScore,
    trajectoryConfidence: trajectory.confidence,
    trajectoryPhase: trajectory.phase,
    trajectorySampleSize: trajectory.sampleSize,
    trajectoryChainSampleSize: trajectory.chainSampleSize,
    trajectoryEvidence: trajectory.evidence,
  };`,
        "return trajectory guidance",
      );
    }

    if (!text.includes("const trajectoryObserver = getTrajectoryObserverSnapshot(cases);")) {
      const snapshotAnchor = "  const medianRunnerDrawdownPct = Math.abs(median(runnerRowsForProfile.map((row) => row.maxDrawdownPct), 0));";
      text = replaceRequired(
        text,
        snapshotAnchor,
        `${snapshotAnchor}
  const trajectoryObserver = getTrajectoryObserverSnapshot(cases);`,
        "observer snapshot metrics",
      );
    }

    if (!text.includes("    trajectoryObserver,")) {
      const returnSnapshotAnchor = "    dailyAutopsy: dailyAutopsy(cases),\n    generatedAt: new Date().toISOString(),";
      text = replaceRequired(
        text,
        returnSnapshotAnchor,
        `    dailyAutopsy: dailyAutopsy(cases),
    trajectoryObserver,
    generatedAt: new Date().toISOString(),`,
        "return observer snapshot",
      );
    }

    text = text.replace(
      'mission: "Observe → study → hypothesize → paper trade → autopsy → file knowledge → validate → trade proven runner patterns.",',
      'mission: "Observe the movie, not just the screenshot → study trajectories → paper trade → autopsy → feed lessons back to each specialist → validate runner patterns.",',
    );

    return text;
  });

  patchFile(root, "lib/agent-entity-runtime.ts", (input) => {
    let text = input;

    text = text.replace(
      '  kind: "decision" | "outcome";',
      '  kind: "decision" | "outcome" | "trajectory";',
    );
    if (!text.includes("trajectoryPhase?: string;")) {
      text = replaceRequired(
        text,
        "  realizedPnlUsd?: number;\n  lesson: string;",
        `  realizedPnlUsd?: number;
  trajectoryPhase?: string;
  trajectoryScore?: number;
  trajectoryDumperRiskScore?: number;
  trajectoryOutcome?: "runner" | "dumper";
  chain?: string;
  lesson: string;`,
        "local entity structured trajectory memory",
      );
    }

    text = text.replace(
      `    realizedReturnPct: row.realizedReturnPct,
    realizedPnlUsd: row.realizedPnlUsd,
    lesson: row.lesson,`,
      `    chain: row.chain,
    realizedReturnPct: row.realizedReturnPct,
    realizedPnlUsd: row.realizedPnlUsd,
    trajectoryPhase: row.trajectoryPhase,
    trajectoryScore: row.trajectoryScore,
    trajectoryDumperRiskScore: row.trajectoryDumperRiskScore,
    trajectoryOutcome: row.trajectoryOutcome,
    lesson: row.lesson,`,
    );

    if (!text.includes("function trajectoryMemoryCalibration(")) {
      const memoryFnAnchor = `function baseEvidence(packet: Packet) {`;
      const trajectoryMemoryFn = `function trajectoryMemoryCalibration(memory: EntityMemoryLite[], phase: string, chain: string) {
  let bias = 0;
  let matched = 0;
  for (const row of memory) {
    if (row.kind !== "trajectory" || row.trajectoryPhase !== phase || !row.trajectoryOutcome) continue;
    matched += 1;
    const chainWeight = row.chain === chain ? 1 : 0.55;
    bias += (row.trajectoryOutcome === "runner" ? 2.4 : -2.4) * chainWeight;
  }
  if (!matched) return 0;
  return Math.max(-8, Math.min(8, bias));
}

`;
      if (!text.includes(memoryFnAnchor)) fail("Could not find baseEvidence for trajectory memory function");
      text = text.replace(memoryFnAnchor, trajectoryMemoryFn + memoryFnAnchor);
    }

    if (!text.includes("trajectoryScore: g.trajectoryScore")) {
      text = replaceRequired(
        text,
        "      typicalRunnerDrawdownPct: g.typicalRunnerDrawdownPct,\n      runnerEvidence: g.runnerEvidence,",
        `      typicalRunnerDrawdownPct: g.typicalRunnerDrawdownPct,
      trajectoryScore: g.trajectoryScore,
      trajectoryDumperRiskScore: g.trajectoryDumperRiskScore,
      trajectoryConfidence: g.trajectoryConfidence,
      trajectoryPhase: g.trajectoryPhase,
      trajectorySampleSize: g.trajectorySampleSize,
      trajectoryChainSampleSize: g.trajectoryChainSampleSize,
      trajectoryEvidence: g.trajectoryEvidence,
      runnerEvidence: g.runnerEvidence,`,
        "Council packet trajectory fields",
      );
    }

    if (!text.includes("Trajectory Observer ${packet.runnerGenome.trajectoryPhase}")) {
      text = replaceRequired(
        text,
        "    `Runner Genome ${packet.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${packet.runnerGenome.dumperRiskScore.toFixed(0)}/100.`,",
        `    \`Runner Genome ${"${packet.runnerGenome.entryScore.toFixed(0)}"}/100 vs dumper risk ${"${packet.runnerGenome.dumperRiskScore.toFixed(0)}"}/100.\`,
    \`Trajectory Observer ${"${packet.runnerGenome.trajectoryPhase}"}: ${"${packet.runnerGenome.trajectoryScore.toFixed(0)}"}/100 vs trajectory dumper risk ${"${packet.runnerGenome.trajectoryDumperRiskScore.toFixed(0)}"}/100 (${"${packet.runnerGenome.trajectoryConfidence.toFixed(0)}"}% confidence).\`,`,
        "base evidence trajectory line",
      );
    }

    text = text.replace(
      `  const t = packet.token;
  const g = packet.runnerGenome;
  let score = 50;`,
      `  const t = packet.token;
  const g = packet.runnerGenome;
  const trajectoryMemoryBias = trajectoryMemoryCalibration(memory, g.trajectoryPhase, t.chain);
  let score = 50;`,
    );

    // Specialty-specific use of observer data. Observer still has no vote.
    text = text.replace(
      "      Math.max(-8, Math.min(12, (t.buySellRatio - 1) * 10)) +\n      calibration",
      "      Math.max(-8, Math.min(12, (t.buySellRatio - 1) * 10)) +\n      (g.trajectoryScore - 50) * 0.20 +\n      calibration + trajectoryMemoryBias",
    );
    text = text.replace(
      "      Math.max(-6, Math.min(8, (t.smartMoneyBuys - t.smartMoneySells) * 3)) +\n      calibration",
      "      Math.max(-6, Math.min(8, (t.smartMoneyBuys - t.smartMoneySells) * 3)) +\n      (g.trajectoryScore - 50) * 0.12 +\n      calibration + trajectoryMemoryBias",
    );
    text = text.replace(
      "      Math.max(-5, Math.min(8, liqMc * 12)) +\n      calibration",
      "      Math.max(-5, Math.min(8, liqMc * 12)) +\n      (g.trajectoryScore - 50) * 0.28 +\n      calibration + trajectoryMemoryBias",
    );
    text = text.replace(
      "    const dumperPressure = clamp(g.dumperRiskScore * 0.55 + distribution + concentration + fade + safety - calibration);",
      "    const dumperPressure = clamp(g.dumperRiskScore * 0.46 + g.trajectoryDumperRiskScore * 0.18 + distribution + concentration + fade + safety - calibration - trajectoryMemoryBias);",
    );
    text = text.replace(
      "      (g.earlyRunnerZone ? 6 : 0) +\n      calibration",
      "      (g.earlyRunnerZone ? 6 : 0) +\n      (g.trajectoryScore - 50) * 0.16 -\n      Math.max(0, g.trajectoryDumperRiskScore - 60) * 0.08 +\n      calibration + trajectoryMemoryBias",
    );

    text = text.replace(
      "  const genomeBoost = (packet.runnerGenome.entryScore - packet.runnerGenome.dumperRiskScore * 0.35) / 100;",
      "  const genomeBoost = (packet.runnerGenome.entryScore * 0.72 + packet.runnerGenome.trajectoryScore * 0.28 - packet.runnerGenome.dumperRiskScore * 0.25 - packet.runnerGenome.trajectoryDumperRiskScore * 0.10) / 100;",
    );

    if (!text.includes("Trajectory Observer is background research only")) {
      text = text.replace(
        '      "No OpenAI/ChatGPT API call is used anywhere in this Council runtime.",',
        '      "No OpenAI/ChatGPT API call is used anywhere in this Council runtime.",\n      "Trajectory Observer is background research only: it supplies sequence evidence and private lessons but has no Council vote.",',
      );
    }

    return text;
  });

  patchFile(root, "components/RunnerResearchPanel.tsx", (input) => {
    let text = input;

    if (!text.includes("trajectoryObserver?:")) {
      text = replaceRequired(
        text,
        "  dailyAutopsy: string[];\n  generatedAt: string;",
        `  dailyAutopsy: string[];
  trajectoryObserver?: {
    sequencesTracked: number;
    labeledSequences: number;
    runnerSequences: number;
    dumperSequences: number;
    chainModels: number;
    latestLessons: Array<{ symbol: string; chain: string; outcome: string; message: string }>;
  };
  generatedAt: string;`,
        "RunnerResearchPanel observer payload type",
      );
    }

    if (!text.includes("TRAJECTORY OBSERVER · BACKGROUND ONLY · NO VOTE")) {
      const anchor = `      <article className="v225-genome-engines">`;
      const block = `      <article className="v229-trajectory-observer">
        <div className="v229-observer-head">
          <div><span>TRAJECTORY OBSERVER · BACKGROUND ONLY · NO VOTE</span><h3>Study how runners develop — then teach the trading bots.</h3><p>The Observer never buys, sells, votes or vetoes. It follows BUY/WATCH/SKIP coins over time, learns runner/dumper sequences, and sends specialty-specific lessons back into each entity&apos;s private memory.</p></div>
          <strong>{r?.trajectoryObserver?.sequencesTracked ?? 0}<small>sequences</small></strong>
        </div>
        <div className="v229-observer-stats">
          <div><small>Tracked</small><b>{r?.trajectoryObserver?.sequencesTracked ?? 0}</b></div>
          <div><small>Labeled</small><b>{r?.trajectoryObserver?.labeledSequences ?? 0}</b></div>
          <div><small>Runner paths</small><b>{r?.trajectoryObserver?.runnerSequences ?? 0}</b></div>
          <div><small>Dumper paths</small><b>{r?.trajectoryObserver?.dumperSequences ?? 0}</b></div>
          <div><small>Chain models</small><b>{r?.trajectoryObserver?.chainModels ?? 0}</b></div>
          <div><small>Review cadence</small><b>~30s</b></div>
        </div>
        <div className="v229-observer-lessons">
          <b>LATEST TRAJECTORY LESSONS</b>
          {(r?.trajectoryObserver?.latestLessons ?? []).length ? (r?.trajectoryObserver?.latestLessons ?? []).map((row, index) => <div key={row.chain + "-" + row.symbol + "-" + index}><strong>{"$" + row.symbol}</strong><em>{row.outcome}</em><span>{row.message}</span></div>) : <p>Collecting multi-snapshot sequences now. The Observer waits for real development data before claiming a pattern.</p>}
        </div>
      </article>

${anchor}`;
      text = replaceRequired(text, anchor, block, "Trajectory Observer research panel");
    }

    return text;
  });

  patchFile(root, "app/v214.css", (input) => {
    let text = input;
    if (!text.includes(".v229-trajectory-observer{")) {
      text += `
/* V2.29 — Trajectory Observer (background-only learning worker) */
.v229-trajectory-observer{margin:16px 0 20px;border:1px solid #dfe3e7;border-radius:22px;background:#fff;overflow:hidden}
.v229-observer-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:19px 21px;border-bottom:1px solid #eceff2}
.v229-observer-head span{font-size:8px;font-weight:850;letter-spacing:.1em;color:#637083}
.v229-observer-head h3{margin:5px 0;font-size:19px;color:#111}
.v229-observer-head p{margin:0;max-width:790px;font-size:10px;line-height:1.55;color:#757d87}
.v229-observer-head>strong{min-width:82px;text-align:center;font-size:24px;color:#111}.v229-observer-head>strong small{display:block;font-size:8px;font-weight:600;color:#9399a1}
.v229-observer-stats{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid #eceff2}
.v229-observer-stats>div{padding:12px 14px;border-right:1px solid #eceff2}.v229-observer-stats>div:last-child{border-right:0}
.v229-observer-stats small{display:block;font-size:8px;color:#969ca5;text-transform:uppercase;letter-spacing:.05em}.v229-observer-stats b{display:block;margin-top:4px;font-size:15px;color:#111}
.v229-observer-lessons{padding:14px 20px 18px}.v229-observer-lessons>b{font-size:8px;letter-spacing:.08em;color:#858c95}
.v229-observer-lessons>div{display:grid;grid-template-columns:90px 70px 1fr;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid #f0f1f3;font-size:9px}.v229-observer-lessons>div:last-child{border-bottom:0}
.v229-observer-lessons strong{color:#111}.v229-observer-lessons em{font-style:normal;text-transform:uppercase;color:#69717a}.v229-observer-lessons span{color:#5c646e;line-height:1.45}.v229-observer-lessons p{font-size:10px;color:#8a9098}
@media(max-width:800px){.v229-observer-stats{grid-template-columns:repeat(3,1fr)}.v229-observer-lessons>div{grid-template-columns:75px 55px 1fr}.v229-observer-head{padding:16px}}
`;
    }
    return text;
  });

  console.log("[v2.29-trajectory-observer] Background Trajectory Observer active: watches sequence development, feeds learned evidence to specialists, and has no Council vote.");
}
