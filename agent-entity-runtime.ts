import { buildExecutionPlan } from "./execution";
import { runWarRoom } from "./engine";
import { loadPrivateEntityMemory, recordEntityDecision } from "./agent-entity-store";
import { assessSellabilityRisk } from "./sellability-investigator";
import type {
  AgentOpinion,
  CouncilEntityId,
  FilingCabinetReport,
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
  filingCabinetReport?: FilingCabinetReport;
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
    id: "sellability", name: "Sellability Investigator", shortName: "SI", color: "#e65f49",
    mission: "Study every unsellable loss and identify its pre-buy fingerprint before future capital enters.",
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

function compactPacket(snapshot: MarketSnapshot, base: WarRoomResult, portfolio: PortfolioRiskContext, sellabilityInvestigation: NonNullable<WarRoomResult["sellabilityInvestigation"]>, filingCabinetReport?: FilingCabinetReport) {
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
    sellabilityInvestigation,
    filingCabinetReport: filingCabinetReport ? {
      role: filingCabinetReport.role,
      cioBrief: filingCabinetReport.cioBrief,
      cioAdjustment: filingCabinetReport.cioAdjustment,
      evidenceSampleSize: filingCabinetReport.evidenceSampleSize,
      topTechniques: filingCabinetReport.topTechniques.slice(0, 10),
    } : null,
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

async function thinkPrivate(spec: EntitySpec, packet: Packet): Promise<IndependentEntityOpinion> {
  const rawMemory = await loadPrivateEntityMemory(spec.id, 12);
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
  } else if (spec.id === "sellability") {
    const investigation = packet.sellabilityInvestigation;
    score = clamp(100 - investigation.riskScore);
    thesis = investigation.verifiedBlock
      ? "Fresh verified evidence says this token cannot be exited safely, so I vote SKIP."
      : investigation.learnedBlock
        ? "This candidate repeatedly matches the pre-buy fingerprints of filed unsellable losses, so I vote SKIP."
        : investigation.sampleSize
          ? "I compared this candidate with the unsellable case file; the current pattern does not meet the repeated-case block standard."
          : "No unsellable cases are filed yet, so I rely on verified live sellability evidence and begin building the case library.";
    evidence = investigation.evidence;
    risks = investigation.riskScore >= 55 ? investigation.evidence : [];
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

  const vote = voteFromScore(score, packet.commonAnalytics.hardRiskPassed);
  return {
    agentId: spec.id,
    agentName: spec.name,
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
  if (spec.id === "contract" || spec.id === "sellability") {
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

async function thinkCio(packet: Packet, meeting: IndependentEntityOpinion[]): Promise<IndependentEntityOpinion> {
  const weights: Record<string, number> = {
    launch: 1.35,
    social: 0.75,
    wallet: 1.15,
    quant: 1.35,
    contract: 1.55,
    bear: 1.25,
    sellability: 1.65,
    portfolio: 1.00,
  };

  let weightedSupport = 0;
  let totalWeight = 0;
  for (const opinion of meeting) {
    const w = weights[opinion.agentId] ?? 1;
    totalWeight += w;
    const direction = opinion.vote === "BUY" ? 1 : opinion.vote === "WATCH" ? 0.55 : 0;
    weightedSupport += w * direction * (0.55 + opinion.confidence / 220);
  }

  const normalized = totalWeight > 0 ? weightedSupport / totalWeight : 0;
  const genomeBoost = (packet.runnerGenome.entryScore * 0.72 + packet.runnerGenome.trajectoryScore * 0.28 - packet.runnerGenome.dumperRiskScore * 0.25 - packet.runnerGenome.trajectoryDumperRiskScore * 0.10) / 100;
  const compositeBeforeCabinet = clamp(normalized * 72 + genomeBoost * 28);
  const filingCabinetAdjustment = clamp(packet.filingCabinetReport?.cioAdjustment ?? 0, -3, 3);
  const composite = clamp(compositeBeforeCabinet + filingCabinetAdjustment);

  const hardBlocked = !packet.commonAnalytics.hardRiskPassed || packet.commonAnalytics.executorFeasibility === "BLOCK" || packet.sellabilityInvestigation.verifiedBlock || packet.sellabilityInvestigation.learnedBlock;
  const vote: "BUY" | "WATCH" | "SKIP" = hardBlocked
    ? "SKIP"
    : composite >= 57 ? "BUY"
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
    agentName: CIO_SPEC.name,
    phase: "cio",
    vote,
    confidence: hardBlocked ? 0 : Math.round(clamp(52 + Math.abs(composite - 48) * 0.9, 50, 94)),
    score: Math.round(composite),
    thesis: hardBlocked
      ? `The specialist meeting completed, but explicit token-level safety/execution evidence blocked the trade.`
      : `Eight independent local specialists finished their private reads and meeting. Final split: ${buy} BUY / ${watch} WATCH / ${skip} SKIP. I synthesize that as ${vote}.`,
    evidence: [
      `Council composite ${composite.toFixed(0)}/100.`,
      `Runner Genome ${packet.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${packet.runnerGenome.dumperRiskScore.toFixed(0)}/100.`,
      packet.filingCabinetReport
        ? `Filing Cabinet Curator advisory ${filingCabinetAdjustment >= 0 ? "+" : ""}${filingCabinetAdjustment.toFixed(1)} points (advisory only, never a rule or veto): ${packet.filingCabinetReport.cioBrief}`
        : "Filing Cabinet Curator has not produced an advisory brief yet.",
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
  // role opinions are discarded; eight separate local specialists form the Council.
  const base = runWarRoom(snapshot, options);
  const portfolio = options.portfolio!;
  const sellabilityInvestigation = await assessSellabilityRisk(snapshot);
  const packet = compactPacket(snapshot, base, portfolio, sellabilityInvestigation, options.filingCabinetReport);
  const sessionId = `LC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const privateRoundStartedAt = now();

  // All eight private reads execute independently before any peer output exists.
  const initialOpinions = await Promise.all(ENTITY_SPECS.map((spec) => thinkPrivate(spec, packet)));

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

  const cioOpinion = await thinkCio(packet, meetingOpinions);

  const deterministicBlocked = !base.risk.passed || base.councilProcess.executorVote === "BLOCK" || sellabilityInvestigation.verifiedBlock || sellabilityInvestigation.learnedBlock;
  const finalDecision = deterministicBlocked ? "SKIP" : cioOpinion.vote;
  const suggestedTradeUsd = boundedTradeUsd(
    meetingOpinions.find((o) => o.agentId === "portfolio")?.suggestedTradeUsd
      ?? cioOpinion.suggestedTradeUsd
      ?? base.runnerGenome.suggestedTradeUsd,
  );
  const runnerGenome = { ...base.runnerGenome, suggestedTradeUsd };

  const alignedBots = Math.max(1, Math.min(9, meetingOpinions.filter((o) => o.vote === cioOpinion.vote).length + 1));
  const buySupport = meetingOpinions.filter((o) => o.vote === "BUY").length;
  const watchSupport = meetingOpinions.filter((o) => o.vote === "WATCH").length;
  const researchSupport = buySupport + watchSupport;

  const councilProcess = {
    ...base.councilProcess,
    researchSupport,
    requiredResearchSupport: 4,
    cioVote: cioOpinion.vote,
    alignedBots,
    totalBots: 9 as const,
    reasons: [
      "Eight local specialist entities completed private reads before peer reveal.",
      `${buySupport}/8 meeting entities voted BUY · ${watchSupport}/8 WATCH · ${8 - buySupport - watchSupport}/8 SKIP.`,
      `Sellability Investigator: risk ${sellabilityInvestigation.riskScore}/100 · ${sellabilityInvestigation.similarCases} close unsellable matches · ${sellabilityInvestigation.learnedBlock || sellabilityInvestigation.verifiedBlock ? "BLOCK" : "NO BLOCK"}.`,
      `Runner CIO separately synthesized the completed meeting at ${cioOpinion.confidence}% confidence.`,
      "No OpenAI/ChatGPT API call is used anywhere in this Council runtime.",
      "Trajectory Observer is background research only: it supplies sequence evidence and private lessons but has no Council vote.",
      options.filingCabinetReport
        ? `Filing Cabinet Curator supplied an advisory-only ${options.filingCabinetReport.cioAdjustment >= 0 ? "+" : ""}${options.filingCabinetReport.cioAdjustment.toFixed(1)}-point context adjustment; it has no vote or veto.`
        : "Filing Cabinet Curator advisory was unavailable for this cycle; Council logic continued without it.",
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
    .filter((opinion) => opinion.agentId !== "portfolio" && opinion.agentId !== "sellability")
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

  await recordEntityDecision({
    decisionId: base.decisionId,
    symbol: snapshot.symbol,
    chain: snapshot.chain,
    opinions: [...meetingOpinions, cioOpinion],
  }).catch((error: unknown) => console.error("[independent-local-council] memory write", error));

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
    "PRIVATE ROUND · 8/8 specialist entities locked opinions before peer reveal",
    ...initialOpinions.map((o: IndependentEntityOpinion) => `PRIVATE ${o.agentName} · ${o.vote} · ${o.confidence}% · ${o.thesis}`),
    "MEETING ROUND · peer summaries revealed only after all eight private reads completed",
    ...meetingOpinions.map((o: IndependentEntityOpinion) => `MEETING ${o.agentName} · ${o.vote} · ${o.confidence}%${o.changedVote ? " · VOTE CHANGED" : ""} · ${o.rebuttal ?? o.thesis}`),
    `RUNNER CIO · ${cioOpinion.vote} · ${cioOpinion.confidence}% · ${cioOpinion.thesis}`,
    `DETERMINISTIC EXECUTOR · ${base.councilProcess.executorVote}${deterministicBlocked ? " · token-level safety/execution override to SKIP" : ""}`,
    `CIO FINAL · ${finalDecision} · suggested paper size $${suggestedTradeUsd.toFixed(2)}`,
  ];

  return {
    ...base,
    sellabilityInvestigation,
    filingCabinetReport: options.filingCabinetReport,
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
