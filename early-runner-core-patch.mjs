import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.25-early-runner-core] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.25-early-runner-core] patched ${rel}`);
}
function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find patch anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyEarlyRunnerCorePatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      'export type CouncilProcess = {\n  lane: "standard" | "meme";',
      'export type CouncilProcess = {\n  lane: "standard" | "meme" | "early-runner";',
      "early-runner Council lane"
    );
    text = replaceRequired(
      text,
      'export type CouncilProcess = {',
      `export type RunnerGenomeGuidance = {
  earlyRunnerZone: boolean;
  entryScore: number;
  dumperRiskScore: number;
  confidence: number;
  sampleSize: number;
  runnerNeighbors: number;
  dumperNeighbors: number;
  suggestedTradeUsd: number;
  entryPattern: "EARLY_BREAKOUT" | "FIRST_PULLBACK" | "MOMENTUM_BUILD" | "OBSERVE";
  learned: boolean;
  runnerEvidence: string[];
  dumperEvidence: string[];
  expectedPeakMultiple: number;
  expectedTimeToPeakMinutes: number;
  typicalRunnerDrawdownPct: number;
};

export type RunnerExitGenomeGuidance = {
  continuationScore: number;
  distributionRiskScore: number;
  confidence: number;
  trailingStopPct: number;
  maxHoldMultiplier: number;
  action: "HOLD" | "EXIT";
  reason: string;
};

export type CouncilProcess = {`,
      "Runner Genome types"
    );
    text = replaceRequired(
      text,
      '  conviction: number;\n  riskMaxPositionPct?: number;',
      '  conviction: number;\n  runnerGenome?: RunnerGenomeGuidance;\n  riskMaxPositionPct?: number;',
      "position entry Runner Genome"
    );
    text = replaceRequired(
      text,
      '  memeRegime: MemeRegime;\n  councilProcess: CouncilProcess;',
      '  memeRegime: MemeRegime;\n  runnerGenome: RunnerGenomeGuidance;\n  councilProcess: CouncilProcess;',
      "WarRoomResult Runner Genome"
    );
    return text;
  });

  patchFile(root, "lib/risk.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  const paperCanExploreUnknowns = !p.liveTradingEnabled && process.env.PAPER_FAIL_CLOSED_UNKNOWN !== "true";',
      `  const paperCanExploreUnknowns = !p.liveTradingEnabled && process.env.PAPER_FAIL_CLOSED_UNKNOWN !== "true";
  const earlyRunnerLane = !p.liveTradingEnabled && m.marketCap >= 8_000 && m.marketCap <= 80_000 && m.ageMinutes <= 1_440;`,
      "early-runner risk lane"
    );
    text = replaceRequired(
      text,
      '  check(m.liquidity >= 15_000, "Executable liquidity above minimum", "Executable liquidity below minimum");',
      `  if (earlyRunnerLane) {
    // Early runners are intentionally tiny. Do not demand mature-token liquidity;
    // require a real pool, then let order-size/slippage feasibility decide the $50+ paper order.
    check(m.liquidity >= Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000)), "Early-runner pool has executable liquidity", "Early-runner pool liquidity is too small to model a real exit");
    if (m.liquidity < 5_000) warnings.push("Very thin early-runner liquidity; route/slippage model must prove the order executable");
  } else {
    check(m.liquidity >= 15_000, "Executable liquidity above minimum", "Executable liquidity below minimum");
  }`,
      "order-aware early-runner liquidity"
    );
    text = replaceRequired(
      text,
      `  check(p.dailyPnlPct > -p.maxDailyLossPct, "Daily loss limit available", "Daily loss kill-switch triggered");
  check(p.openPositions < p.maxOpenPositions, "Open-position capacity available", "Maximum open positions reached");
  check(p.totalExposurePct < p.maxTotalExposurePct, "Portfolio exposure below cap", "Maximum portfolio exposure reached");
  check(p.chainExposurePct < p.maxChainExposurePct, "Chain exposure below cap", "Maximum chain exposure reached");`,
      `  if (earlyRunnerLane) {
    // PAPER Runner Lab is allowed to spend the actual paper cash while it learns.
    // Old generic portfolio/daily-loss knobs must not silently starve the experiment.
    const runnerMaxOpen = Math.max(1, Number(process.env.PAPER_EARLY_RUNNER_MAX_OPEN_POSITIONS ?? 20));
    check(p.openPositions < runnerMaxOpen, "Early-runner position capacity available", "Maximum early-runner paper positions reached");
    passedChecks.push("Paper Runner Lab daily-loss throttling is disabled; losses remain recorded in the Filing Cabinet");
    passedChecks.push("Paper Runner Lab exposure is cash-limited rather than generic mature-strategy capped");
  } else {
    check(p.dailyPnlPct > -p.maxDailyLossPct, "Daily loss limit available", "Daily loss kill-switch triggered");
    check(p.openPositions < p.maxOpenPositions, "Open-position capacity available", "Maximum open positions reached");
    check(p.totalExposurePct < p.maxTotalExposurePct, "Portfolio exposure below cap", "Maximum portfolio exposure reached");
    check(p.chainExposurePct < p.maxChainExposurePct, "Chain exposure below cap", "Maximum chain exposure reached");
  }`,
      "paper early-runner research capacity"
    );
    text = replaceRequired(
      text,
      `  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));`,
      `  if (!earlyRunnerLane) {
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  }`,
      "do not reapply generic exposure sizing cap to Runner Lab"
    );

    text = replaceRequired(
      text,
      '    if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 2);',
      '    if (!earlyRunnerLane && m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 2);',
      "remove mature liquidity sizing penalty from early lane"
    );
    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;
    text = replaceRequired(text, '    maxDailyLossPct: Number(process.env.PAPER_MAX_DAILY_LOSS_PCT ?? 5),', '    maxDailyLossPct: Number(process.env.PAPER_MAX_DAILY_LOSS_PCT ?? 100),', "paper research daily loss freedom");
    text = replaceRequired(text, '    maxOpenPositions: Number(process.env.PAPER_MAX_OPEN_POSITIONS ?? 8),', '    maxOpenPositions: Number(process.env.PAPER_MAX_OPEN_POSITIONS ?? 20),', "paper max open positions");
    text = replaceRequired(text, '    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 60),', '    maxTotalExposurePct: Number(process.env.PAPER_MAX_TOTAL_EXPOSURE_PCT ?? 100),', "paper total exposure");
    text = replaceRequired(text, '    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 30),', '    maxChainExposurePct: Number(process.env.PAPER_MAX_CHAIN_EXPOSURE_PCT ?? 100),', "paper chain exposure");
    return text;
  });

  patchFile(root, "lib/market-data.ts", (input) => {
    let text = input;
    const oldDiscovery = `async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  // Solana keeps Birdeye first because it can surface meme-native listings directly.
  if (chain === "Solana") {
    const fromBirdeye = await birdeyeNewListings(chain);
    if (fromBirdeye.length) return fromBirdeye;
    const fromGecko = await geckoNewPools(chain);
    if (fromGecko.length) return fromGecko;
    return dexDiscoveryTokens(chain);
  }

  // EVM chains prioritize actual newly-created pools instead of waiting for profiles/boosts.
  const fromGecko = await geckoNewPools(chain);
  if (fromGecko.length) return fromGecko;
  const fromBirdeye = await birdeyeNewListings(chain);
  if (fromBirdeye.length) return fromBirdeye;
  return dexDiscoveryTokens(chain);
}`;
    const newDiscovery = `async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  // V2.25: merge all fresh-listing sources instead of stopping at the first provider.
  // This is critical for $10K-$50K runners because one provider may see a pool before another.
  const [fromBirdeye, fromGecko, fromDex] = await Promise.all([
    birdeyeNewListings(chain), geckoNewPools(chain), dexDiscoveryTokens(chain),
  ]);
  const merged: DiscoveryToken[] = [];
  const seen = new Set<string>();
  for (const token of [...fromBirdeye, ...fromGecko, ...fromDex]) {
    const key = token.tokenAddress.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
  }
  return merged.sort((a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0)).slice(0, 60);
}`;
    text = replaceRequired(text, oldDiscovery, newDiscovery, "merged fresh discovery");

    const oldScore = `function candidateScore(pair: DexPair) {
  const liq = Math.log10(Math.max(1, num(pair.liquidity?.usd)));
  const volume = Math.log10(Math.max(1, volumeBucket(pair, "h1") || volumeBucket(pair, "h24")));
  const tx = txBucket(pair, "h1");
  const activity = Math.log10(Math.max(1, num(tx.buys) + num(tx.sells)));
  const ageMinutes = pair.pairCreatedAt ? Math.max(1, (Date.now() - num(pair.pairCreatedAt)) / 60_000) : 1440;
  const freshness = ageMinutes <= 60 ? 4 : ageMinutes <= 360 ? 2.5 : ageMinutes <= 1440 ? 1 : 0;
  return liq * 1.5 + volume * 1.35 + activity + freshness;
}`;
    const newScore = `function candidateScore(pair: DexPair) {
  const liquidity = Math.max(1, num(pair.liquidity?.usd));
  const liq = Math.log10(liquidity);
  const volume1h = volumeBucket(pair, "h1") || volumeBucket(pair, "h24");
  const volume = Math.log10(Math.max(1, volume1h));
  const tx = txBucket(pair, "h1");
  const m5 = txBucket(pair, "m5");
  const buys = num(m5.buys, num(tx.buys));
  const sells = num(m5.sells, num(tx.sells));
  const activity = Math.log10(Math.max(1, num(tx.buys) + num(tx.sells)));
  const pressure = sells > 0 ? Math.max(0, Math.min(3, buys / sells)) : buys > 0 ? 2.5 : 1;
  const ageMinutes = pair.pairCreatedAt ? Math.max(1, (Date.now() - num(pair.pairCreatedAt)) / 60_000) : 1440;
  const freshness = ageMinutes <= 30 ? 7 : ageMinutes <= 120 ? 5 : ageMinutes <= 360 ? 2.5 : ageMinutes <= 1440 ? 1 : 0;
  const mc = num(pair.marketCap, num(pair.fdv, 0));
  const earlyRunnerBonus = mc >= 10_000 && mc <= 50_000 ? 9 : mc >= 8_000 && mc <= 80_000 ? 6 : mc > 0 && mc <= 150_000 ? 2 : 0;
  const turnover = mc > 0 ? Math.min(5, volume1h / mc) : 0;
  return liq * 0.8 + volume * 1.1 + activity * 1.15 + freshness + earlyRunnerBonus + pressure * 1.7 + turnover * 1.8;
}`;
    text = replaceRequired(text, oldScore, newScore, "early-runner candidate ranking");
    text = replaceRequired(text, '    if (!address || num(pair.priceUsd) <= 0 || num(pair.liquidity?.usd) < 5_000) continue;', '    if (!address || num(pair.priceUsd) <= 0 || num(pair.liquidity?.usd) < Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_DISCOVERY_MIN_LIQUIDITY_USD ?? 1_000))) continue;', "discovery liquidity floor");
    text = replaceRequired(text, '  for (const pair of ranked.slice(0, 10)) {', '  for (const pair of ranked.slice(0, 24)) {', "broader fresh candidate examination");
    return text;
  });

  patchFile(root, "lib/provider-waterfall.ts", (input) => {
    let text = input;
    text = replaceRequired(text, '    if (!snapshot || snapshot.liquidity < 5_000) continue;', '    if (!snapshot || snapshot.liquidity < Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_DISCOVERY_MIN_LIQUIDITY_USD ?? 1_000))) continue;', "Moralis early discovery floor");
    return text;
  });

  patchFile(root, "lib/engine.ts", (input) => {
    let text = input;
    text = replaceRequired(text, '  ResearchAgentWeights,\n  TradingMode,', '  ResearchAgentWeights,\n  RunnerGenomeGuidance,\n  TradingMode,', "engine RunnerGenome type import");
    text = replaceRequired(
      text,
      '  const experiment = createCoreExperiment(["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"], options?.profitability ?? undefined);',
      '  const experiment = createCoreExperiment(["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "HyperEVM", "Robinhood Chain"], options?.profitability ?? undefined);',
      "seven-chain strategy experiment"
    );
    text = replaceRequired(text, '  profitability?: ProfitabilityMetrics | null;\n}): WarRoomResult {', '  profitability?: ProfitabilityMetrics | null;\n  runnerGenome?: RunnerGenomeGuidance;\n}): WarRoomResult {', "runWarRoom RunnerGenome option");
    text = replaceRequired(
      text,
      '  const launchVelocity = deriveLaunchVelocity(snapshot);',
      `  const launchVelocity = deriveLaunchVelocity(snapshot);
  const earlyRunnerZone = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;
  const runnerGenome: RunnerGenomeGuidance = options?.runnerGenome ?? {
    earlyRunnerZone,
    entryScore: Math.max(0, Math.min(100, 50 + (snapshot.buySellRatio - 1) * 18 + (snapshot.marketCapChange5mPct ?? 0) * 1.2)),
    dumperRiskScore: Math.max(0, Math.min(100, 50 - (snapshot.buySellRatio - 1) * 14 + Math.max(0, snapshot.top10Pct - 55) + Math.max(0, snapshot.bundledPct - 15))),
    confidence: 30, sampleSize: 0, runnerNeighbors: 0, dumperNeighbors: 0, suggestedTradeUsd: 50,
    entryPattern: "OBSERVE", learned: false,
    runnerEvidence: ["Runner Genome history unavailable in this call; using live launch heuristics."],
    dumperEvidence: [], expectedPeakMultiple: 3, expectedTimeToPeakMinutes: 90, typicalRunnerDrawdownPct: 25,
  };`,
      "RunnerGenome initialization"
    );

    text = replaceRequired(
      text,
      '  const launchScore = 46 + Math.min(22, snapshot.priceChange24h * 0.48) + Math.min(18, snapshot.volume5m / 4000) + (snapshot.ageMinutes < 180 ? 9 : 1) + (alpha.asymmetryScore - 50) * 0.08 + (memeLane ? (memeRegime.breakoutScore - 50) * 0.15 + (launchVelocity.compositeScore - 50) * 0.18 : 0);',
      '  const launchScore = 46 + Math.min(22, snapshot.priceChange24h * 0.48) + Math.min(18, snapshot.volume5m / 4000) + (snapshot.ageMinutes < 180 ? 9 : 1) + (alpha.asymmetryScore - 50) * 0.08 + (memeLane ? (memeRegime.breakoutScore - 50) * 0.15 + (launchVelocity.compositeScore - 50) * 0.18 : 0) + (earlyRunnerZone ? 8 : 0) + (runnerGenome.entryScore - 50) * 0.32;',
      "Early Runner Scout score"
    );
    text = replaceRequired(
      text,
      '  const socialScore = 44 + Math.min(44, snapshot.socialVelocityPct / 6) + (regime.id === "meme_expansion" ? 6 : 0);',
      '  const socialScore = 48 + Math.min(32, snapshot.socialVelocityPct / 7) + (regime.id === "meme_expansion" ? 5 : 0) + (earlyRunnerZone ? Math.max(0, runnerGenome.entryScore - 55) * 0.08 : 0);',
      "Narrative Ignition score"
    );
    text = replaceRequired(
      text,
      '  const walletScore = 49 + snapshot.smartMoneyBuys * 6 - snapshot.smartMoneySells * 7 + (snapshot.buySellRatio - 1) * 7 + (memeLane ? Math.min(18, Math.max(0, holderGrowth) * 1.1) + Math.max(0, launchVelocity.holderScore - 50) * 0.35 : 0);',
      '  const walletScore = 49 + snapshot.smartMoneyBuys * 6 - snapshot.smartMoneySells * 7 + (snapshot.buySellRatio - 1) * 14 + (memeLane ? Math.min(18, Math.max(0, holderGrowth) * 1.1) + Math.max(0, launchVelocity.holderScore - 50) * 0.35 : 0) + (runnerGenome.entryScore - 50) * 0.18;',
      "Early Flow score"
    );
    text = replaceRequired(
      text,
      '  const quantScore = 42 + (snapshot.buySellRatio - 1) * 23 + Math.min(18, snapshot.priceChange24h * 0.4) - snapshot.volatility * (memeLane ? 4.5 : 9) + (alpha.score - 50) * 0.18 + (memeLane ? Math.min(18, volumeToMc * 12) + (memeRegime.breakoutScore - 50) * 0.10 + Math.max(0, launchVelocity.volumeScore - 50) * 0.16 : 0);',
      '  const quantScore = 44 + (snapshot.buySellRatio - 1) * 22 + Math.min(20, (snapshot.marketCapChange5mPct ?? 0) * 0.65) - snapshot.volatility * (memeLane ? 3 : 6) + (alpha.score - 50) * 0.12 + Math.min(18, volumeToMc * 10) + (runnerGenome.entryScore - 50) * 0.28;',
      "Runner Pattern Quant score"
    );
    text = replaceRequired(
      text,
      '  const bearPressure = 18 + snapshot.volatility * (memeLane ? 16 : 30) + Math.max(0, snapshot.top10Pct - 30) * 0.8 + Math.max(0, snapshot.bundledPct - 8) * 1.4 + (snapshot.liquidity < 50_000 ? 22 : 0) + snapshot.devRugHistory * 28 + risk.warnings.length * 5 + (regime.id === "risk_off" ? 10 * broadMarketBearPenalty : 0) + (!regime.tradeAllowed ? 22 * broadMarketBearPenalty : 0);',
      '  const bearPressure = 14 + snapshot.volatility * (memeLane ? 12 : 22) + Math.max(0, snapshot.top10Pct - 45) * 0.7 + Math.max(0, snapshot.bundledPct - 12) * 1.25 + (!earlyRunnerZone && snapshot.liquidity < 50_000 ? 16 : 0) + snapshot.devRugHistory * 28 + risk.warnings.length * (earlyRunnerZone ? 2 : 4) + runnerGenome.dumperRiskScore * 0.34 + (regime.id === "risk_off" ? 8 * broadMarketBearPenalty : 0) + (!regime.tradeAllowed ? 14 * broadMarketBearPenalty : 0);',
      "Dumper Pattern Specialist pressure"
    );

    text = replaceRequired(
      text,
      '  const blended = memeLane\n    ? clamp(councilConviction * 0.78 + alpha.score * 0.22)\n    : clamp(councilConviction * 0.68 + alpha.score * 0.32);\n  const conviction = risk.passed && (memeLane ? memeRegime.id !== "meme_unsafe" : regime.tradeAllowed) ? blended : 0;',
      `  const blended = earlyRunnerZone
    ? clamp(runnerGenome.entryScore * 0.50 + councilConviction * 0.35 + alpha.score * 0.15)
    : memeLane
      ? clamp(councilConviction * 0.78 + alpha.score * 0.22)
      : clamp(councilConviction * 0.68 + alpha.score * 0.32);
  const conviction = risk.passed && (earlyRunnerZone || (memeLane ? memeRegime.id !== "meme_unsafe" : regime.tradeAllowed)) ? blended : 0;`,
      "Runner Genome conviction blend"
    );

    text = replaceRequired(
      text,
      '  const executorVote: CouncilProcess["executorVote"] = !risk.passed || memeRegime.id === "meme_unsafe" || snapshot.liquidity < 20_000\n    ? "BLOCK"\n    : memeLane && (regime.id === "risk_off" || regime.id === "panic_crash" || regime.id === "high_volatility" || snapshot.buySellRatio < 1)\n      ? "REDUCE"\n      : "READY";',
      `  const earlyRunnerAbsoluteMinLiquidity = Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000));
  const executorVote: CouncilProcess["executorVote"] = !risk.passed || (!earlyRunnerZone && memeRegime.id === "meme_unsafe") || (earlyRunnerZone ? snapshot.liquidity < earlyRunnerAbsoluteMinLiquidity : snapshot.liquidity < 20_000)
    ? "BLOCK"
    : !earlyRunnerZone && memeLane && (regime.id === "risk_off" || regime.id === "panic_crash" || regime.id === "high_volatility" || snapshot.buySellRatio < 1)
      ? "REDUCE"
      : "READY";`,
      "early-runner executor feasibility"
    );

    const oldDecision = `  const standardBuyAllowed = risk.passed && regime.tradeAllowed && alpha.action === "TRADE" && alpha.score >= regime.minAlphaScore && conviction >= regime.minCouncilConviction && researchSupport >= requiredResearchSupport;
  const memeBuyAllowed = risk.passed && memeRegime.entryAllowed && alpha.score >= memeRegime.minAlphaScore && conviction >= memeRegime.minCouncilConviction && researchSupport >= memeRegime.requiredResearchSupport;
  const buyAllowed = memeLane ? memeBuyAllowed : standardBuyAllowed;

  let cioVote: Decision = "SKIP";
  if (buyAllowed) cioVote = "BUY";
  else {
    const watchThreshold = memeLane ? Math.max(58, memeRegime.minCouncilConviction - 10) : Math.max(58, regime.minCouncilConviction - 14);
    const laneAlive = memeLane ? memeRegime.id !== "meme_unsafe" : regime.tradeAllowed;
    if (risk.passed && laneAlive && conviction >= watchThreshold && researchSupport >= Math.max(3, requiredResearchSupport - 1)) cioVote = "WATCH";
  }`;
    const newDecision = `  const standardBuyAllowed = risk.passed && regime.tradeAllowed && alpha.action === "TRADE" && alpha.score >= regime.minAlphaScore && conviction >= regime.minCouncilConviction && researchSupport >= requiredResearchSupport;
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
  }`;
    text = replaceRequired(text, oldDecision, newDecision, "early-runner CIO decision lane");

    text = replaceRequired(text, '    lane: memeLane ? "meme" : "standard",', '    lane: earlyRunnerZone ? "early-runner" : memeLane ? "meme" : "standard",', "CouncilProcess early-runner lane");
    text = replaceRequired(text, '    decisionId, snapshot, regime, memeRegime, councilProcess, alpha, preMeeting, agents, agentWeights: weights,', '    decisionId, snapshot, regime, memeRegime, runnerGenome, councilProcess, alpha, preMeeting, agents, agentWeights: weights,', "baseResult runnerGenome");

    // Retarget existing bot identities without changing stable IDs/state storage.
    text = text.replaceAll('"Launch Scout"', '"Early Runner Scout"');
    text = text.replaceAll('"Social Scout"', '"Narrative Ignition Scout"');
    text = text.replaceAll('"Wallet Tracker"', '"Early Flow Analyst"');
    text = text.replaceAll('"Quant Bot"', '"Runner Pattern Quant"');
    text = text.replaceAll('"Contract Bot"', '"Fast Safety Gate"');
    text = text.replaceAll('"Bear Bot"', '"Dumper Pattern Specialist"');
    text = text.replaceAll('id: "cio", name: "CIO"', 'id: "cio", name: "Runner CIO"');

    text = replaceRequired(
      text,
      '      summary: !risk.passed ? "SKIP: deterministic risk layer vetoed the trade." : memeLane ? `${cioVote}: six specialists + meme-native context produced ${conviction}% conviction.` : !regime.tradeAllowed ? `SKIP: ${regime.label} is a no-trade regime.` : `${cioVote}: council ${councilConviction}% + alpha evidence ${alpha.score}/100 produced ${conviction}% conviction.`,',
      '      summary: !risk.passed ? "SKIP: deterministic safety layer vetoed the trade." : earlyRunnerZone ? `${cioVote}: Runner Genome ${runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${runnerGenome.dumperRiskScore.toFixed(0)}/100 at $${Math.round(snapshot.marketCap).toLocaleString()} MC.` : memeLane ? `${cioVote}: six specialists + meme-native context produced ${conviction}% conviction.` : !regime.tradeAllowed ? `SKIP: ${regime.label} is a no-trade regime.` : `${cioVote}: council ${councilConviction}% + alpha evidence ${alpha.score}/100 produced ${conviction}% conviction.`,',
      "Runner CIO summary"
    );
    text = replaceRequired(
      text,
      '    `LAUNCH VELOCITY · ${launchVelocity.compositeScore.toFixed(0)}/100 · ${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · $${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min volume${launchVelocity.transactionsPerMinute !== null ? ` · ${launchVelocity.transactionsPerMinute.toFixed(1)} tx/min` : ""}`,',
      '    `LAUNCH VELOCITY · ${launchVelocity.compositeScore.toFixed(0)}/100 · ${launchVelocity.holdersPerMinute.toFixed(2)} holders/min · $${Math.round(launchVelocity.volumeUsdPerMinute).toLocaleString()}/min volume${launchVelocity.transactionsPerMinute !== null ? ` · ${launchVelocity.transactionsPerMinute.toFixed(1)} tx/min` : ""}`,\n    `RUNNER GENOME · entry ${runnerGenome.entryScore.toFixed(1)}/100 · dumper risk ${runnerGenome.dumperRiskScore.toFixed(1)}/100 · ${runnerGenome.entryPattern} · ${runnerGenome.sampleSize} labeled cases · suggested $${runnerGenome.suggestedTradeUsd}`,',
      "Runner Genome audit"
    );

    text = replaceRequired(
      text,
      `  const baseAllocationMultiplier = memeLane
    ? memeRegime.starterPositionMultiplier * (alpha.score >= 80 ? 1 : alpha.score >= 65 ? 0.9 : 0.78)
    : regime.positionSizeMultiplier * (alpha.score >= 85 ? 1 : alpha.score >= 75 ? 0.88 : 0.72);`,
      `  const baseAllocationMultiplier = earlyRunnerZone
    ? 1
    : memeLane
      ? memeRegime.starterPositionMultiplier * (alpha.score >= 80 ? 1 : alpha.score >= 65 ? 0.9 : 0.78)
      : regime.positionSizeMultiplier * (alpha.score >= 85 ? 1 : alpha.score >= 75 ? 0.88 : 0.72);`,
      "early-runner execution multiplier"
    );
    text = replaceRequired(
      text,
      '  const exitStrategy = buildExitStrategy(snapshot, conviction, risk, regime);',
      `  const baseExitStrategy = buildExitStrategy(snapshot, conviction, risk, regime);
  const learnedEarlyStopPct = Math.max(18, Math.min(30, runnerGenome.typicalRunnerDrawdownPct * 0.70));
  const exitStrategy = earlyRunnerZone ? {
    ...baseExitStrategy,
    stopLossPct: Number(Math.max(baseExitStrategy.stopLossPct, learnedEarlyStopPct).toFixed(1)),
    takeProfits: [
      { gainPct: 50, sellPct: 15, label: "TP1" },
      { gainPct: 100, sellPct: 20, label: "TP2" },
      { gainPct: 200, sellPct: 20, label: "TP3" },
      { gainPct: 400, sellPct: 20, label: "Runner" },
    ],
    moonbagPct: 25,
    liquidityFloorUsd: Math.max(500, Math.round(snapshot.liquidity * 0.25)),
    winnerActivationPct: 35,
    winnerTrailingStopPct: Math.max(baseExitStrategy.winnerTrailingStopPct ?? baseExitStrategy.trailingStopPct, 22),
    winnerMaxHoldMinutes: Math.max(baseExitStrategy.winnerMaxHoldMinutes ?? baseExitStrategy.maxHoldMinutes, 1_440),
    moonbagTrailingStopPct: Math.max(baseExitStrategy.moonbagTrailingStopPct ?? baseExitStrategy.trailingStopPct, 30),
    moonbagMaxHoldMinutes: Math.max(baseExitStrategy.moonbagMaxHoldMinutes ?? baseExitStrategy.maxHoldMinutes, 10_080),
    invalidationRules: [...baseExitStrategy.invalidationRules, "Exit Genome confirms distribution / runner continuation failure"],
  } : baseExitStrategy;`,
      "runner-native exit strategy"
    );
    return text;
  });

  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      'import { getRunnerResearchSnapshot, ingestClosedPositions, markResearchTradeOpened, observeCouncilResult, observeResearchSnapshot, refreshOneResearchCase } from "./runner-research";',
      'import { getRunnerGenomeGuidance, getRunnerResearchSnapshot, ingestClosedPositions, markResearchTradeOpened, observeCouncilResult, observeResearchSnapshot, refreshOneResearchCase } from "./runner-research";',
      "autopilot Runner Genome import"
    );
    text = replaceRequired(
      text,
      '  if (snapshot.liquidity < 15_000) return "Executable liquidity below minimum";',
      '  const earlyRunner = snapshot.marketCap >= 8_000 && snapshot.marketCap <= 80_000 && snapshot.ageMinutes <= 1_440;\n  const minimumLiquidity = earlyRunner ? Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000)) : 15_000;\n  if (snapshot.liquidity < minimumLiquidity) return `Executable liquidity below ${earlyRunner ? "early-runner" : "standard"} minimum`;',
      "autopilot early-runner liquidity safety"
    );

    const oldFixed = `  // The Council decides whether there is an opportunity. Sizing does not add
  // another quality test: every approved PAPER buy/probe is one fixed $50 rep.
  if (request.mode === "paper" && request.side === "BUY") {
    const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
    if (portfolio.cashUsd + 0.005 < trainingTradeUsd) {
      const reason = \`Paper wallet has $\${portfolio.cashUsd.toFixed(2)} cash; waiting for an exit before the next fixed $\${trainingTradeUsd.toFixed(2)} training buy.\`;
      recordRejection(reason);
      addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER"} waiting for cash on $\${result.snapshot.symbol}: \${reason}\`, "execution");
      return false;
    }
    request = { ...request, notionalUsd: Number(trainingTradeUsd.toFixed(2)) };
    addChat("Executor", \`\${exploration ? "PAPER TRAINING PROBE" : "AUTO PAPER BUY"} locked at $\${trainingTradeUsd.toFixed(2)} for $\${result.snapshot.symbol}. Win or lose, file the result and learn from it.\`, "execution");
  }`;
    const newDynamic = `  // $50 is the floor, not the ceiling. Once Council sees an opportunity, the
  // active Runner Genome controls paper size from learned runner/dumper similarity.
  if (request.mode === "paper" && request.side === "BUY") {
    const minimumBuyUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
    const maximumBuyUsd = Math.max(minimumBuyUsd, Number(process.env.PAPER_TRAINING_MAX_BUY_USD ?? 150));
    if (portfolio.cashUsd + 0.005 < minimumBuyUsd) {
      const reason = \`Paper wallet has $\${portfolio.cashUsd.toFixed(2)} cash; waiting for an exit before the next $\${minimumBuyUsd.toFixed(2)}+ training entry.\`;
      recordRejection(reason);
      addChat("Executor", \`\${exploration ? "EARLY-RUNNER PROBE" : "EARLY-RUNNER BUY"} waiting for cash on $\${result.snapshot.symbol}: \${reason}\`, "execution");
      return false;
    }
    const genomeTarget = Math.max(minimumBuyUsd, result.runnerGenome?.suggestedTradeUsd ?? minimumBuyUsd);
    const targetUsd = exploration ? Math.min(genomeTarget, Number(process.env.PAPER_WATCH_MAX_BUY_USD ?? 100)) : genomeTarget;
    const notionalUsd = Math.min(maximumBuyUsd, targetUsd, portfolio.cashUsd);
    request = {
      ...request,
      notionalUsd: Number(Math.max(minimumBuyUsd, notionalUsd).toFixed(2)),
      maxSlippageBps: result.runnerGenome?.earlyRunnerZone ? Math.max(request.maxSlippageBps, Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600)) : request.maxSlippageBps,
    };
    addChat("Executor", \`\${exploration ? "EARLY-RUNNER PROBE" : "EARLY-RUNNER BUY"} $\${result.snapshot.symbol}: $\${request.notionalUsd.toFixed(2)} · Genome \${result.runnerGenome?.entryScore.toFixed(0) ?? "—"}/100 · dumper risk $\${result.runnerGenome?.dumperRiskScore.toFixed(0) ?? "—"}/100. Win or lose, file the outcome and update the model.\`, "execution");
  }`;
    // V2.26.1 build hardening: do not depend on the exact text emitted by an
    // earlier sizing patch. Replace only the pre-context sizing section inside
    // executeRequest(), using stable function/context boundaries.
    if (!text.includes("const genomeTarget = Math.max(minimumBuyUsd, result.runnerGenome?.suggestedTradeUsd ?? minimumBuyUsd)")) {
      const executeHeader = 'async function executeRequest(result: WarRoomResult, portfolio: PortfolioRiskContext, request: ExecutionRequest, exploration: boolean) {';
      const executeAt = text.indexOf(executeHeader);
      const contextAt = executeAt >= 0 ? text.indexOf('  const context = entryContext(result, portfolio);', executeAt + executeHeader.length) : -1;
      if (executeAt < 0 || contextAt < 0) fail("Could not find structural boundary: dynamic $50+ Runner Genome sizing");
      const insertionAt = executeAt + executeHeader.length;
      text = text.slice(0, insertionAt) + "\\n" + newDynamic + "\\n\\n" + text.slice(contextAt);
    }

    text = replaceRequired(
      text,
      '  const context = entryContext(result, portfolio);\n  if (exploration) {\n    context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;\n  }',
      '  const context = entryContext(result, portfolio);\n  context.runnerGenome = result.runnerGenome;\n  context.initialAllocationPct = portfolio.equityUsd > 0 ? request.notionalUsd / portfolio.equityUsd * 100 : 0;',
      "persist actual Runner Genome entry context"
    );

    const oldExplore = `function explorationRequest(result: WarRoomResult, portfolio: PortfolioRiskContext): ExecutionRequest | null {
  if (process.env.PAPER_EXPLORATION_MODE === "false") return null;
  if (result.decision !== "WATCH" || !result.risk.passed) return null;
  if (result.councilProcess.executorVote === "BLOCK") return null;
  if (explicitSecurityFailure(result)) return null;
  const minConviction = Number(process.env.PAPER_EXPLORATION_MIN_CONVICTION ?? 58);
  const minAlpha = Number(process.env.PAPER_EXPLORATION_MIN_ALPHA ?? 48);
  const requiredSupport = Math.max(3, result.councilProcess.requiredResearchSupport - 1);
  if (result.conviction < minConviction || result.alpha.score < minAlpha || result.councilProcess.researchSupport < requiredSupport) return null;
  if (result.snapshot.liquidity < 20_000) return null;

  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  if (portfolio.cashUsd + 0.005 < trainingTradeUsd) return null;
  const notionalUsd = Number(trainingTradeUsd.toFixed(2));`;
    const newExplore = `function explorationRequest(result: WarRoomResult, portfolio: PortfolioRiskContext): ExecutionRequest | null {
  if (process.env.PAPER_EXPLORATION_MODE === "false") return null;
  if (result.decision !== "WATCH" || !result.risk.passed) return null;
  if (result.councilProcess.executorVote === "BLOCK") return null;
  if (explicitSecurityFailure(result)) return null;
  // WATCH means the Council sees an opportunity but wants more proof. In PAPER mode
  // that is exactly the type of rep the Filing Cabinet needs. Do not re-run old Alpha/quorum filters.
  const minimumBuyUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  if (portfolio.cashUsd + 0.005 < minimumBuyUsd) return null;
  const notionalUsd = Number(Math.max(minimumBuyUsd, Math.min(result.runnerGenome?.suggestedTradeUsd ?? minimumBuyUsd, Number(process.env.PAPER_WATCH_MAX_BUY_USD ?? 100))).toFixed(2));`;
    // Structural replacement for the WATCH/probe gate. Previous versions changed
    // the notional-sizing lines, so exact full-block matching is intentionally avoided.
    if (!text.includes("Do not re-run old Alpha/quorum filters.")) {
      const exploreHeader = 'function explorationRequest(result: WarRoomResult, portfolio: PortfolioRiskContext): ExecutionRequest | null {';
      const exploreAt = text.indexOf(exploreHeader);
      const exploreReturnAt = exploreAt >= 0 ? text.indexOf('  return {\\n    mode: "paper",', exploreAt + exploreHeader.length) : -1;
      if (exploreAt < 0 || exploreReturnAt < 0) fail("Could not find structural boundary: WATCH becomes active training opportunity");
      text = text.slice(0, exploreAt) + newExplore + "\\n" + text.slice(exploreReturnAt);
    }
    text = replaceRequired(text, '    maxSlippageBps: 135,', '    maxSlippageBps: result.runnerGenome?.earlyRunnerZone ? Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600) : 135,', "WATCH early-runner slippage");

    const oldPromise = `  const [learning, memoryHints, profitability, portfolio] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
    getPaperPortfolioContext(snapshot.chain),
  ]);`;
    const newPromise = `  const [learning, memoryHints, profitability, portfolio, runnerGenome] = await Promise.all([
    resolveAdaptiveWeights(regime, snapshot),
    relevantMemoryHints(snapshot, regime.id),
    loadLatestProfitability(),
    getPaperPortfolioContext(snapshot.chain),
    getRunnerGenomeGuidance(snapshot),
  ]);`;
    text = replaceRequired(text, oldPromise, newPromise, "load active Runner Genome before Council");
    text = replaceRequired(text, '    profitability,\n    portfolio,', '    profitability,\n    portfolio,\n    runnerGenome,', "pass Runner Genome to engine");
    text = replaceRequired(text, '    else recordRejection("WATCH did not reach paper-exploration threshold");', '    else recordRejection("WATCH opportunity could not execute because a hard safety/cash condition blocked the paper rep");', "WATCH rejection wording");
    text = text.replace('V2.14 Runner Genome research council started.', 'V2.25 Early Runner Core started.');
    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      'import { reflectOnClosedPosition } from "./reflection";',
      'import { reflectOnClosedPosition } from "./reflection";\nimport { getRunnerExitGuidance } from "./runner-research";',
      "Exit Genome import"
    );
    text = replaceRequired(text, 'import type { ExecutionRequest, ExitLevel, ExitStrategy, ManagedPosition, MarketSnapshot, PaperFill, PortfolioRiskContext, PositionAction, PositionEntryContext, PositionGuardianReport, WarRoomResult } from "./types";', 'import type { ExecutionRequest, ExitLevel, ExitStrategy, ManagedPosition, MarketSnapshot, PaperFill, PortfolioRiskContext, PositionAction, PositionEntryContext, PositionGuardianReport, RunnerExitGenomeGuidance, WarRoomResult } from "./types";', "Exit Genome type import");
    text = replaceRequired(text, '    maxSlippageBps: side === "BUY" ? 135 : suffix === "EXIT" ? 9000 : 750,', '    maxSlippageBps: side === "BUY" ? Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600) : suffix === "EXIT" ? 9000 : 750,', "scale-in early runner slippage");

    const oldScale = `  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);
  const capPct = maxGrossExposurePct(position);
  const trainingTradeUsd = Math.max(1, Number(process.env.PAPER_TRAINING_TRADE_USD ?? 50));
  const requestedUsd = Math.min(trainingTradeUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd + 0.005 < trainingTradeUsd) {
    return {
      ...position,
      pendingScaleLabel: undefined,
      lastAction: "HOLD",
      lastReason: \`Scale-in signal remains valid, but only $\${portfolio.cashUsd.toFixed(2)} paper cash is available. Waiting for an exit before the next fixed $\${trainingTradeUsd.toFixed(2)} add.\`,
    };
  }`;
    const newScale = `  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);
  const capPct = maxGrossExposurePct(position);
  const minimumAddUsd = Math.max(1, Number(process.env.PAPER_TRAINING_MIN_BUY_USD ?? 50));
  const maxAddUsd = Math.max(minimumAddUsd, Number(process.env.PAPER_WINNER_MAX_ADD_USD ?? 100));
  const entryGenomeScore = position.entryContext?.runnerGenome?.entryScore ?? 60;
  const genomeAddTarget = entryGenomeScore >= 88 ? 100 : entryGenomeScore >= 78 ? 75 : minimumAddUsd;
  const exposureRoomUsd = Math.max(0, portfolio.equityUsd * capPct / 100 - position.entryNotionalUsd);
  const requestedUsd = Math.min(maxAddUsd, Math.max(minimumAddUsd, genomeAddTarget), exposureRoomUsd, Math.max(0, portfolio.cashUsd));
  if (requestedUsd + 0.005 < minimumAddUsd) {
    return {
      ...position,
      pendingScaleLabel: undefined,
      lastAction: "HOLD",
      lastReason: \`Winner add remains valid, but only $\${portfolio.cashUsd.toFixed(2)} paper cash is available. Waiting for $\${minimumAddUsd.toFixed(2)}+ cash.\`,
    };
  }`;
    // Structural replacement for the winner-add sizing block. Keep the fill and
    // accounting code below it untouched.
    if (!text.includes("const genomeAddTarget = entryGenomeScore >= 88 ? 100 : entryGenomeScore >= 78 ? 75 : minimumAddUsd;")) {
      const scaleStart = text.indexOf('  const initialNotional = Math.max(0.01, position.initialNotionalUsd ?? position.entryNotionalUsd);');
      const scaleFillAt = scaleStart >= 0 ? text.indexOf('  const fill = await executePaper(', scaleStart) : -1;
      if (scaleStart < 0 || scaleFillAt < 0) fail("Could not find structural boundary: dynamic winner adds");
      text = text.slice(0, scaleStart) + newScale + "\\n\\n" + text.slice(scaleFillAt);
    }

    text = replaceRequired(
      text,
      'export function evaluatePosition(positionInput: ManagedPosition, snapshot: MarketSnapshot, portfolio?: PortfolioRiskContext): ManagedPosition {',
      'export function evaluatePosition(positionInput: ManagedPosition, snapshot: MarketSnapshot, portfolio?: PortfolioRiskContext, exitGenome?: RunnerExitGenomeGuidance): ManagedPosition {',
      "evaluatePosition Exit Genome option"
    );
    text = replaceRequired(
      text,
      '  const controls = effectiveGuardianControls(position, winnerState);',
      `  const controls = effectiveGuardianControls(position, winnerState);
  const genomeTrailingStopPct = exitGenome ? Math.max(6, Math.min(40, exitGenome.trailingStopPct)) : controls.trailingStopPct;
  const genomeMaxHoldMinutes = exitGenome ? Math.max(15, controls.maxHoldMinutes * exitGenome.maxHoldMultiplier) : controls.maxHoldMinutes;`,
      "adaptive Exit Genome controls"
    );
    text = replaceRequired(text, '  const trailTriggered = rawMovePct > 0 && drawdownFromHigh >= controls.trailingStopPct;', '  const trailTriggered = rawMovePct > 0 && drawdownFromHigh >= genomeTrailingStopPct;', "Exit Genome trailing stop");
    text = replaceRequired(text, '  const timeTriggered = heldMinutes >= controls.maxHoldMinutes;', '  const timeTriggered = heldMinutes >= genomeMaxHoldMinutes;', "Exit Genome max hold");
    text = replaceRequired(text, '  let lastReason = `${winnerState.toUpperCase()} · confirmation ${confirmation.toFixed(0)}/100 · portfolio PnL ${currentPnl.toFixed(1)}% · high-water drawdown ${drawdownFromHigh.toFixed(1)}%.`;', '  let lastReason = `${winnerState.toUpperCase()} · confirmation ${confirmation.toFixed(0)}/100 · portfolio PnL ${currentPnl.toFixed(1)}% · high-water drawdown ${drawdownFromHigh.toFixed(1)}%. ${exitGenome ? exitGenome.reason : ""}`;', "Exit Genome reason");
    text = replaceRequired(
      text,
      '  if (securityTriggered || authorityTriggered || liquidityTriggered) {',
      '  const genomeExitTriggered = exitGenome?.action === "EXIT";\n\n  if (securityTriggered || authorityTriggered || liquidityTriggered) {',
      "Exit Genome trigger declaration"
    );
    text = replaceRequired(
      text,
      '  } else if (stopTriggered) {',
      '  } else if (genomeExitTriggered) {\n    lastAction = "EXIT";\n    status = "exit_pending";\n    lastReason = exitGenome?.reason ?? "Exit Genome invalidated runner continuation.";\n  } else if (stopTriggered) {',
      "Exit Genome learned exit"
    );
    text = replaceRequired(text, '      snapshot = await fetchLivePositionSnapshot(position);\n      if (snapshot) {\n        const portfolio = await getPaperPortfolioContext(position.chain);\n        next = evaluatePosition(position, snapshot, portfolio);', '      snapshot = await fetchLivePositionSnapshot(position);\n      if (snapshot) {\n        const portfolio = await getPaperPortfolioContext(position.chain);\n        const exitGenome = await getRunnerExitGuidance(position, snapshot);\n        next = evaluatePosition(position, snapshot, portfolio, exitGenome);', "run Exit Genome on every Guardian mark");
    return text;
  });

  patchFile(root, "lib/debate.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '      message: `I\'ve heard all six isolated research reads and the rebuttals. Research support is ${result.councilProcess.researchSupport}/6, Alpha evidence is ${result.alpha.score}/100, and council conviction is ${result.councilConviction}%. My synthesis is ${result.councilProcess.cioVote} at ${result.conviction}%. ${cio.summary} ${cio.detail}`,',
      '      message: `I\'ve heard all six isolated reads and the rebuttals. Runner Genome is ${result.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${result.runnerGenome.dumperRiskScore.toFixed(0)}/100 from ${result.runnerGenome.sampleSize} labeled cases. Research support is ${result.councilProcess.researchSupport}/6 and council conviction is ${result.councilConviction}%. My synthesis is ${result.councilProcess.cioVote} at ${result.conviction}%. ${cio.summary} ${cio.detail}`,',
      "CIO Runner Genome debate"
    );
    text = text.replace('A good narrative cannot overrule safety.', 'A runner thesis cannot overrule a specific hard safety failure.');
    text = text.replace('My downside thesis was formed before the meeting.', 'My dumper-pattern thesis was formed before the meeting.');
    text = text.replace('I only want the trade if the numbers still work after the risk challenge.', 'I want the entry only if live runner-pattern data still works after the dumper challenge.');
    text = text.replace('Executor is the eighth active council role: it validates route, liquidity and order feasibility', 'Executor is deterministic execution infrastructure: it validates route, liquidity and order feasibility');
    return text;
  });

  console.log("[v2.25-early-runner-core] Early Runner Core active: merged discovery, $10K-$50K priority, learned Entry Genome, adaptive $50+ sizing, Exit Genome, active WATCH training, and paper-only research freedom.");
}
