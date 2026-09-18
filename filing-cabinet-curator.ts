import { loadPrivateEntityMemory } from "./agent-entity-store";
import { getLearningSnapshot } from "./learning-store";
import { getSellabilityLearningSnapshot } from "./sellability-investigator";
import { createClient } from "redis";
import type { RunnerResearchSnapshot } from "./runner-research";
import type {
  CouncilEntityId,
  FilingCabinetBotAudit,
  FilingCabinetPermanentTechnique,
  FilingCabinetReport,
  FilingCabinetTechnique,
  MarketRegime,
  MarketSnapshot,
  ProfitabilityMetrics,
} from "./types";

const NEVER_FORGET_KEY = "bot-war-room:filing-cabinet-curator:v1:never-forget";
const NEVER_FORGET_LIMIT = 50;
const memoryNeverForget = new Map<string, FilingCabinetPermanentTechnique>();
let redisPromise: Promise<any | null> | null = null;

const ENTITY_NAMES: Record<CouncilEntityId, string> = {
  launch: "Early Runner Scout",
  social: "Narrative Ignition Scout",
  wallet: "Early Flow Analyst",
  quant: "Runner Pattern Quant",
  contract: "Fast Safety Gate",
  bear: "Dumper Pattern Specialist",
  sellability: "Sellability Investigator",
  portfolio: "Portfolio Strategist",
  cio: "Runner CIO",
};

const ENTITY_IDS = Object.keys(ENTITY_NAMES) as CouncilEntityId[];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const techniqueId = (source: string, text: string) => `${source}:${clean(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64)}`;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[filing-cabinet-curator] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[filing-cabinet-curator] redis unavailable; using process memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

async function loadNeverForget(): Promise<FilingCabinetPermanentTechnique[]> {
  const redis = await getRedis();
  if (!redis) return [...memoryNeverForget.values()];
  const rows = await redis.hGetAll(NEVER_FORGET_KEY) as Record<string, string>;
  return Object.values(rows).flatMap((raw) => {
    try { return [JSON.parse(raw) as FilingCabinetPermanentTechnique]; } catch { return []; }
  });
}

function qualifiesForNeverForget(row: FilingCabinetTechnique, research: RunnerResearchSnapshot, sellabilityCases: number) {
  if (row.significanceScore < 80) return false;
  if (row.source === "runner-genome" || row.source === "dumper-contrast") return research.labeledCases >= 8;
  if (row.source === "trajectory") return research.trajectoryObserver.labeledSequences >= 8;
  if (row.source === "sellability") return sellabilityCases >= 2;
  if (row.source === "paper-results") return research.paperTrades >= 10;
  return false;
}

async function updateNeverForget(topTechniques: FilingCabinetTechnique[], research: RunnerResearchSnapshot, sellabilityCases: number) {
  const current = await loadNeverForget();
  const byId = new Map(current.map((row) => [row.id, row]));
  const now = new Date().toISOString();
  const evidenceSampleSize = Math.max(research.labeledCases, research.paperTrades, research.trajectoryObserver.labeledSequences, sellabilityCases);
  for (const row of topTechniques.filter((item) => qualifiesForNeverForget(item, research, sellabilityCases))) {
    const existing = byId.get(row.id);
    if (!existing && byId.size >= NEVER_FORGET_LIMIT) continue;
    const next: FilingCabinetPermanentTechnique = {
      ...row,
      firstFiledAt: existing?.firstFiledAt ?? now,
      lastConfirmedAt: now,
      confirmations: existing ? existing.confirmations + (existing.evidenceSampleSize < evidenceSampleSize ? 1 : 0) : 1,
      evidenceSampleSize: Math.max(existing?.evidenceSampleSize ?? 0, evidenceSampleSize),
    };
    byId.set(row.id, next);
  }
  const ranked = [...byId.values()].sort((a, b) => b.significanceScore - a.significanceScore || b.confirmations - a.confirmations || a.firstFiledAt.localeCompare(b.firstFiledAt)).slice(0, NEVER_FORGET_LIMIT).map((row, index) => ({ ...row, rank: index + 1 }));
  const redis = await getRedis();
  if (redis) {
    await Promise.all(ranked.map((row) => redis.hSet(NEVER_FORGET_KEY, row.id, JSON.stringify(row))));
  } else {
    memoryNeverForget.clear();
    ranked.forEach((row) => memoryNeverForget.set(row.id, row));
  }
  return ranked;
}

type CandidateTechnique = Omit<FilingCabinetTechnique, "rank">;

function technique(source: FilingCabinetTechnique["source"], direction: FilingCabinetTechnique["direction"], score: number, title: string, instruction: string, evidence: string): CandidateTechnique {
  return {
    id: techniqueId(source, `${title}-${instruction}`),
    title: clean(title),
    instruction: clean(instruction),
    evidence: clean(evidence),
    significanceScore: Math.round(clamp(score, 0, 100)),
    source,
    direction,
  };
}

function rankTechniques(research: RunnerResearchSnapshot, sellability: Awaited<ReturnType<typeof getSellabilityLearningSnapshot>>, recentLessons: string[]): FilingCabinetTechnique[] {
  const rows: CandidateTechnique[] = [];
  research.topRunnerTells.forEach((tell, index) => rows.push(technique(
    "runner-genome", "positive", 94 - index * 3,
    `Runner tell ${index + 1}`,
    tell,
    `${research.runnerCases} labeled runners versus ${research.dumperCases} labeled dumpers.`,
  )));
  research.topDumpTells.forEach((tell, index) => rows.push(technique(
    "dumper-contrast", "caution", 92 - index * 3,
    `Dumper contrast ${index + 1}`,
    tell,
    `${research.dumperCases} dumper cases and ${research.invalidatedTells} invalidated ideas.`,
  )));
  research.trajectoryObserver.latestLessons.forEach((lesson, index) => rows.push(technique(
    "trajectory", lesson.outcome === "runner" ? "positive" : lesson.outcome === "dumper" ? "caution" : "neutral", 82 - index * 2,
    `${lesson.outcome.toUpperCase()} path on ${lesson.chain}`,
    lesson.message,
    `${research.trajectoryObserver.labeledSequences} labeled sequences from ${research.trajectoryObserver.sequencesTracked} tracked paths.`,
  )));
  if (sellability.casesFiled > 0) rows.push(technique(
    "sellability", "caution", Math.min(96, 78 + sellability.casesFiled * 2),
    "Require credible exit liquidity",
    "Treat learned unsellable fingerprints as negative evidence before entry; never count an unverified paper exit as proceeds.",
    `${sellability.casesFiled} locked-capital cases across ${sellability.chainCoverage} chains; $${sellability.totalLockedLossUsd.toFixed(2)} studied.`,
  ));
  if (research.paperTrades > 0) rows.push(technique(
    "paper-results", research.paperExpectancyPct > 0 ? "positive" : "caution", Math.min(90, 62 + research.paperTrades),
    "Respect observed paper expectancy",
    research.paperExpectancyPct > 0 ? "Give validated setups modest additional consideration, without bypassing token-level gates." : "Demand stronger evidence while observed paper expectancy is non-positive.",
    `${research.paperTrades} paper trades; expectancy ${research.paperExpectancyPct >= 0 ? "+" : ""}${research.paperExpectancyPct.toFixed(2)}%; profit factor ${research.paperProfitFactor.toFixed(2)}.`,
  ));
  recentLessons.slice(0, 6).forEach((lesson, index) => rows.push(technique(
    "agent-memory", /loss|not supported|skip|risk|dump/i.test(lesson) ? "caution" : "neutral", 68 - index,
    "Council outcome feedback",
    lesson,
    "Retained adaptive agent-memory record.",
  )));

  const unique = new Map<string, CandidateTechnique>();
  for (const row of rows) {
    const key = row.instruction.toLowerCase();
    if (!unique.has(key) || unique.get(key)!.significanceScore < row.significanceScore) unique.set(key, row);
  }
  return [...unique.values()]
    .sort((a, b) => b.significanceScore - a.significanceScore || a.title.localeCompare(b.title))
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildAudit(agentId: CouncilEntityId, records: Awaited<ReturnType<typeof loadPrivateEntityMemory>>): FilingCabinetBotAudit {
  const lastWriteAt = records[0]?.createdAt;
  const ageMs = lastWriteAt ? Date.now() - new Date(lastWriteAt).getTime() : Number.POSITIVE_INFINITY;
  const status = !records.length ? "BUILDING" : ageMs > 6 * 60 * 60 * 1000 ? "STALE" : "ACTIVE";
  const decisions = records.filter((row) => row.kind === "decision").length;
  const outcomes = records.filter((row) => row.kind === "outcome").length;
  const trajectories = records.filter((row) => row.kind === "trajectory").length;
  return {
    agentId,
    name: ENTITY_NAMES[agentId],
    status,
    recordsRead: records.length,
    decisions,
    outcomes,
    trajectories,
    lastWriteAt,
    finding: status === "ACTIVE"
      ? `${decisions} decisions, ${outcomes} outcomes and ${trajectories} trajectory lessons are present.`
      : status === "STALE"
        ? "Stored work exists, but this bot has not written a recent record."
        : "No retained private record exists yet; the curator will keep checking.",
  };
}

function advisoryAdjustment(research: RunnerResearchSnapshot, performanceAccuracy: number, performanceRows: number) {
  if (research.paperTrades < 3 && research.labeledCases < 5 && performanceRows < 3) return 0;
  const expectancy = clamp(research.paperExpectancyPct / 8, -1.2, 1.2);
  const profitFactor = clamp((research.paperProfitFactor - 1) * 0.8, -0.8, 0.8);
  const oos = research.labeledCases >= 5 ? clamp((research.oosAccuracyPct - 50) / 30, -0.7, 0.7) : 0;
  const agents = performanceRows >= 3 ? clamp((performanceAccuracy - 50) / 35, -0.5, 0.5) : 0;
  return Number(clamp(expectancy + profitFactor + oos + agents, -3, 3).toFixed(1));
}

export async function getFilingCabinetReport(args: {
  research: RunnerResearchSnapshot;
  regime: MarketRegime;
  snapshot?: MarketSnapshot;
  profitability?: ProfitabilityMetrics | null;
}): Promise<FilingCabinetReport> {
  const [learning, sellability, memoryRows] = await Promise.all([
    getLearningSnapshot(args.regime, args.snapshot),
    getSellabilityLearningSnapshot(),
    Promise.all(ENTITY_IDS.map((id) => loadPrivateEntityMemory(id, 60))),
  ]);
  const botAudit = ENTITY_IDS.map((id, index) => buildAudit(id, memoryRows[index]));
  const botsReporting = botAudit.filter((row) => row.recordsRead > 0).length;
  const recentPrivateLessons = memoryRows.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((row) => `${row.agentId}: ${row.lesson}`);
  const topTechniques = rankTechniques(args.research, sellability, [...recentPrivateLessons, ...learning.recentLessons]);
  const neverForgetTechniques = await updateNeverForget(topTechniques, args.research, sellability.casesFiled);
  const performanceAccuracy = learning.performance.length
    ? learning.performance.reduce((sum, row) => sum + row.directionalAccuracyPct, 0) / learning.performance.length
    : 50;
  const cioAdjustment = advisoryAdjustment(args.research, performanceAccuracy, learning.performance.length);
  const lead = topTechniques.slice(0, 3).map((row) => `#${row.rank} ${row.title}: ${row.instruction}`).join(" | ");
  const evidenceSampleSize = Math.max(args.research.labeledCases, args.research.paperTrades, learning.memories, sellability.casesFiled);
  const direction = cioAdjustment > 0 ? `+${cioAdjustment.toFixed(1)}` : cioAdjustment.toFixed(1);
  const cioBrief = [
    `Filing Cabinet advisory ${direction} points; this is context, not a rule or veto.`,
    `${botsReporting}/9 bots have retained work; ${learning.storage === "redis" ? "persistent Redis storage confirmed" : "process-memory fallback only"}; ${neverForgetTechniques.length}/50 proven techniques are in the Never Forget vault.`,
    lead || "No technique has enough stored evidence to rank yet.",
  ].join(" ");
  return {
    role: "advisory-only",
    storage: learning.storage,
    persistenceVerified: learning.storage === "redis",
    sourcesRead: ["runner/dumper case files", "trajectory sequences", "adaptive performance", "nine private bot memories", "sellability cases", "paper outcomes"],
    recordsRead: args.research.casesStudied + args.research.observations + learning.memories + memoryRows.flat().length + sellability.casesFiled,
    botsReporting,
    totalBots: 9,
    allBotsReporting: botsReporting === 9,
    botAudit,
    topTechniques,
    neverForgetTechniques,
    neverForgetCount: neverForgetTechniques.length,
    neverForgetCapacity: 50,
    cioBrief,
    cioAdjustment,
    evidenceSampleSize,
    generatedAt: new Date().toISOString(),
  };
}
