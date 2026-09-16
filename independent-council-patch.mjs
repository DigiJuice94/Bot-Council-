import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.26-independent-council] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.26-independent-council] patched ${rel}`);
}
function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyIndependentCouncilPatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      'export type AgentId =\n  | "launch"\n  | "social"\n  | "wallet"\n  | "quant"\n  | "contract"\n  | "bear"\n  | "cio"\n  | "executor";',
      'export type AgentId =\n  | "launch"\n  | "social"\n  | "wallet"\n  | "quant"\n  | "contract"\n  | "bear"\n  | "portfolio"\n  | "cio"\n  | "executor";',
      "portfolio AgentId"
    );

    text = replaceRequired(
      text,
      'export type ResearchAgentId = Exclude<AgentId, "cio" | "executor">;',
      'export type ResearchAgentId = Exclude<AgentId, "cio" | "executor" | "portfolio">;',
      "research weight IDs stay six specialists"
    );

    text = replaceRequired(
      text,
      'export type AgentOpinion = {',
      `export type CouncilEntityId = "launch" | "social" | "wallet" | "quant" | "contract" | "bear" | "portfolio" | "cio";

export type IndependentEntityOpinion = {
  agentId: CouncilEntityId;
  agentName: string;
  phase: "private" | "meeting" | "cio";
  vote: "BUY" | "WATCH" | "SKIP";
  confidence: number;
  score: number;
  thesis: string;
  evidence: string[];
  risks: string[];
  suggestedTradeUsd?: number;
  changedVote?: boolean;
  rebuttal?: string;
  source: "openai" | "local-engine" | "local-fallback";
  responseId?: string;
  formedAt: string;
};

export type IndependentCouncilTrace = {
  sessionId: string;
  mode: "independent-ai" | "independent-local" | "isolated-local-fallback";
  agentModel: string;
  cioModel: string;
  privateRoundStartedAt: string;
  meetingRoundStartedAt: string;
  completedAt: string;
  initialOpinions: IndependentEntityOpinion[];
  meetingOpinions: IndependentEntityOpinion[];
  cioOpinion: IndependentEntityOpinion;
};

export type AgentOpinion = {`,
      "independent entity types"
    );

    text = replaceRequired(
      text,
      '  runnerGenome?: RunnerGenomeGuidance;\n  riskMaxPositionPct?: number;',
      '  runnerGenome?: RunnerGenomeGuidance;\n  independentCouncil?: IndependentCouncilTrace;\n  riskMaxPositionPct?: number;',
      "position entry independent council"
    );

    text = replaceRequired(
      text,
      '  runnerGenome: RunnerGenomeGuidance;\n  councilProcess: CouncilProcess;',
      '  runnerGenome: RunnerGenomeGuidance;\n  independentCouncil?: IndependentCouncilTrace;\n  councilProcess: CouncilProcess;',
      "WarRoomResult independent council"
    );

    return text;
  });

  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;
    text = text.replace('import { runWarRoom } from "./engine";', 'import { runIndependentCouncil } from "./agent-entity-runtime";');

    text = replaceRequired(
      text,
      '  const result = runWarRoom(snapshot, {',
      '  const result = await runIndependentCouncil(snapshot, {',
      "autopilot uses independent council"
    );

    text = replaceRequired(
      text,
      '  context.runnerGenome = result.runnerGenome;\n  context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;',
      '  context.runnerGenome = result.runnerGenome;\n  context.independentCouncil = result.independentCouncil;\n  context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;',
      "persist independent council with position"
    );

    text = text.replaceAll("V2.25 Early Runner Core started.", "V2.26 Independent Entity Council started.");
    return text;
  });

  patchFile(root, "lib/debate.ts", (input) => {
    let text = input;

    text = replaceRequired(
      text,
      'export function buildCouncilDiscussion(result: WarRoomResult): CouncilTurn[] {\n  const byId = new Map(result.agents.map((agent) => [agent.id, agent]));',
      `export function buildCouncilDiscussion(result: WarRoomResult): CouncilTurn[] {
  if (result.independentCouncil) {
    const trace = result.independentCouncil;
    const opening: CouncilTurn[] = trace.initialOpinions.map((opinion, index) => ({
      id: \`private-\${index}-\${opinion.agentId}\`,
      agentId: opinion.agentId,
      round: "opening",
      message: \`PRIVATE READ LOCKED · \${opinion.vote} · \${opinion.confidence}% confidence. \${opinion.thesis}\${opinion.evidence.length ? \` Evidence: \${opinion.evidence.slice(0, 2).join(" · ")}\` : ""}\`,
    }));
    const meeting: CouncilTurn[] = trace.meetingOpinions.map((opinion, index) => ({
      id: \`meeting-\${index}-\${opinion.agentId}\`,
      agentId: opinion.agentId,
      round: "rebuttal",
      message: \`\${opinion.changedVote ? "VOTE CHANGED" : "VOTE HELD"} · \${opinion.vote} · \${opinion.confidence}%. \${opinion.rebuttal ?? opinion.thesis}\`,
    }));
    return [
      ...opening,
      ...meeting,
      {
        id: "independent-cio",
        agentId: "cio",
        round: "decision",
        message: \`I received seven locked private reads and their meeting responses; I did not generate them. My synthesis is \${trace.cioOpinion.vote} at \${trace.cioOpinion.confidence}% confidence. \${trace.cioOpinion.thesis}\`,
      },
      {
        id: "deterministic-executor",
        agentId: "executor",
        round: "execution",
        respondsTo: "cio",
        message: \`Deterministic Executor is outside the eight-entity Council. It only applies route/accounting/hard-safety rules after the CIO decision. Feasibility: \${result.councilProcess.executorVote}.\`,
      },
    ];
  }

  const byId = new Map(result.agents.map((agent) => [agent.id, agent]));`,
      "independent discussion path"
    );

    return text;
  });

  console.log("[v2.26-independent-council] Seven specialist entities now form isolated private opinions, reveal/debate, then a separate Runner CIO synthesizes. Executor is outside the Council.");
}
