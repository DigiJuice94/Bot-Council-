import { buildExecutionPlan } from "./execution";
import { runWarRoom } from "./engine";
import { loadPrivateEntityMemory, recordEntityDecision } from "./agent-entity-store";
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

export type IndependentCouncilProfile = {
  teamId: string;
  teamName: string;
  memoryNamespace: string;
  roleBias?: Partial<Record<CouncilEntityId, number>>;
  thresholdDelta?: number;
  fileCabinet?: boolean;
  roleMemoryNamespaces?: Partial<Record<CouncilEntityId, string>>;
};

export type CouncilOptions = {
  mode?: "paper" | "live";
  portfolio?: PortfolioRiskContext;
  agentWeights?: Partial<ResearchAgentWeights>;
  memoryHints?: Partial<Record<ResearchAgentId, string[]>>;
  regime?: MarketRegime;
  learningSource?: "defaults" | "regime" | "learned";
  profitability?: ProfitabilityMetrics | null;
  runnerGenome?: RunnerGenomeGuidance;
  teamProfile?: IndependentCouncilProfile;
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
    mission: "Hunt the earliest credible stage of a real runner, especially $10K-$50K market cap.",
  },
  {
    id: "social", name: "Narrative Ignition Scout", shortName: "NIS", color: "#b05cff",
    mission: "Judge whether narrative and attention are igniting early enough to help a run.",
  },
  {
    id: "wallet", name: "Early Flow Analyst", shortName: "EFA", color: "#29e693",
    mission: "Judge early buyer, holder and wallet flow for accumulation versus distribution.",
  },
  {
    id: "quant", name: "Runner Pattern Quant", shortName: "RPQ", color: "#28c9ff",
    mission: "Measure runner structure, acceleration and similarity to the Runner Genome.",
  },
  {
    id: "contract", name: "Fast Safety Gate", shortName: "FSG", color: "#ffd34f",
    mission: "Judge explicit token-level safety evidence without punishing a token merely for being early.",
  },
  {
    id: "bear", name: "Dumper Pattern Specialist", shortName: "DPS", color: "#ff5f6d",
    mission: "Look for the specific fingerprints that historically preceded failed launches and dumps.",
  },
  {
    id: "portfolio", name: "Portfolio Strategist", shortName: "PS", color: "#70a8ff",
    mission: "Independently decide whether the setup deserves $50, $75, $100, $125 or $150 in PAPER.",
  },
];

const CIO_SPEC = {
  id: "cio" as const,
  name: "Runner CIO",
  shortName: "CIO",
  color: "#111111",
};

type Packet = ReturnType<typeof compactPacket>;

type EntityMemoryLite = {
  kind: "decision" | "outcome" | "trajectory";
  vote?: "BUY" | "WATCH" | "SKIP";
  realizedReturnPct?: number;
  realizedPnlUsd?: number;
  trajectoryPhase?: string;
  trajectoryScore?: number;
  trajectoryDumperRiskScore?: number;
  trajectoryOutcome?: "runner" | "dumper";
  chain?: string;
  lesson: string;
};

function compactPacket(snapshot: MarketSnapshot, base: WarRoomResult, portfolio: PortfolioRiskContext) {
  const g = base.runnerGenome;
  return {
    token: {
      symbol: snapshot.symbol,
      chain: snapshot.chain,
      address: snapshot.tokenAddress,
      marketCap: snapshot.marketCap,
      liquidity: snapshot.liquidity,
      ageMinutes: snapshot.ageMinutes,
      price: snapshot.price,
      priceChange24hPct: snapshot.priceChange24h,
      marketCapChange5mPct: snapshot.marketCapChange5mPct ?? 0,
      buySellRatio: snapshot.buySellRatio,
      volume5mUsd: snapshot.volume5m,
      volume24hUsd: snapshot.volume24h,
      volumeAccelerationPct: snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? 0,
      socialVelocityPct: snapshot.socialVelocityPct ?? 0,
      holders: snapshot.holders,
      holderGrowthPct: snapshot.holderGrowthPct ?? 0,
      holdersPerMinute: snapshot.launchMetrics?.holdersPerMinute ?? 0,
      transactionsPerMinute: snapshot.launchMetrics?.transactionsPerMinute ?? 0,
      uniqueBuyersPerMinute: snapshot.launchMetrics?.uniqueBuyersPerMinute ?? 0,
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
      volatility: snapshot.volatility,
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
      trajectoryScore: g.trajectoryScore,
      trajectoryDumperRiskScore: g.trajectoryDumperRiskScore,
      trajectoryConfidence: g.trajectoryConfidence,
      trajectoryPhase: g.trajectoryPhase,
      trajectorySampleSize: g.trajectorySampleSize,
      trajectoryChainSampleSize: g.trajectoryChainSampleSize,
      trajectoryEvidence: g.trajectoryEvidence,
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

function voteFromScore(score: number, hardRiskPassed: boolean): "BUY" | "WATCH" | "SKIP" {
  if (!hardRiskPassed) return "SKIP";
  if (score >= 64) return "BUY";
  if (score >= 44) return "WATCH";
  return "SKIP";
}

function confidenceFromScore(score: number) {
  return Math.round(clamp(54 + Math.abs(score - 50) * 0.8, 50, 95));
}

function boundedTradeUsd(value: number) {
  const min = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  const max = Math.max(min, Number(process.env.PAPER_TRAINING_MAX_BUY_USD ?? 150));
  return Number(Math.max(min, Math.min(max, value)).toFixed(2));
}

function memoryCalibration(memory: EntityMemoryLite[]) {
  let calibration = 0;
  let observed = 0;
  for (const row of memory) {
    if (row.kind !== "outcome" || typeof row.realizedReturnPct !== "number") continue;
    observed += 1;
    const supported = row.vote === "BUY" || row.vote === "WATCH";
    if (row.realizedReturnPct > 10 && supported) calibration += 2.5;
    else if (row.realizedReturnPct < -10 && supported) calibration -= 2;
    else if (row.realizedReturnPct < -10 && row.vote === "SKIP") calibration += 1.5;
    else if (row.realizedReturnPct > 25 && row.vote === "SKIP") calibration -= 2.5;
  }
  if (!observed) return 0;
  return Math.max(-10, Math.min(10, calibration));
}

function trajectoryMemoryCalibration(memory: EntityMemoryLite[], phase: string, chain: string) {
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

function baseEvidence(packet: Packet) {
  return [
    `Runner Genome ${packet.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${packet.runnerGenome.dumperRiskScore.toFixed(0)}/100.`,
    `Trajectory Observer ${packet.runnerGenome.trajectoryPhase}: ${packet.runnerGenome.trajectoryScore.toFixed(0)}/100 vs trajectory dumper risk ${packet.runnerGenome.trajectoryDumperRiskScore.toFixed(0)}/100 (${packet.runnerGenome.trajectoryConfidence.toFixed(0)}% confidence).`,
    `MC $${Math.round(packet.token.marketCap).toLocaleString()} · liquidity $${Math.round(packet.token.liquidity).toLocaleString()} · age ${Math.round(packet.token.ageMinutes)}m.`,
  ];
}

function roleNamespace(profile: IndependentCouncilProfile | undefined, role: CouncilEntityId) {
  return profile?.roleMemoryNamespaces?.[role] ?? profile?.memoryNamespace ?? "main";
}

function identityCalibration(profile: IndependentCouncilProfile | undefined, role: CouncilEntityId) {
  if (!profile || profile.teamId === "team-1") return 0;
  const source = `${profile.teamId}:${role}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  return ((hash % 11) - 5) * 0.45;
}

function candidateCalibration(profile: IndependentCouncilProfile | undefined, role: CouncilEntityId, packet: Packet) {
  if (!profile || profile.teamId === "team-1") return 0;
  const source = `${profile.teamId}:${role}:${packet.token.chain}:${packet.token.address}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = (hash * 33 + source.charCodeAt(index)) >>> 0;
  return ((hash % 13) - 6) * 0.20;
}

function specialtyCalibration(profile: IndependentCouncilProfile | undefined, role: CouncilEntityId, packet: Packet) {
  const bias = profile?.roleBias?.[role] ?? 0;
  if (!bias) return 0;
  const t = packet.token;
  const g = packet.runnerGenome;
  let signal = 0;
  if (role === "launch") signal = (g.entryScore - 50) / 25 + t.marketCapChange5mPct / 40;
  else if (role === "social") signal = t.sourceQuality?.socialVelocity ? t.socialVelocityPct / 60 : -0.25;
  else if (role === "wallet") signal = (t.buySellRatio - 1) / 1.5 + t.holderGrowthPct / 30;
  else if (role === "quant") signal = (g.entryScore + g.trajectoryScore - 100) / 45;
  else if (role === "contract") signal = packet.commonAnalytics.hardRiskPassed ? (65 - g.dumperRiskScore) / 35 : -1;
  else if (role === "bear") signal = (55 - Math.max(g.dumperRiskScore, g.trajectoryDumperRiskScore)) / 35;
  else if (role === "portfolio") signal = (g.entryScore - g.dumperRiskScore) / 40;
  return Math.max(-bias, Math.min(bias, bias * signal));
}

async function thinkPrivate(spec: EntitySpec, packet: Packet, profile?: IndependentCouncilProfile): Promise<IndependentEntityOpinion> {
  const rawMemory = await loadPrivateEntityMemory(spec.id, 12, roleNamespace(profile, spec.id));
  const memory: EntityMemoryLite[] = rawMemory.map((row) => ({
    kind: row.kind,
    vote: row.vote,
    chain: row.chain,
    realizedReturnPct: row.realizedReturnPct,
    realizedPnlUsd: row.realizedPnlUsd,
    trajectoryPhase: row.trajectoryPhase,
    trajectoryScore: row.trajectoryScore,
    trajectoryDumperRiskScore: row.trajectoryDumperRiskScore,
    trajectoryOutcome: row.trajectoryOutcome,
    lesson: row.lesson,
  }));
  const calibration = memoryCalibration(memory);
  const t = packet.token;
  const g = packet.runnerGenome;
  const trajectoryMemoryBias = trajectoryMemoryCalibration(memory, g.trajectoryPhase, t.chain);
  let score = 50;
  let thesis = "";
  let evidence: string[] = [];
  let risks: string[] = [];
  let suggestedTradeUsd: number | undefined;

  if (spec.id === "launch") {
    const earlyBonus = t.marketCap >= 10_000 && t.marketCap <= 50_000 ? 14 : g.earlyRunnerZone ? 8 : 0;
    score = clamp(
      g.entryScore * 0.48 +
      18 +
      earlyBonus +
      Math.max(-10, Math.min(18, t.marketCapChange5mPct * 0.65)) +
      Math.max(-8, Math.min(12, t.volumeAccelerationPct * 0.08)) +
      Math.max(-8, Math.min(12, (t.buySellRatio - 1) * 10)) +
      (g.trajectoryScore - 50) * 0.20 +
      calibration + trajectoryMemoryBias
    );
    thesis = score >= 64
      ? "This launch is behaving enough like an early runner to deserve a PAPER rep before the move matures."
      : score >= 44
        ? "The launch is interesting but the early acceleration is not yet clean enough for a full BUY vote."
        : "The first-minute structure does not currently resemble the stronger early runners.";
    evidence = [
      ...baseEvidence(packet),
      `5m MC velocity ${t.marketCapChange5mPct.toFixed(1)}% · volume acceleration ${t.volumeAccelerationPct.toFixed(1)}%.`,
    ];
  } else if (spec.id === "social") {
    const hasSocial = Boolean(t.sourceQuality?.socialVelocity);
    score = clamp(
      50 +
      (hasSocial ? Math.max(-14, Math.min(22, t.socialVelocityPct * 0.22)) : 2) +
      (g.earlyRunnerZone ? 3 : 0) +
      calibration
    );
    thesis = hasSocial
      ? (score >= 64 ? "Narrative attention is accelerating early enough to support the runner thesis." : "Narrative is present but not yet a decisive ignition signal.")
      : "Social data is unavailable, so I stay near neutral rather than inventing weakness.";
    evidence = hasSocial
      ? [`Verified social velocity ${t.socialVelocityPct.toFixed(1)}%.`, `Runner Genome ${g.entryScore.toFixed(0)}/100.`]
      : ["No verified social-velocity feed is available; missing data is treated as unknown."];
  } else if (spec.id === "wallet") {
    score = clamp(
      48 +
      Math.max(-18, Math.min(24, (t.buySellRatio - 1) * 18)) +
      Math.max(-8, Math.min(12, t.holderGrowthPct * 0.8)) +
      Math.max(-8, Math.min(12, t.uniqueBuyersPerMinute * 0.9)) +
      Math.max(-6, Math.min(8, (t.smartMoneyBuys - t.smartMoneySells) * 3)) +
      (g.trajectoryScore - 50) * 0.12 +
      calibration + trajectoryMemoryBias
    );
    thesis = score >= 64
      ? "Early flow looks like accumulation rather than immediate distribution."
      : score >= 44
        ? "Flow is mixed; buyers are present but wallet/holder acceleration is not fully convincing."
        : "The early flow resembles weak demand or distribution more than accumulation.";
    evidence = [
      `Buy/sell ${t.buySellRatio.toFixed(2)}x · holder growth ${t.holderGrowthPct.toFixed(1)}%.`,
      `Unique buyers/min ${t.uniqueBuyersPerMinute.toFixed(1)} · smart buys/sells ${t.smartMoneyBuys}/${t.smartMoneySells}.`,
    ];
  } else if (spec.id === "quant") {
    const turnover5m = t.marketCap > 0 ? t.volume5mUsd / t.marketCap : 0;
    const liqMc = t.marketCap > 0 ? t.liquidity / t.marketCap : 0;
    score = clamp(
      g.entryScore * 0.52 +
      16 +
      Math.max(-12, Math.min(18, t.marketCapChange5mPct * 0.75)) +
      Math.max(-8, Math.min(14, t.volumeAccelerationPct * 0.09)) +
      Math.max(-6, Math.min(12, turnover5m * 28)) +
      Math.max(-5, Math.min(8, liqMc * 12)) +
      (g.trajectoryScore - 50) * 0.28 +
      calibration + trajectoryMemoryBias
    );
    thesis = score >= 64
      ? "The measured launch structure has enough asymmetry and acceleration to justify early PAPER exposure."
      : score >= 44
        ? "The numbers show a possible setup, but the runner pattern is not yet statistically clean."
        : "The quantitative shape is closer to a weak launch than a runner setup.";
    evidence = [
      `5m turnover ${(turnover5m * 100).toFixed(1)}% of MC · liquidity/MC ${(liqMc * 100).toFixed(1)}%.`,
      `Runner neighbors ${g.runnerNeighbors} · dumper neighbors ${g.dumperNeighbors}.`,
    ];
  } else if (spec.id === "contract") {
    const explicitFailures = packet.commonAnalytics.hardBlocks.length;
    score = explicitFailures ? clamp(12 - explicitFailures * 3) : clamp(
      76 -
      Math.max(0, t.top10Pct - 45) * 0.5 -
      Math.max(0, t.bundledPct - 12) * 0.9 -
      Math.max(0, t.sellTaxPct - 5) * 1.2 +
      calibration
    );
    thesis = explicitFailures
      ? "Explicit token-level safety evidence failed; this setup should not be traded."
      : "No explicit hard token-safety failure is present. Being early or thin is not itself a reason to reject it.";
    evidence = [
      `Sellable ${t.sellable ? "yes" : "no"} · honeypot ${t.honeypot ? "yes" : "no"} · top10 ${t.top10Pct.toFixed(1)}% · bundled ${t.bundledPct.toFixed(1)}%.`,
    ];
    risks = packet.commonAnalytics.hardBlocks.slice(0, 5);
  } else if (spec.id === "bear") {
    const distribution = Math.max(0, (1 - t.buySellRatio) * 24);
    const concentration = Math.max(0, t.top10Pct - 45) * 0.55 + Math.max(0, t.bundledPct - 12) * 1.0;
    const fade = Math.max(0, -t.marketCapChange5mPct) * 0.8 + Math.max(0, -t.volumeAccelerationPct) * 0.08;
    const safety = packet.commonAnalytics.hardBlocks.length * 30;
    const dumperPressure = clamp(g.dumperRiskScore * 0.46 + g.trajectoryDumperRiskScore * 0.18 + distribution + concentration + fade + safety - calibration - trajectoryMemoryBias);
    score = clamp(100 - dumperPressure);
    thesis = score >= 64
      ? "I do not see enough dumper evidence to veto the runner thesis."
      : score >= 44
        ? "There are meaningful dumper similarities; I want this treated as a WATCH-quality risk."
        : "The candidate matches too many failed-launch patterns for me to support an entry.";
    evidence = [
      `Dumper Genome risk ${g.dumperRiskScore.toFixed(0)}/100 · top10 ${t.top10Pct.toFixed(1)}% · bundled ${t.bundledPct.toFixed(1)}%.`,
      `5m MC ${t.marketCapChange5mPct.toFixed(1)}% · buy/sell ${t.buySellRatio.toFixed(2)}x.`,
    ];
    risks = g.dumperEvidence.slice(0, 4);
  } else {
    score = clamp(
      g.entryScore * 0.58 +
      (100 - g.dumperRiskScore) * 0.22 +
      10 +
      (g.earlyRunnerZone ? 6 : 0) +
      (g.trajectoryScore - 50) * 0.16 -
      Math.max(0, g.trajectoryDumperRiskScore - 60) * 0.08 +
      calibration + trajectoryMemoryBias
    );
    const proposed = score >= 86 ? 150 : score >= 78 ? 125 : score >= 70 ? 100 : score >= 62 ? 75 : 50;
    suggestedTradeUsd = boundedTradeUsd(proposed);
    thesis = score >= 64
      ? `This setup deserves a $${suggestedTradeUsd.toFixed(0)} PAPER starter based on opportunity strength and current evidence.`
      : "I would keep the PAPER starter at the $50 floor until the evidence improves.";
    evidence = [
      ...baseEvidence(packet),
      `Suggested starter $${suggestedTradeUsd.toFixed(0)} · paper cash $${packet.paperPortfolio.cashUsd.toFixed(2)}.`,
    ];
  }

  const independentAdjustment = identityCalibration(profile, spec.id) + candidateCalibration(profile, spec.id, packet) + specialtyCalibration(profile, spec.id, packet);
  score = clamp(score + independentAdjustment);
  if (profile) evidence = [...evidence, `${profile.teamName} independent ${spec.shortName} calibration ${independentAdjustment >= 0 ? "+" : ""}${independentAdjustment.toFixed(2)}.`];
  const vote = voteFromScore(score, packet.commonAnalytics.hardRiskPassed);
  return {
    agentId: spec.id,
    agentName: profile ? `${spec.name} · ${profile.teamName}` : spec.name,
    phase: "private",
    vote,
    confidence: confidenceFromScore(score),
    score: Math.round(score),
    thesis,
    evidence,
    risks,
    suggestedTradeUsd,
    changedVote: false,
    source: "local-engine",
    formedAt: now(),
  };
}

async function thinkMeeting(
  spec: EntitySpec,
  own: IndependentEntityOpinion,
  peers: IndependentEntityOpinion[],
): Promise<IndependentEntityOpinion> {
  const buy = peers.filter((p) => p.agentId !== spec.id && p.vote === "BUY").length;
  const watch = peers.filter((p) => p.agentId !== spec.id && p.vote === "WATCH").length;
  const skip = peers.filter((p) => p.agentId !== spec.id && p.vote === "SKIP").length;
  let score = own.score;

  // Peer evidence may influence the second-round vote, but each specialty keeps
  // its own weight and may disagree with consensus.
  if (spec.id === "contract") {
    score = own.score; // safety does not get socially voted away
  } else if (spec.id === "bear") {
    score = clamp(own.score + buy * 1.2 - skip * 0.8);
  } else if (spec.id === "portfolio") {
    score = clamp(own.score + buy * 2.2 + watch * 0.8 - skip * 1.6);
  } else {
    score = clamp(own.score + buy * 1.8 + watch * 0.6 - skip * 1.5);
  }

  const vote = voteFromScore(score, true);
  const changed = vote !== own.vote;
  const suggestedTradeUsd = spec.id === "portfolio"
    ? boundedTradeUsd(
        vote === "BUY"
          ? (buy >= 5 ? 150 : buy >= 4 ? 125 : buy >= 3 ? 100 : 75)
          : 50,
      )
    : own.suggestedTradeUsd;

  return {
    ...own,
    phase: "meeting",
    vote,
    score: Math.round(score),
    confidence: confidenceFromScore(score),
    suggestedTradeUsd,
    changedVote: changed,
    rebuttal: changed
      ? `After seeing the locked peer reads, I changed ${own.vote} → ${vote}. Peer split: ${buy} BUY / ${watch} WATCH / ${skip} SKIP.`
      : `I held ${own.vote}. Peer split: ${buy} BUY / ${watch} WATCH / ${skip} SKIP; my specialty evidence still supports my original direction.`,
    source: "local-engine",
    formedAt: now(),
  };
}

async function thinkCio(packet: Packet, meeting: IndependentEntityOpinion[], profile?: IndependentCouncilProfile): Promise<IndependentEntityOpinion> {
  const weights: Record<string, number> = {
    launch: 1.35,
    social: 0.75,
    wallet: 1.15,
    quant: 1.35,
    contract: 1.55,
    bear: 1.25,
    portfolio: 1.00,
  };

  let weightedSupport = 0;
  let totalWeight = 0;
  for (const opinion of meeting) {
    const w = Math.max(0.25, (weights[opinion.agentId] ?? 1) * (1 + (profile?.roleBias?.[opinion.agentId] ?? 0) * 0.10));
    totalWeight += w;
    const direction = opinion.vote === "BUY" ? 1 : opinion.vote === "WATCH" ? 0.55 : 0;
    weightedSupport += w * direction * (0.55 + opinion.confidence / 220);
  }

  const normalized = totalWeight > 0 ? weightedSupport / totalWeight : 0;
  const genomeBoost = (packet.runnerGenome.entryScore * 0.72 + packet.runnerGenome.trajectoryScore * 0.28 - packet.runnerGenome.dumperRiskScore * 0.25 - packet.runnerGenome.trajectoryDumperRiskScore * 0.10) / 100;
  const cioMemory = await loadPrivateEntityMemory("cio", 12, roleNamespace(profile, "cio"));
  const memory: EntityMemoryLite[] = cioMemory.map((row) => ({
    kind: row.kind, vote: row.vote, chain: row.chain, realizedReturnPct: row.realizedReturnPct,
    realizedPnlUsd: row.realizedPnlUsd, lesson: row.lesson,
  }));
  const cabinetAdjustment = profile?.fileCabinet
    ? (packet.runnerGenome.entryScore - 60) * 0.08 - Math.max(0, packet.runnerGenome.dumperRiskScore - 65) * 0.10 + (packet.runnerGenome.trajectoryScore - 50) * 0.04
    : 0;
  const specialtyAdjustment = Math.max(-6, Math.min(6, meeting.reduce((sum, opinion) => sum + (profile?.roleBias?.[opinion.agentId] ?? 0) * ((opinion.score - 50) / 25), 0)));
  const cioDirection = (profile?.roleBias?.cio ?? 0) * Math.max(-1, Math.min(1, (normalized - 0.5) * 2));
  const composite = clamp(normalized * 72 + genomeBoost * 28 + memoryCalibration(memory) + identityCalibration(profile, "cio") + candidateCalibration(profile, "cio", packet) + specialtyAdjustment + cioDirection + cabinetAdjustment);

  const hardBlocked = !packet.commonAnalytics.hardRiskPassed || packet.commonAnalytics.executorFeasibility === "BLOCK";
  const vote: "BUY" | "WATCH" | "SKIP" = hardBlocked
    ? "SKIP"
    : composite >= 57 + (profile?.thresholdDelta ?? 0) ? "BUY"
      : composite >= 38 ? "WATCH"
        : "SKIP";

  const portfolioOpinion = meeting.find((o) => o.agentId === "portfolio");
  const suggestedTradeUsd = boundedTradeUsd(
    portfolioOpinion?.suggestedTradeUsd ?? packet.runnerGenome.suggestedTradeUsd ?? 50,
  );
  const buy = meeting.filter((o) => o.vote === "BUY").length;
  const watch = meeting.filter((o) => o.vote === "WATCH").length;
  const skip = meeting.length - buy - watch;

  return {
    agentId: "cio",
    agentName: profile ? `${CIO_SPEC.name} · ${profile.teamName}` : CIO_SPEC.name,
    phase: "cio",
    vote,
    confidence: hardBlocked ? 0 : Math.round(clamp(52 + Math.abs(composite - 48) * 0.9, 50, 94)),
    score: Math.round(composite),
    thesis: hardBlocked
      ? `The specialist meeting completed, but explicit token-level safety/execution evidence blocked the trade.`
      : `Seven independent local entities finished their private reads and meeting. Final split: ${buy} BUY / ${watch} WATCH / ${skip} SKIP. I synthesize that as ${vote}.`,
    evidence: [
      `Council composite ${composite.toFixed(0)}/100.`,
      `Runner Genome ${packet.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${packet.runnerGenome.dumperRiskScore.toFixed(0)}/100.`,
    ],
    risks: packet.commonAnalytics.hardBlocks.slice(0, 5),
    suggestedTradeUsd,
    source: "local-engine",
    formedAt: now(),
  };
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

  // Shared analytics calculate objective measurements only. Their old synthetic
  // role opinions are discarded; seven separate local entities form the Council.
  const base = runWarRoom(snapshot, options);
  const portfolio = options.portfolio!;
  const packet = compactPacket(snapshot, base, portfolio);
  const sessionId = `LC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const privateRoundStartedAt = now();

  // All seven private reads execute independently before any peer output exists.
  const profile = options.teamProfile;
  const initialOpinions = await Promise.all(ENTITY_SPECS.map((spec) => thinkPrivate(spec, packet, profile)));

  const meetingRoundStartedAt = now();
  const meetingOpinions = process.env.COUNCIL_DEBATE_ROUND === "false"
    ? initialOpinions.map((opinion) => ({
        ...opinion,
        phase: "meeting" as const,
        changedVote: false,
        rebuttal: "Meeting round disabled; private vote retained.",
      }))
    : await Promise.all(
        ENTITY_SPECS.map((spec) => {
          const own = initialOpinions.find((opinion) => opinion.agentId === spec.id)!;
          return thinkMeeting(spec, own, initialOpinions);
        }),
      );

  const cioOpinion = await thinkCio(packet, meetingOpinions, profile);

  const deterministicBlocked = !base.risk.passed || base.councilProcess.executorVote === "BLOCK";
  const finalDecision = deterministicBlocked ? "SKIP" : cioOpinion.vote;
  const suggestedTradeUsd = boundedTradeUsd(
    meetingOpinions.find((o) => o.agentId === "portfolio")?.suggestedTradeUsd
      ?? cioOpinion.suggestedTradeUsd
      ?? base.runnerGenome.suggestedTradeUsd,
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
      "Seven local specialist entities completed private reads before peer reveal.",
      `${buySupport}/7 meeting entities voted BUY · ${watchSupport}/7 WATCH · ${7 - buySupport - watchSupport}/7 SKIP.`,
      `Runner CIO separately synthesized the completed meeting at ${cioOpinion.confidence}% confidence.`,
      "No OpenAI/ChatGPT API call is used anywhere in this Council runtime.",
      "Trajectory Observer is background research only: it supplies sequence evidence and private lessons but has no Council vote.",
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
    teamId: profile?.teamId,
    teamName: profile?.teamName,
    memoryNamespace: profile?.memoryNamespace ?? "main",
    mode: "independent-local",
    agentModel: "local-specialist-engine",
    cioModel: "local-runner-cio",
    privateRoundStartedAt,
    meetingRoundStartedAt,
    completedAt: now(),
    initialOpinions,
    meetingOpinions,
    cioOpinion,
  };

  const finalOpinions = [...meetingOpinions, cioOpinion];
  await Promise.all(finalOpinions.map((opinion) => recordEntityDecision({
    decisionId: base.decisionId,
    symbol: snapshot.symbol,
    chain: snapshot.chain,
    opinions: [opinion],
    namespace: roleNamespace(profile, opinion.agentId),
  }))).catch((error: unknown) => console.error("[independent-local-council] memory write", error));

  const filteredAudit = base.auditTrail.filter((line: string) =>
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
    `INDEPENDENT LOCAL COUNCIL · session ${sessionId}`,
    "PRIVATE ROUND · 7/7 specialist entities locked opinions before peer reveal",
    ...initialOpinions.map((o: IndependentEntityOpinion) => `PRIVATE ${o.agentName} · ${o.vote} · ${o.confidence}% · ${o.thesis}`),
    "MEETING ROUND · peer summaries revealed only after all seven private reads completed",
    ...meetingOpinions.map((o: IndependentEntityOpinion) => `MEETING ${o.agentName} · ${o.vote} · ${o.confidence}%${o.changedVote ? " · VOTE CHANGED" : ""} · ${o.rebuttal ?? o.thesis}`),
    `RUNNER CIO · ${cioOpinion.vote} · ${cioOpinion.confidence}% · ${cioOpinion.thesis}`,
    `DETERMINISTIC EXECUTOR · ${base.councilProcess.executorVote}${deterministicBlocked ? " · token-level safety/execution override to SKIP" : ""}`,
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
    councilConviction: Math.round(meetingOpinions.reduce((sum: number, o: IndependentEntityOpinion) => sum + o.confidence, 0) / Math.max(1, meetingOpinions.length)),
    execution,
    independentCouncil,
    auditTrail,
    reasoningCompletedAt: independentCouncil.completedAt,
  };
}
