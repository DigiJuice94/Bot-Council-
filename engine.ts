import { evaluateAlpha } from "./alpha-engine";
import { buildCouncilDiscussion } from "./debate";
import { buildExecutionPlan } from "./execution";
import { createCoreExperiment } from "./experiments";
import { buildExitStrategy } from "./exit-strategy";
import { DEFAULT_AGENT_WEIGHTS, normalizeResearchWeights } from "./learning";
import { deriveLaunchVelocity } from "./launch-velocity";
import { classifyMemeRegime } from "./meme-regime";
import { captureIndependentReads } from "./premeeting";
import { classifyMarketRegime } from "./regime";
import { DEFAULT_RISK_CONTEXT, runHardRiskChecks } from "./risk";
import type {
  AgentOpinion,
  CouncilProcess,
  Decision,
  MarketRegime,
  MarketSnapshot,
  PortfolioRiskContext,
  ProfitabilityMetrics,
  ResearchAgentId,
  ResearchAgentWeights,
  RunnerGenomeGuidance,
  TradingMode,
  WarRoomResult,
} from "./types";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const stance = (score: number): AgentOpinion["stance"] => score >= 70 ? "bullish" : score >= 45 ? "neutral" : "bearish";
function agent(id: AgentOpinion["id"], name: string, shortName: string, score: number, summary: string, detail: string, evidence: string[], color: string): AgentOpinion {
  return { id, name, shortName, score: clamp(score), stance: stance(score), summary, detail, evidence, color };
}

export function runWarRoom(snapshot: MarketSnapshot, options?: {
  mode?: TradingMode;
  portfolio?: PortfolioRiskContext;
  agentWeights?: Partial<ResearchAgentWeights>;
  memoryHints?: Partial<Record<ResearchAgentId, string[]>>;
  regime?: MarketRegime;
  learningSource?: "defaults" | "regime" | "learned";
  profitability?: ProfitabilityMetrics | null;
  runnerGenome?: RunnerGenomeGuidance;
}): WarRoomResult {
  const mode = options?.mode ?? "paper";
  const portfolio = options?.portfolio ?? DEFAULT_RISK_CONTEXT;
  const weights = normalizeResearchWeights(options?.agentWeights ?? DEFAULT_AGENT_WEIGHTS);
  const regime = options?.regime ?? classifyMarketRegime(snapshot);
  const memeRegime = classifyMemeRegime(snapshot, regime);
  const memeLane = memeRegime.isMeme;
  const alpha = evaluateAlpha(snapshot, regime);
  const risk = runHardRiskChecks(snapshot, portfolio);
  const experiment = createCoreExperiment(["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "HyperEVM", "Robinhood Chain"], options?.profitability ?? undefined);
  const decisionId = `DEC-${Date.now().toString(36).toUpperCase()}`;
  const preMeetingAt = new Date().toISOString();
  const holderGrowth = snapshot.holderGrowthPct ?? 0;
  const volumeToMc = snapshot.marketCap > 0 ? snapshot.volume24h / snapshot.marketCap : 0;
  const launchVelocity = deriveLaunchVelocity(snapshot);
  const earlyRunnerZone = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;
  const runnerGenome: RunnerGenomeGuidance = options?.runnerGenome ?? {
    earlyRunnerZone,
    entryScore: Math.max(0, Math.min(100, 50 + (snapshot.buySellRatio - 1) * 18 + (snapshot.marketCapChange5mPct ?? 0) * 1.2)),
    dumperRiskScore: Math.max(0, Math.min(100, 50 - (snapshot.buySellRatio - 1) * 14 + Math.max(0, snapshot.top10Pct - 55) + Math.max(0, snapshot.bundledPct - 15))),
    confidence: 30, sampleSize: 0, runnerNeighbors: 0, dumperNeighbors: 0, suggestedTradeUsd: 50,
    entryPattern: "OBSERVE", learned: false,
    runnerEvidence: ["Runner Genome history unavailable in this call; using live launch heuristics."],
    dumperEvidence: [],
    rugSimilarityScore: 0,
    rugSampleSize: 0,
    rugAdvisory: "LOW",
    rugEvidence: [],
    expectedPeakMultiple: 3, expectedTimeToPeakMinutes: 90, typicalRunnerDrawdownPct: 25,
    trajectoryScore: 50,
    trajectoryDumperRiskScore: 50,
    trajectoryConfidence: 0,
    trajectoryPhase: "INSUFFICIENT",
    trajectorySampleSize: 0,
    trajectoryChainSampleSize: 0,
    trajectoryEvidence: ["Trajectory Observer does not yet have a multi-snapshot sequence for this fallback call."],
  };

  // PRE-MEETING: six specialists form independent reads before peer influence.
  // V2.9 meme lane lets token-specific behavior influence the relevant specialists directly.
  const launchScore = 46 + Math.min(22, snapshot.priceChange24h * 0.48) + Math.min(18, snapshot.volume5m / 4000) + (snapshot.ageMinutes < 180 ? 9 : 1) + (alpha.asymmetryScore - 50) * 0.08 + (memeLane ? (memeRegime.breakoutScore - 50) * 0.15 + (launchVelocity.compositeScore - 50) * 0.18 : 0) + (earlyRunnerZone ? 8 : 0) + (runnerGenome.entryScore - 50) * 0.32;
  const socialScore = 48 + Math.min(32, snapshot.socialVelocityPct / 7) + (regime.id === "meme_expansion" ? 5 : 0) + (earlyRunnerZone ? Math.max(0, runnerGenome.entryScore - 55) * 0.08 : 0);
  const walletScore = 49 + snapshot.smartMoneyBuys * 6 - snapshot.smartMoneySells * 7 + (snapshot.buySellRatio - 1) * 14 + (memeLane ? Math.min(18, Math.max(0, holderGrowth) * 1.1) + Math.max(0, launchVelocity.holderScore - 50) * 0.35 : 0) + (runnerGenome.entryScore - 50) * 0.18;
  const quantScore = 44 + (snapshot.buySellRatio - 1) * 22 + Math.min(20, (snapshot.marketCapChange5mPct ?? 0) * 0.65) - snapshot.volatility * (memeLane ? 3 : 6) + (alpha.score - 50) * 0.12 + Math.min(18, volumeToMc * 10) + (runnerGenome.entryScore - 50) * 0.28;
  const dataQuality = snapshot.dataProvenance?.quality;
  let contractScore = 94 - Math.max(0, snapshot.top10Pct - 20) * 0.55 - snapshot.bundledPct * 0.7 - snapshot.sellTaxPct * 1.5;
  if (snapshot.dataProvenance?.marketSource === "dexscreener" && dataQuality) {
    if (!dataQuality.top10) contractScore -= 12;
    if (!dataQuality.bundled) contractScore -= 10;
    if (!dataQuality.liquidityLock) contractScore -= 6;
    if (!dataQuality.taxes) contractScore -= 6;
  }
  if (!snapshot.liquidityLocked) contractScore -= 10;
  if (snapshot.proxyContract) contractScore -= 6;
  if (!risk.passed) contractScore = 5;
  const broadMarketBearPenalty = memeLane ? 0.35 : 1;
  const bearPressure = 14 + snapshot.volatility * (memeLane ? 12 : 22) + Math.max(0, snapshot.top10Pct - 45) * 0.7 + Math.max(0, snapshot.bundledPct - 12) * 1.25 + (!earlyRunnerZone && snapshot.liquidity < 50_000 ? 16 : 0) + snapshot.devRugHistory * 28 + risk.warnings.length * (earlyRunnerZone ? 2 : 4) + runnerGenome.dumperRiskScore * 0.34 + (regime.id === "risk_off" ? 8 * broadMarketBearPenalty : 0) + (!regime.tradeAllowed ? 14 * broadMarketBearPenalty : 0);
  const bearInFavor = 100 - bearPressure;

  const rawCore = [launchScore, socialScore, walletScore, quantScore, contractScore, bearInFavor].map(clamp);
  const memoryHints = options?.memoryHints ?? {};
  const rawAgents: AgentOpinion[] = [
    agent("launch", "Early Runner Scout", "LS", rawCore[0], rawCore[0] >= 70 ? "Launch momentum is building." : "Launch momentum is mixed.", `5m volume $${Math.round(snapshot.volume5m).toLocaleString()} · age ${snapshot.ageMinutes}m · launch velocity ${launchVelocity.compositeScore.toFixed(0)}/100`, [`24h move ${snapshot.priceChange24h.toFixed(1)}%`, `${snapshot.chain} venue: ${snapshot.venue}`, `Token breakout ${memeRegime.breakoutScore}/100`], "#ffb13b"),
    agent("social", "Narrative Ignition Scout", "SS", rawCore[1], rawCore[1] >= 70 ? "Narrative velocity is accelerating." : "Social traction is not decisive.", `Mention velocity ${Math.round(snapshot.socialVelocityPct)}% vs baseline`, [`Social velocity ${snapshot.socialVelocityPct.toFixed(0)}%`, `Market context ${regime.label}`], "#b05cff"),
    agent("wallet", "Early Flow Analyst", "WT", rawCore[2], rawCore[2] >= 70 ? "Wallet/holder participation is expanding." : "Wallet flow needs confirmation.", `${snapshot.smartMoneyBuys} tracked buys · ${snapshot.smartMoneySells} tracked sells · holder growth ${holderGrowth.toFixed(1)}%`, [`Net tracked flow ${snapshot.smartMoneyBuys - snapshot.smartMoneySells}`, `Holder count ${snapshot.holders.toLocaleString()}`, `Holder growth ${holderGrowth.toFixed(1)}%`, `${launchVelocity.holdersPerMinute.toFixed(2)} holders/min`], "#29e693"),
    agent("quant", "Runner Pattern Quant", "QB", rawCore[3], rawCore[3] >= 70 ? "Token-level momentum, turnover and flow align." : "Risk/reward is not clean yet.", `Alpha ${alpha.score}/100 · buy/sell ${snapshot.buySellRatio.toFixed(2)}x · volume/MC ${volumeToMc.toFixed(2)}x`, [`Volume 24h $${Math.round(snapshot.volume24h).toLocaleString()}`, `Liquidity/MC ${(snapshot.liquidity / Math.max(snapshot.marketCap, 1) * 100).toFixed(1)}%`, `Reward/risk proxy ${alpha.rewardRiskProxy.toFixed(2)}x`, `$${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min launch volume`], "#28c9ff"),
    agent("contract", "Fast Safety Gate", "CB", rawCore[4], risk.passed ? "Verified safety checks passed; unknown fields remain penalized." : "Hard safety veto triggered.", risk.passed ? `${dataQuality?.top10 === false ? "Top 10 unverified" : `Top 10 ${snapshot.top10Pct.toFixed(1)}%`} · ${dataQuality?.bundled === false ? "bundles unverified" : `bundles ${snapshot.bundledPct.toFixed(1)}%`}` : risk.hardBlocks[0], risk.passed ? [...risk.passedChecks.slice(0, 2), ...risk.warnings.slice(0, 1)] : risk.hardBlocks.slice(0, 3), "#ffd34f"),
    agent("bear", "Dumper Pattern Specialist", "BB", rawCore[5], rawCore[5] >= 58 ? "Red team found no fatal bear case." : "Downside case is too strong.", risk.warnings[0] ?? `${memeLane ? memeRegime.label : regime.label} stress test`, risk.warnings.length ? risk.warnings.slice(0, 3) : [memeRegime.reasons[0] ?? regime.reasons[0] ?? "No elevated deterministic warnings", `Volatility ${(snapshot.volatility * 100).toFixed(0)}%`], "#ff5f6d"),
  ];
  const preMeeting = captureIndependentReads(rawAgents, preMeetingAt, memoryHints);

  const rawWeighted =
    rawCore[0] * weights.launch + rawCore[1] * weights.social + rawCore[2] * weights.wallet +
    rawCore[3] * weights.quant + rawCore[4] * weights.contract + rawCore[5] * weights.bear;

  // MEETING: bounded peer influence. Contract/risk remains independent of popularity.
  const launchDebate = rawCore[0];
  const socialDebate = clamp(rawCore[1] + (launchDebate - 50) * 0.08);
  const walletDebate = clamp(rawCore[2] + (socialDebate - 50) * 0.05);
  const quantDebate = clamp(rawCore[3] + (walletDebate - 50) * 0.06);
  const contractDebate = rawCore[4];
  const strongestBullBeforeBear = Math.max(launchDebate, socialDebate, walletDebate, quantDebate, contractDebate);
  const bearDebate = clamp(rawCore[5] - Math.max(0, strongestBullBeforeBear - 75) * 0.08);
  const bearChallenge = (50 - bearDebate) * 0.08;
  const core = [
    clamp(launchDebate - bearChallenge), clamp(socialDebate - bearChallenge), clamp(walletDebate - bearChallenge),
    clamp(quantDebate - bearChallenge), contractDebate, bearDebate,
  ];

  const councilWeighted =
    core[0] * weights.launch + core[1] * weights.social + core[2] * weights.wallet +
    core[3] * weights.quant + core[4] * weights.contract + core[5] * weights.bear;
  const councilConviction = risk.passed ? clamp(councilWeighted) : 0;
  const researchSupport = risk.passed ? core.filter((score) => score >= 58).length : 0;
  const requiredResearchSupport = memeLane ? memeRegime.requiredResearchSupport : 4;

  // V2.9: Alpha is evidence, not the single decision maker. Council gets more authority in meme mode.
  const blended = earlyRunnerZone
    ? clamp(runnerGenome.entryScore * 0.50 + councilConviction * 0.35 + alpha.score * 0.15)
    : memeLane
      ? clamp(councilConviction * 0.78 + alpha.score * 0.22)
      : clamp(councilConviction * 0.68 + alpha.score * 0.32);
  const conviction = risk.passed && (earlyRunnerZone || (memeLane ? memeRegime.id !== "meme_unsafe" : regime.tradeAllowed)) ? blended : 0;

  const earlyRunnerAbsoluteMinLiquidity = Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000));
  const executorVote: CouncilProcess["executorVote"] = !risk.passed || (!earlyRunnerZone && memeRegime.id === "meme_unsafe") || (earlyRunnerZone ? snapshot.liquidity < earlyRunnerAbsoluteMinLiquidity : snapshot.liquidity < 20_000)
    ? "BLOCK"
    : !earlyRunnerZone && memeLane && (regime.id === "risk_off" || regime.id === "panic_crash" || regime.id === "high_volatility" || snapshot.buySellRatio < 1)
      ? "REDUCE"
      : "READY";

  const standardBuyAllowed = risk.passed && regime.tradeAllowed && alpha.action === "TRADE" && alpha.score >= regime.minAlphaScore && conviction >= regime.minCouncilConviction && researchSupport >= requiredResearchSupport;
  const memeBuyAllowed = risk.passed && memeRegime.entryAllowed && alpha.score >= memeRegime.minAlphaScore && conviction >= memeRegime.minCouncilConviction && researchSupport >= memeRegime.requiredResearchSupport;
  // EARLY RUNNER CORE: learned runner-vs-dumper evidence is the main paper-training gate.
  // We deliberately do not wait for mature-market Alpha/quorum thresholds in the $10K-$50K hunt zone.
  const earlyRunnerBuyAllowed = risk.passed && earlyRunnerZone && runnerGenome.entryScore >= Number(process.env.PAPER_EARLY_RUNNER_BUY_SCORE ?? 62) && runnerGenome.dumperRiskScore < Number(process.env.PAPER_EARLY_RUNNER_MAX_DUMPER_RISK ?? 80);
  const buyAllowed = earlyRunnerZone ? earlyRunnerBuyAllowed : (memeLane ? memeBuyAllowed : standardBuyAllowed);

  let cioVote: Decision = "SKIP";
  if (buyAllowed) cioVote = "BUY";
  else if (risk.passed && earlyRunnerZone && runnerGenome.entryScore >= Number(process.env.PAPER_EARLY_RUNNER_WATCH_SCORE ?? 42)) {
    cioVote = "WATCH";
  } else {
    const watchThreshold = memeLane ? Math.max(58, memeRegime.minCouncilConviction - 10) : Math.max(58, regime.minCouncilConviction - 14);
    const laneAlive = memeLane ? memeRegime.id !== "meme_unsafe" : regime.tradeAllowed;
    if (risk.passed && laneAlive && conviction >= watchThreshold && researchSupport >= Math.max(3, requiredResearchSupport - 1)) cioVote = "WATCH";
  }

  let decision: Decision = cioVote;
  if (executorVote === "BLOCK") decision = "SKIP";
  const alignedBots = Math.min(8, researchSupport + (cioVote === "BUY" ? 1 : 0) + (executorVote !== "BLOCK" ? 1 : 0));
  const consensus = researchSupport;
  const councilProcess: CouncilProcess = {
    lane: earlyRunnerZone ? "early-runner" : memeLane ? "meme" : "standard",
    researchSupport,
    requiredResearchSupport,
    cioVote,
    executorVote,
    alignedBots,
    totalBots: 8,
    reasons: memeLane
      ? [
          `${researchSupport}/6 independent research bots support the setup; ${memeRegime.requiredResearchSupport}/6 required for ${memeRegime.label}.`,
          `CIO synthesis: ${cioVote} at ${conviction}% conviction.`,
          `Executor feasibility: ${executorVote}; broad market only changes meme sizing (${memeRegime.broadMarketModifier.toFixed(2)}x).`,
        ]
      : [
          `${researchSupport}/6 independent research bots support the setup; 4/6 required.`,
          `CIO synthesis: ${cioVote} at ${conviction}% conviction.`,
          `Executor feasibility: ${executorVote}.`,
        ],
  };

  const agents: AgentOpinion[] = [
    agent("launch", "Early Runner Scout", "LS", core[0], core[0] >= 70 ? "Launch momentum is building." : "Launch momentum is mixed.", `5m volume $${Math.round(snapshot.volume5m).toLocaleString()} · age ${snapshot.ageMinutes}m · launch velocity ${launchVelocity.compositeScore.toFixed(0)}/100`, [...rawAgents[0].evidence, ...(memoryHints.launch ?? []).map((x) => `Memory: ${x}`)], "#ffb13b"),
    agent("social", "Narrative Ignition Scout", "SS", core[1], core[1] >= 70 ? "Narrative velocity is accelerating." : "Social traction is not decisive.", `Mention velocity ${Math.round(snapshot.socialVelocityPct)}% vs baseline`, [...rawAgents[1].evidence, ...(memoryHints.social ?? []).map((x) => `Memory: ${x}`)], "#b05cff"),
    agent("wallet", "Early Flow Analyst", "WT", core[2], core[2] >= 70 ? "Wallet/holder participation is expanding." : "Wallet flow needs confirmation.", rawAgents[2].detail, [...rawAgents[2].evidence, ...(memoryHints.wallet ?? []).map((x) => `Memory: ${x}`)], "#29e693"),
    agent("quant", "Runner Pattern Quant", "QB", core[3], core[3] >= 70 ? "Token-level momentum, turnover and flow align." : "Risk/reward is not clean yet.", rawAgents[3].detail, [...rawAgents[3].evidence, ...(memoryHints.quant ?? []).map((x) => `Memory: ${x}`)], "#28c9ff"),
    agent("contract", "Fast Safety Gate", "CB", core[4], risk.passed ? "Core security checks passed." : "Hard safety veto triggered.", rawAgents[4].detail, [...rawAgents[4].evidence, ...(memoryHints.contract ?? []).map((x) => `Memory: ${x}`)], "#ffd34f"),
    agent("bear", "Dumper Pattern Specialist", "BB", core[5], core[5] >= 58 ? "Red team found no fatal bear case." : "Downside case is too strong.", rawAgents[5].detail, [...rawAgents[5].evidence, ...(memoryHints.bear ?? []).map((x) => `Memory: ${x}`)], "#ff5f6d"),
    {
      id: "cio", name: "Runner CIO", shortName: "CIO", score: conviction,
      stance: conviction >= 70 ? "bullish" : conviction >= 45 ? "neutral" : "bearish",
      summary: !risk.passed ? "SKIP: deterministic safety layer vetoed the trade." : earlyRunnerZone ? `${cioVote}: Runner Genome ${runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${runnerGenome.dumperRiskScore.toFixed(0)}/100 at ${Math.round(snapshot.marketCap).toLocaleString()} MC.` : memeLane ? `${cioVote}: six specialists + meme-native context produced ${conviction}% conviction.` : !regime.tradeAllowed ? `SKIP: ${regime.label} is a no-trade regime.` : `${cioVote}: council ${councilConviction}% + alpha evidence ${alpha.score}/100 produced ${conviction}% conviction.`,
      detail: `${memeLane ? memeRegime.label : regime.label} · ${researchSupport}/6 research support · Executor ${executorVote} · risk cap ${risk.maxPositionPct.toFixed(2)}%`,
      evidence: [`Council quorum ${researchSupport}/${requiredResearchSupport}`, `Alpha evidence ${alpha.score}/100`, `Experiment stage ${experiment.stage}`], color: "#70a8ff",
    },
    {
      id: "executor", name: "Executor", shortName: "EX", score: executorVote === "BLOCK" ? 0 : conviction, stance: executorVote === "BLOCK" ? "bearish" : "ready",
      summary: executorVote === "BLOCK" ? "Execution feasibility blocked the order." : decision === "BUY" ? `${mode.toUpperCase()} order is executable after sizing and slippage controls.` : "Execution path is ready if CIO upgrades the setup.",
      detail: memeLane ? `Meme starter sizing uses ${memeRegime.starterPositionMultiplier.toFixed(2)}x before Winner Engine confirmation scaling.` : mode === "paper" ? "Position Guardian takes ownership after a fill" : "Live mode remains gated by global + strategy controls",
      evidence: ["Executor is the eighth active council role: it validates route, liquidity and order feasibility", "Position Guardian scales only confirmed winners and never averages down", "Deterministic risk remains outside popularity/voting"], color: "#52f6c6",
    },
  ];

  const baseExitStrategy = buildExitStrategy(snapshot, conviction, risk, regime);
  const learnedEarlyStopPct = Math.max(18, Math.min(30, runnerGenome.typicalRunnerDrawdownPct * 0.70));
  const exitStrategy = earlyRunnerZone ? {
    ...baseExitStrategy,
    stopLossPct: Number(Math.max(baseExitStrategy.stopLossPct, learnedEarlyStopPct).toFixed(1)),
    takeProfits: [
      { gainPct: 50, sellPct: 15, label: "TP1" },
      { gainPct: 100, sellPct: 20, label: "TP2" },
      { gainPct: 200, sellPct: 20, label: "TP3" },
      { gainPct: 400, sellPct: 45, label: "Runner" },
    ],
    moonbagPct: 0,
    liquidityFloorUsd: Math.max(500, Math.round(snapshot.liquidity * 0.25)),
    winnerActivationPct: 35,
    winnerTrailingStopPct: Math.max(baseExitStrategy.winnerTrailingStopPct ?? baseExitStrategy.trailingStopPct, 22),
    winnerMaxHoldMinutes: Math.max(baseExitStrategy.winnerMaxHoldMinutes ?? baseExitStrategy.maxHoldMinutes, 1_440),
    moonbagTrailingStopPct: Math.max(baseExitStrategy.moonbagTrailingStopPct ?? baseExitStrategy.trailingStopPct, 30),
    moonbagMaxHoldMinutes: 20,
    invalidationRules: [...baseExitStrategy.invalidationRules, "Exit Genome confirms distribution / runner continuation failure"],
  } : baseExitStrategy;
  const baseAllocationMultiplier = earlyRunnerZone
    ? 1
    : memeLane
      ? memeRegime.starterPositionMultiplier * (alpha.score >= 80 ? 1 : alpha.score >= 65 ? 0.9 : 0.78)
      : regime.positionSizeMultiplier * (alpha.score >= 85 ? 1 : alpha.score >= 75 ? 0.88 : 0.72);
  const allocationMultiplier = Math.max(0, Math.min(1, baseAllocationMultiplier * (executorVote === "REDUCE" ? 0.75 : 1)));
  const execution = buildExecutionPlan({ mode, snapshot, decision, conviction, risk, portfolio, experiment, decisionId, allocationMultiplier });
  const reasoningCompletedAt = new Date().toISOString();
  const baseResult: WarRoomResult = {
    decisionId, snapshot, regime, memeRegime, runnerGenome, councilProcess, alpha, preMeeting, agents, agentWeights: weights,
    learningSource: options?.learningSource ?? "defaults",
    decision, consensus, conviction, councilConviction, risk, experiment, exitStrategy, execution,
    auditTrail: [], generatedAt: preMeetingAt, reasoningCompletedAt,
  };

  const discussion = buildCouncilDiscussion(baseResult);
  const discussionAudit = discussion.map((turn, index) => {
    const speakingAgent = agents.find((agentOutput) => agentOutput.id === turn.agentId);
    return `COUNCIL ${String(index + 1).padStart(2, "0")}/${discussion.length} · ${turn.round.toUpperCase()} · ${speakingAgent?.name ?? turn.agentId}: ${turn.message}`;
  });
  const preMeetingAudit = preMeeting.map((read) => `PRE-MEETING · ${read.agentId.toUpperCase()} · ${read.score}% · ${read.thesis}${read.memoryHints?.length ? ` · ${read.memoryHints.length} relevant memories` : ""}`);
  const auditTrail = [
    `${snapshot.chain}: $${snapshot.symbol} admitted to War Room`,
    `DATA PROVENANCE · ${snapshot.dataProvenance?.live ? "LIVE" : "ADAPTER"} · market ${snapshot.dataProvenance?.marketSource ?? "adapter"} · security ${snapshot.dataProvenance?.securitySource ?? "adapter"}`,
    `DECISION LANE · ${memeLane ? `MEME-NATIVE · ${memeRegime.label} · breakout ${memeRegime.breakoutScore}/100` : `STANDARD · ${regime.label}`}`,
    `MARKET CONTEXT · ${regime.label} · ${regime.confidence}% confidence${memeLane ? ` · sizing modifier ${memeRegime.broadMarketModifier.toFixed(2)}x, not directional veto` : ` · trade ${regime.tradeAllowed ? "ALLOWED" : "BLOCKED"}`}`,
    `ALPHA EVIDENCE · ${alpha.action} · ${alpha.score}/100 · reward/risk proxy ${alpha.rewardRiskProxy.toFixed(2)}x`,
    `LAUNCH VELOCITY · ${launchVelocity.compositeScore.toFixed(0)}/100 · ${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · ${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min volume${launchVelocity.transactionsPerMinute !== null ? ` · ${launchVelocity.transactionsPerMinute.toFixed(1)} tx/min` : ""}`,
    `RUNNER GENOME · entry ${runnerGenome.entryScore.toFixed(1)}/100 · dumper risk ${runnerGenome.dumperRiskScore.toFixed(1)}/100 · ${runnerGenome.entryPattern} · ${runnerGenome.sampleSize} labeled cases · suggested ${runnerGenome.suggestedTradeUsd}`,
    "Pre-meeting isolation: all six research specialists formed opinions before seeing peer output",
    ...preMeetingAudit,
    `COUNCIL QUORUM · ${researchSupport}/6 research support · ${requiredResearchSupport}/6 required · CIO ${cioVote} · Executor ${executorVote}`,
    `8-BOT PROCESS · ${alignedBots}/8 aligned/ready · final decision cannot be produced by Alpha or market regime alone`,
    `Debate adjustment: raw ${clamp(rawWeighted)}% → council ${councilConviction}% → evidence-blended ${conviction}%`,
    ...discussionAudit,
    `Exit plan: stop ${exitStrategy.stopLossPct}% · base trail ${exitStrategy.trailingStopPct}% · staged realization 100% · winner hold ${exitStrategy.winnerMaxHoldMinutes ?? exitStrategy.maxHoldMinutes}m`,
    `Deterministic risk gate: ${risk.passed ? "PASS" : "VETO"}`,
    `CIO FINAL: ${decision} at ${conviction}% conviction`,
    `Executor: ${execution.allowed ? `ORDER PLAN CREATED · allocation multiplier ${allocationMultiplier.toFixed(2)}x` : execution.reason}`,
  ];

  return { ...baseResult, auditTrail };
}
