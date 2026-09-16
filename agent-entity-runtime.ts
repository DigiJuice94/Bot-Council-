import { buildExecutionPlan } from "./execution";
import { runWarRoom } from "./engine";
import { appendPrivateEntityMemory, loadPrivateEntityMemory, recordEntityDecision } from "./agent-entity-store";
import type {
  AgentOpinion,
  CouncilEntityId,
  IndependentCouncilTrace,
  IndependentEntityOpinion,
  MarketRegime,
  MarketSnapshot,
  PortfolioRiskContext,
  ProfitabilityMetrics,
  ResearchAgentId,
  ResearchAgentWeights,
  RunnerGenomeGuidance,
  WarRoomResult,
} from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const now = () => new Date().toISOString();

type CouncilOptions = {
  mode?: "paper" | "live";
  portfolio?: PortfolioRiskContext;
  agentWeights?: Partial<ResearchAgentWeights>;
  memoryHints?: Partial<Record<ResearchAgentId, string[]>>;
  regime?: MarketRegime;
  learningSource?: "defaults" | "regime" | "learned";
  profitability?: ProfitabilityMetrics | null;
  runnerGenome?: RunnerGenomeGuidance;
};

type EntitySpec = {
  id: Exclude<CouncilEntityId, "cio">;
  name: string;
  shortName: string;
  color: string;
  mission: string;
};

const ENTITY_SPECS: EntitySpec[] = [
  {
    id: "launch", name: "Early Runner Scout", shortName: "ERS", color: "#ffb13b",
    mission: "Find the first credible stage of a fresh runner. Prioritize $10K-$50K market-cap behavior, launch age, market-cap velocity, buy pressure, transaction/volume acceleration and resemblance to previous early runners. Do not demand mature-token conditions.",
  },
  {
    id: "social", name: "Narrative Ignition Scout", shortName: "NIS", color: "#b05cff",
    mission: "Judge whether attention/narrative is igniting before the price move. Treat missing social data as unknown rather than zero. Separate genuine early ignition from attention that arrived only after the pump.",
  },
  {
    id: "wallet", name: "Early Flow Analyst", shortName: "EFA", color: "#29e693",
    mission: "Judge early buyer/holder behavior: buy-to-sell pressure, holder velocity, repeat accumulation, smart-money evidence when actually verified, concentration changes and signs of distribution.",
  },
  {
    id: "quant", name: "Runner Pattern Quant", shortName: "RPQ", color: "#28c9ff",
    mission: "Quantify runner probability from market-cap velocity, volume/MC, liquidity/MC, transaction acceleration, volume acceleration, volatility and Runner Genome similarity. Focus on asymmetry in the first minutes/hours.",
  },
  {
    id: "contract", name: "Fast Safety Gate", shortName: "FSG", color: "#ffd34f",
    mission: "Independently inspect explicit sellability/scam/authority/concentration evidence. Do not reject merely because a legitimate fresh pool is small. Distinguish verified bad evidence from unavailable evidence.",
  },
  {
    id: "bear", name: "Dumper Pattern Specialist", shortName: "DPS", color: "#ff5f6d",
    mission: "Act as a specialist in failed launches. Compare this candidate with dumpers: fake pressure, bundle/concentration risk, distribution, slowing acceleration, one-wallet dependence, liquidity deterioration and late-entry structure.",
  },
  {
    id: "portfolio", name: "Portfolio Strategist", shortName: "PS", color: "#70a8ff",
    mission: "Independently decide whether the opportunity deserves a starter, how large the PAPER entry should be, and whether capital should remain available for other fresh runners. $50 is the minimum training entry, not a fixed size. Prefer $50-$150 based on evidence strength.",
  },
];

const CIO_SPEC = {
  id: "cio" as const,
  name: "Runner CIO",
  shortName: "CIO",
  color: "#111111",
  mission: "Synthesize the seven locked specialist opinions after they have worked independently and after their meeting rebuttals. Optimize for learning to identify genuine early runners while respecting deterministic hard safety gates. Do not invent a ninth opinion.",
};

function apiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}
function entityMode() {
  return (process.env.COUNCIL_ENTITY_MODE ?? "independent-ai").trim().toLowerCase();
}
function allowDegraded() {
  return process.env.COUNCIL_ALLOW_DEGRADED_FALLBACK === "true";
}
function agentModel() {
  return process.env.COUNCIL_AGENT_MODEL?.trim() || "gpt-5.6-luna";
}
function cioModel() {
  return process.env.COUNCIL_CIO_MODEL?.trim() || "gpt-5.6-terra";
}
function timeoutMs() {
  const n = Number(process.env.COUNCIL_AGENT_TIMEOUT_MS ?? 18_000);
  return Math.max(4_000, Math.min(60_000, Number.isFinite(n) ? n : 18_000));
}

function compactPacket(snapshot: MarketSnapshot, base: WarRoomResult, portfolio: PortfolioRiskContext) {
  const g = base.runnerGenome;
  return {
    token: {
      symbol: snapshot.symbol,
      chain: snapshot.chain,
      address: snapshot.tokenAddress,
      venue: snapshot.venue,
      marketCap: snapshot.marketCap,
      liquidity: snapshot.liquidity,
      ageMinutes: snapshot.ageMinutes,
      price: snapshot.price,
      priceChange24hPct: snapshot.priceChange24h,
      marketCapChange5mPct: snapshot.marketCapChange5mPct ?? null,
      buySellRatio: snapshot.buySellRatio,
      volume5mUsd: snapshot.volume5m,
      volume24hUsd: snapshot.volume24h,
      volumeAccelerationPct: snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? null,
      holders: snapshot.holders,
      holderGrowthPct: snapshot.holderGrowthPct ?? null,
      holdersPerMinute: snapshot.launchMetrics?.holdersPerMinute ?? null,
      transactionsPerMinute: snapshot.launchMetrics?.transactionsPerMinute ?? null,
      uniqueBuyersPerMinute: snapshot.launchMetrics?.uniqueBuyersPerMinute ?? null,
      smartMoneyBuys: snapshot.smartMoneyBuys,
      smartMoneySells: snapshot.smartMoneySells,
      top10Pct: snapshot.top10Pct,
      bundledPct: snapshot.bundledPct,
      sellable: snapshot.sellable,
      honeypot: snapshot.honeypot,
      mintAuthority: snapshot.mintAuthority,
      freezeAuthority: snapshot.freezeAuthority,
      buyTaxPct: snapshot.buyTaxPct,
      sellTaxPct: snapshot.sellTaxPct,
      liquidityLocked: snapshot.liquidityLocked,
      sourceQuality: snapshot.dataProvenance?.quality ?? null,
    },
    runnerGenome: {
      earlyRunnerZone: g.earlyRunnerZone,
      entryScore: g.entryScore,
      dumperRiskScore: g.dumperRiskScore,
      confidence: g.confidence,
      sampleSize: g.sampleSize,
      runnerNeighbors: g.runnerNeighbors,
      dumperNeighbors: g.dumperNeighbors,
      entryPattern: g.entryPattern,
      suggestedTradeUsd: g.suggestedTradeUsd,
      expectedPeakMultiple: g.expectedPeakMultiple,
      expectedTimeToPeakMinutes: g.expectedTimeToPeakMinutes,
      typicalRunnerDrawdownPct: g.typicalRunnerDrawdownPct,
      runnerEvidence: g.runnerEvidence,
      dumperEvidence: g.dumperEvidence,
    },
    commonAnalytics: {
      regime: base.regime.label,
      memeRegime: base.memeRegime.label,
      alphaScore: base.alpha.score,
      alphaAction: base.alpha.action,
      rewardRiskProxy: base.alpha.rewardRiskProxy,
      hardRiskPassed: base.risk.passed,
      hardBlocks: base.risk.hardBlocks,
      warnings: base.risk.warnings,
      executorFeasibility: base.councilProcess.executorVote,
    },
    paperPortfolio: {
      equityUsd: portfolio.equityUsd,
      cashUsd: portfolio.cashUsd,
      openPositions: portfolio.openPositions,
    },
  };
}

function parseJsonObject(text: string) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Agent response did not contain a JSON object.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function responseText(data: any) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callResponsesApi(args: {
  model: string;
  agentId: CouncilEntityId;
  phase: "private" | "meeting" | "cio";
  system: string;
  payload: unknown;
}) {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        instructions: args.system,
        input: JSON.stringify(args.payload),
        max_output_tokens: args.phase === "cio" ? 900 : 700,
        store: false,
        metadata: {
          application: "bot-war-room",
          agent_id: args.agentId,
          phase: args.phase,
        },
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Responses API ${response.status}: ${data?.error?.message ?? response.statusText}`);
    const text = responseText(data);
    if (!text) throw new Error("Agent returned no text.");
    return { json: parseJsonObject(text), responseId: typeof data?.id === "string" ? data.id : undefined };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVote(value: unknown): "BUY" | "WATCH" | "SKIP" {
  const vote = String(value ?? "WATCH").toUpperCase();
  return vote === "BUY" || vote === "SKIP" ? vote : "WATCH";
}
function strings(value: unknown, max = 5) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}
function boundedTradeUsd(value: unknown, fallback: number) {
  const min = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  const max = Math.max(min, Number(process.env.PAPER_TRAINING_MAX_BUY_USD ?? 150));
  const n = Number(value);
  return Number(Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback)).toFixed(2));
}

function localFallbackOpinion(spec: EntitySpec, packet: ReturnType<typeof compactPacket>, phase: "private" | "meeting"): IndependentEntityOpinion {
  const t = packet.token;
  const g = packet.runnerGenome;
  let score = g.entryScore;
  if (spec.id === "launch") score = clamp(g.entryScore + (t.marketCap >= 10_000 && t.marketCap <= 50_000 ? 8 : 0) + Math.max(0, t.marketCapChange5mPct ?? 0) * 0.35);
  if (spec.id === "social") score = clamp(48 + (t.sourceQuality?.socialVelocity ? 15 : 0));
  if (spec.id === "wallet") score = clamp(50 + (t.buySellRatio - 1) * 18 + Math.max(0, t.holderGrowthPct ?? 0));
  if (spec.id === "quant") score = clamp(g.entryScore * 0.7 + Math.max(0, t.marketCapChange5mPct ?? 0) * 0.7);
  if (spec.id === "contract") score = packet.commonAnalytics.hardRiskPassed ? 78 : 5;
  if (spec.id === "bear") score = clamp(100 - g.dumperRiskScore);
  if (spec.id === "portfolio") score = clamp(g.entryScore - g.dumperRiskScore * 0.2 + 18);

  const vote = !packet.commonAnalytics.hardRiskPassed
    ? "SKIP"
    : score >= 68 ? "BUY" : score >= 46 ? "WATCH" : "SKIP";
  return {
    agentId: spec.id,
    agentName: spec.name,
    phase,
    vote,
    confidence: Math.round(clamp(Math.abs(score - 50) + 50)),
    score: Math.round(clamp(score)),
    thesis: `${spec.name} local isolated fallback used because the external entity call was unavailable.`,
    evidence: [
      `Runner Genome ${g.entryScore.toFixed(0)}/100 vs dumper risk ${g.dumperRiskScore.toFixed(0)}/100.`,
      `MC $${Math.round(t.marketCap).toLocaleString()} · buy/sell ${t.buySellRatio.toFixed(2)}x.`,
    ],
    risks: packet.commonAnalytics.hardBlocks.slice(0, 3),
    suggestedTradeUsd: spec.id === "portfolio" ? boundedTradeUsd(g.suggestedTradeUsd, 50) : undefined,
    changedVote: false,
    source: "local-fallback",
    formedAt: now(),
  };
}

function normalizeOpinion(spec: EntitySpec, raw: any, phase: "private" | "meeting", responseId?: string, priorVote?: "BUY" | "WATCH" | "SKIP"): IndependentEntityOpinion {
  const vote = normalizeVote(raw?.vote);
  const confidence = Math.round(clamp(Number(raw?.confidence ?? 50)));
  const score = Math.round(clamp(Number(raw?.score ?? confidence)));
  return {
    agentId: spec.id,
    agentName: spec.name,
    phase,
    vote,
    confidence,
    score,
    thesis: String(raw?.thesis ?? raw?.summary ?? "No concise thesis returned.").slice(0, 700),
    evidence: strings(raw?.evidence),
    risks: strings(raw?.risks),
    suggestedTradeUsd: spec.id === "portfolio" ? boundedTradeUsd(raw?.suggestedTradeUsd, 50) : undefined,
    changedVote: phase === "meeting" ? Boolean(raw?.changedVote ?? (priorVote && priorVote !== vote)) : undefined,
    rebuttal: phase === "meeting" ? String(raw?.rebuttal ?? "").slice(0, 700) || undefined : undefined,
    source: "openai",
    responseId,
    formedAt: now(),
  };
}

function privateSystem(spec: EntitySpec) {
  return [
    `You are ${spec.name}, one autonomous entity in an eight-entity crypto research council.`,
    `Your permanent mission: ${spec.mission}`,
    "PRIVATE PHASE RULES:",
    "- Work completely alone. You have not seen and must not guess any other entity's opinion.",
    "- Use only the supplied market evidence, Runner Genome data and YOUR private memory.",
    "- The shared analytics engine is evidence, not a boss. Form your own vote.",
    "- The core PAPER research objective is identifying real early runners, especially roughly $10K-$50K market cap, before the large move.",
    "- Losses are acceptable research outcomes; do not become generically cautious merely to avoid losses.",
    "- Do not reveal hidden chain-of-thought. Return only a concise thesis, evidence, risks and vote.",
    'Return ONLY JSON: {"vote":"BUY|WATCH|SKIP","confidence":0-100,"score":0-100,"thesis":"short","evidence":["..."],"risks":["..."],"suggestedTradeUsd":50-150 optional}.',
  ].join("\n");
}

function meetingSystem(spec: EntitySpec) {
  return [
    `You are still ${spec.name}. Your identity and private memory are unchanged.`,
    `Your mission remains: ${spec.mission}`,
    "MEETING PHASE RULES:",
    "- Your private first opinion is LOCKED and supplied to you.",
    "- You may now read the other entities' concise locked opinions.",
    "- Challenge evidence, not personalities. You may keep or change your vote.",
    "- Do not merge into a generic consensus. Preserve your specialty.",
    "- Do not reveal hidden chain-of-thought.",
    'Return ONLY JSON: {"vote":"BUY|WATCH|SKIP","confidence":0-100,"score":0-100,"thesis":"short","evidence":["..."],"risks":["..."],"changedVote":true|false,"rebuttal":"short","suggestedTradeUsd":50-150 optional}.',
  ].join("\n");
}

function cioSystem() {
  return [
    `You are ${CIO_SPEC.name}, the eighth autonomous entity.`,
    `Your mission: ${CIO_SPEC.mission}`,
    "You did NOT create the seven specialist opinions. They were completed in separate entity calls before you received them.",
    "Use the private-round opinions, meeting-round opinions, objective evidence and deterministic hard-risk result.",
    "For PAPER early-runner research, optimize for catching genuine early runners and learning from misses/losses—not for minimizing the number of trades.",
    "A WATCH can still become an active paper-training rep downstream.",
    "Never override a deterministic hard safety veto.",
    "Do not reveal hidden chain-of-thought.",
    'Return ONLY JSON: {"vote":"BUY|WATCH|SKIP","confidence":0-100,"score":0-100,"thesis":"short","evidence":["..."],"risks":["..."],"suggestedTradeUsd":50-150}.',
  ].join("\n");
}

async function runOnePrivate(spec: EntitySpec, packet: ReturnType<typeof compactPacket>, legacyHints: string[]) {
  const privateMemory = await loadPrivateEntityMemory(spec.id, 10);
  const payload = {
    phase: "private",
    evidence: packet,
    privateMemory: privateMemory.map((m) => ({
      kind: m.kind, symbol: m.symbol, vote: m.vote, confidence: m.confidence,
      realizedReturnPct: m.realizedReturnPct, lesson: m.lesson,
    })),
    legacyMemoryHints: legacyHints,
  };

  try {
    const { json, responseId } = await callResponsesApi({
      model: agentModel(), agentId: spec.id, phase: "private", system: privateSystem(spec), payload,
    });
    return normalizeOpinion(spec, json, "private", responseId);
  } catch (error) {
    if (!allowDegraded()) throw error;
    return localFallbackOpinion(spec, packet, "private");
  }
}

async function runOneMeeting(spec: EntitySpec, packet: ReturnType<typeof compactPacket>, own: IndependentEntityOpinion, peers: IndependentEntityOpinion[]) {
  const privateMemory = await loadPrivateEntityMemory(spec.id, 6);
  const payload = {
    phase: "meeting",
    evidence: packet,
    ownLockedPrivateOpinion: own,
    peerLockedOpinions: peers.filter((p) => p.agentId !== spec.id).map((p) => ({
      agentId: p.agentId, agentName: p.agentName, vote: p.vote, confidence: p.confidence,
      thesis: p.thesis, evidence: p.evidence, risks: p.risks, suggestedTradeUsd: p.suggestedTradeUsd,
    })),
    privateMemory: privateMemory.map((m) => ({ kind: m.kind, symbol: m.symbol, lesson: m.lesson })),
  };
  try {
    const { json, responseId } = await callResponsesApi({
      model: agentModel(), agentId: spec.id, phase: "meeting", system: meetingSystem(spec), payload,
    });
    return normalizeOpinion(spec, json, "meeting", responseId, own.vote);
  } catch (error) {
    if (!allowDegraded()) throw error;
    const fallback = localFallbackOpinion(spec, packet, "meeting");
    return { ...fallback, vote: own.vote, confidence: own.confidence, score: own.score, thesis: own.thesis, evidence: own.evidence, risks: own.risks, suggestedTradeUsd: own.suggestedTradeUsd };
  }
}

async function runCio(packet: ReturnType<typeof compactPacket>, initial: IndependentEntityOpinion[], meeting: IndependentEntityOpinion[]) {
  const privateMemory = await loadPrivateEntityMemory("cio", 10);
  const payload = {
    phase: "cio",
    evidence: packet,
    lockedPrivateRound: initial,
    lockedMeetingRound: meeting,
    privateCioMemory: privateMemory.map((m) => ({ kind: m.kind, symbol: m.symbol, lesson: m.lesson })),
  };

  try {
    const { json, responseId } = await callResponsesApi({
      model: cioModel(), agentId: "cio", phase: "cio", system: cioSystem(), payload,
    });
    const vote = normalizeVote(json?.vote);
    return {
      agentId: "cio" as const,
      agentName: CIO_SPEC.name,
      phase: "cio" as const,
      vote,
      confidence: Math.round(clamp(Number(json?.confidence ?? 50))),
      score: Math.round(clamp(Number(json?.score ?? json?.confidence ?? 50))),
      thesis: String(json?.thesis ?? "CIO synthesis complete.").slice(0, 700),
      evidence: strings(json?.evidence),
      risks: strings(json?.risks),
      suggestedTradeUsd: boundedTradeUsd(json?.suggestedTradeUsd, packet.runnerGenome.suggestedTradeUsd),
      source: "openai" as const,
      responseId,
      formedAt: now(),
    };
  } catch (error) {
    if (!allowDegraded()) throw error;
    const buy = meeting.filter((o) => o.vote === "BUY").length;
    const watch = meeting.filter((o) => o.vote === "WATCH").length;
    const skip = meeting.length - buy - watch;
    const vote: "BUY" | "WATCH" | "SKIP" = buy >= 4 ? "BUY" : buy + watch >= 4 ? "WATCH" : "SKIP";
    return {
      agentId: "cio" as const,
      agentName: CIO_SPEC.name,
      phase: "cio" as const,
      vote,
      confidence: Math.round(clamp(55 + Math.abs(buy - skip) * 5)),
      score: Math.round(clamp(packet.runnerGenome.entryScore)),
      thesis: `Local degraded CIO fallback: ${buy} BUY, ${watch} WATCH, ${skip} SKIP after the seven isolated entity reads.`,
      evidence: [`Runner Genome ${packet.runnerGenome.entryScore.toFixed(0)}/100`, `${buy}/7 meeting entities voted BUY.`],
      risks: packet.commonAnalytics.hardBlocks,
      suggestedTradeUsd: boundedTradeUsd(packet.runnerGenome.suggestedTradeUsd, 50),
      source: "local-fallback" as const,
      formedAt: now(),
    };
  }
}

function toAgentOpinion(opinion: IndependentEntityOpinion, color: string, shortName: string): AgentOpinion {
  const stance = opinion.vote === "BUY" ? "bullish" : opinion.vote === "SKIP" ? "bearish" : "neutral";
  return {
    id: opinion.agentId,
    name: opinion.agentName,
    shortName,
    score: opinion.score,
    stance,
    summary: `${opinion.vote}: ${opinion.thesis}`,
    detail: `${opinion.confidence}% independent confidence${opinion.changedVote ? " · changed after meeting" : ""}`,
    evidence: opinion.evidence,
    color,
  };
}

export async function runIndependentCouncil(snapshot: MarketSnapshot, options: CouncilOptions = {}): Promise<WarRoomResult> {
  const mode = options.mode ?? "paper";
  const configuredMode = entityMode();
  if (configuredMode !== "local-fallback" && !apiKey()) {
    throw new Error("Independent Council requires OPENAI_API_KEY in Railway Variables. No single-brain fallback will be silently used.");
  }

  // The legacy engine remains a common analytics/risk calculator only.
  // Its synthetic role opinions are discarded below and never decide this council.
  const base = runWarRoom(snapshot, options);
  const portfolio = options.portfolio!;
  const packet = compactPacket(snapshot, base, portfolio);
  const sessionId = `IC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const privateRoundStartedAt = now();

  const initialOpinions = configuredMode === "local-fallback"
    ? ENTITY_SPECS.map((spec) => localFallbackOpinion(spec, packet, "private"))
    : await Promise.all(ENTITY_SPECS.map((spec) => runOnePrivate(spec, packet, options.memoryHints?.[spec.id as ResearchAgentId] ?? [])));

  const meetingRoundStartedAt = now();
  const meetingOpinions = process.env.COUNCIL_DEBATE_ROUND === "false"
    ? initialOpinions.map((opinion) => ({ ...opinion, phase: "meeting" as const, changedVote: false, rebuttal: "Meeting round disabled by configuration." }))
    : configuredMode === "local-fallback"
      ? initialOpinions.map((opinion) => ({ ...opinion, phase: "meeting" as const, changedVote: false, rebuttal: "Isolated local fallback retained its private vote." }))
      : await Promise.all(ENTITY_SPECS.map((spec) => {
          const own = initialOpinions.find((o) => o.agentId === spec.id)!;
          return runOneMeeting(spec, packet, own, initialOpinions);
        }));

  const cioOpinion = configuredMode === "local-fallback"
    ? await runCio(packet, initialOpinions, meetingOpinions)
    : await runCio(packet, initialOpinions, meetingOpinions);

  const deterministicBlocked = !base.risk.passed || base.councilProcess.executorVote === "BLOCK";
  const finalDecision = deterministicBlocked ? "SKIP" : cioOpinion.vote;
  const suggestedTradeUsd = boundedTradeUsd(
    meetingOpinions.find((o) => o.agentId === "portfolio")?.suggestedTradeUsd ?? cioOpinion.suggestedTradeUsd,
    base.runnerGenome.suggestedTradeUsd,
  );
  const runnerGenome = { ...base.runnerGenome, suggestedTradeUsd };

  const alignedBots = Math.max(1, Math.min(8, meetingOpinions.filter((o) => o.vote === cioOpinion.vote).length + 1));
  const buySupport = meetingOpinions.filter((o) => o.vote === "BUY").length;
  const watchSupport = meetingOpinions.filter((o) => o.vote === "WATCH").length;
  const researchSupport = buySupport + watchSupport;
  const councilProcess = {
    ...base.councilProcess,
    researchSupport,
    requiredResearchSupport: 4,
    cioVote: cioOpinion.vote,
    alignedBots,
    totalBots: 8 as const,
    reasons: [
      `Seven specialist entities completed locked private opinions before seeing peers.`,
      `${buySupport}/7 meeting entities voted BUY · ${watchSupport}/7 WATCH · ${7 - buySupport - watchSupport}/7 SKIP.`,
      `Runner CIO independently synthesized the locked meeting at ${cioOpinion.confidence}% confidence.`,
      `Deterministic Executor is outside the Council and reported ${base.councilProcess.executorVote}.`,
    ],
  };

  const execution = buildExecutionPlan({
    mode,
    snapshot,
    decision: finalDecision,
    conviction: deterministicBlocked ? 0 : cioOpinion.confidence,
    risk: base.risk,
    portfolio,
    experiment: base.experiment,
    decisionId: base.decisionId,
    allocationMultiplier: base.runnerGenome.earlyRunnerZone ? 1 : (base.execution.allocationMultiplier ?? 1),
  });

  const specById = new Map(ENTITY_SPECS.map((spec) => [spec.id, spec]));
  const agents: AgentOpinion[] = meetingOpinions.map((opinion) => {
    const spec = specById.get(opinion.agentId as Exclude<CouncilEntityId, "cio">)!;
    return toAgentOpinion(opinion, spec.color, spec.shortName);
  });
  agents.push(toAgentOpinion(cioOpinion, CIO_SPEC.color, CIO_SPEC.shortName));

  const preMeeting = initialOpinions
    .filter((opinion) => opinion.agentId !== "portfolio")
    .map((opinion) => ({
      agentId: opinion.agentId as ResearchAgentId,
      score: opinion.score,
      stance: opinion.vote === "BUY" ? "bullish" as const : opinion.vote === "SKIP" ? "bearish" as const : "neutral" as const,
      thesis: opinion.thesis,
      evidence: opinion.evidence,
      memoryHints: options.memoryHints?.[opinion.agentId as ResearchAgentId],
      formedAt: opinion.formedAt,
    }));

  const independentCouncil: IndependentCouncilTrace = {
    sessionId,
    mode: configuredMode === "local-fallback" ? "isolated-local-fallback" : "independent-ai",
    agentModel: configuredMode === "local-fallback" ? "local-isolated" : agentModel(),
    cioModel: configuredMode === "local-fallback" ? "local-isolated" : cioModel(),
    privateRoundStartedAt,
    meetingRoundStartedAt,
    completedAt: now(),
    initialOpinions,
    meetingOpinions,
    cioOpinion,
  };

  await recordEntityDecision({
    decisionId: base.decisionId,
    symbol: snapshot.symbol,
    chain: snapshot.chain,
    opinions: [...meetingOpinions, cioOpinion],
  }).catch((error) => console.error("[independent-council] memory write", error));

  const filteredAudit = base.auditTrail.filter((line) =>
    !line.startsWith("PRE-MEETING") &&
    !line.startsWith("COUNCIL ") &&
    !line.startsWith("COUNCIL QUORUM") &&
    !line.startsWith("8-BOT PROCESS") &&
    !line.startsWith("Debate adjustment") &&
    !line.startsWith("CIO FINAL") &&
    !line.startsWith("Executor:")
  );
  const auditTrail = [
    ...filteredAudit,
    `INDEPENDENT COUNCIL · ${independentCouncil.mode} · session ${sessionId}`,
    `PRIVATE ROUND · 7/7 specialist entities locked opinions before peer reveal`,
    ...initialOpinions.map((o) => `PRIVATE ${o.agentName} · ${o.vote} · ${o.confidence}% · ${o.thesis}`),
    `MEETING ROUND · seven entities received locked peer summaries only after private opinions were complete`,
    ...meetingOpinions.map((o) => `MEETING ${o.agentName} · ${o.vote} · ${o.confidence}%${o.changedVote ? " · VOTE CHANGED" : ""} · ${o.rebuttal ?? o.thesis}`),
    `RUNNER CIO · ${cioOpinion.vote} · ${cioOpinion.confidence}% · ${cioOpinion.thesis}`,
    `DETERMINISTIC EXECUTOR · ${base.councilProcess.executorVote}${deterministicBlocked ? " · final safety override to SKIP" : ""}`,
    `CIO FINAL · ${finalDecision} · suggested paper size $${suggestedTradeUsd.toFixed(2)}`,
  ];

  return {
    ...base,
    runnerGenome,
    councilProcess,
    preMeeting,
    agents,
    decision: finalDecision,
    consensus: researchSupport,
    conviction: deterministicBlocked ? 0 : cioOpinion.confidence,
    councilConviction: Math.round(meetingOpinions.reduce((sum, o) => sum + o.confidence, 0) / Math.max(1, meetingOpinions.length)),
    execution,
    independentCouncil,
    auditTrail,
    reasoningCompletedAt: independentCouncil.completedAt,
  };
}
