export type Decision = "BUY" | "WATCH" | "SKIP" | "EXIT";
export type Stance = "bullish" | "neutral" | "bearish" | "ready";
export type TradingMode = "paper" | "live";

export type Chain =
  | "Solana"
  | "Ethereum"
  | "Base"
  | "BNB Chain"
  | "Monad"
  | "HyperEVM"
  | "Robinhood Chain";

export type ChainFamily = "solana" | "evm";


export type DataQuality = {
  sellability: boolean;
  honeypot: boolean;
  taxes: boolean;
  holders: boolean;
  top10: boolean;
  liquidityLock: boolean;
  authorities: boolean;
  ownership: boolean;
  bundled: boolean;
  smartMoney: boolean;
  socialVelocity: boolean;
  routeFeasibility?: boolean;
};

export type DataProvenance = {
  live: boolean;
  marketSource: "adapter" | "birdeye" | "geckoterminal" | "dexscreener";
  securitySource: "birdeye" | "goplus" | "helius" | "multi" | "adapter" | "unavailable";
  fetchedAt: string;
  pairAddress?: string;
  quality: DataQuality;
  notes?: string[];
};

export type MarketContext = {
  benchmark24hPct?: number;
  benchmark7dPct?: number;
  marketBreadthPct?: number;
  chainVolumeChangePct?: number;
  newPairs1h?: number;
  newPairsChangePct?: number;
  fearGreed?: number;
};


export type LaunchMetrics = {
  holdersPerMinute?: number;
  transactionsPerMinute?: number;
  uniqueBuyersPerMinute?: number;
  volumeUsdPerMinute?: number;
  liquidityAddedUsdPerMinute?: number;
  holderAccelerationPct?: number;
  transactionAccelerationPct?: number;
  volumeAccelerationPct?: number;
};

export type MarketSnapshot = {
  symbol: string;
  name: string;
  imageUrl?: string;
  tokenAddress: string;
  chain: Chain;
  chainFamily: ChainFamily;
  venue: string;
  price: number;
  priceChange24h: number;
  marketCap: number;
  liquidity: number;
  volume5m: number;
  volume24h: number;
  holders: number;
  ageMinutes: number;
  buySellRatio: number;
  smartMoneyBuys: number;
  smartMoneySells: number;
  socialVelocityPct: number;
  top10Pct: number;
  bundledPct: number;
  devRugHistory: number;
  volatility: number;
  sellable: boolean;
  honeypot: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  liquidityLocked: boolean;
  mintAuthority: boolean;
  freezeAuthority: boolean;
  ownershipRenounced: boolean;
  proxyContract: boolean;
  tokenDecimals?: number;
  volumeAccelerationPct?: number;
  holderGrowthPct?: number;
  liquidityChangePct?: number;
  marketCapChange5mPct?: number;
  context?: MarketContext;
  assetClass?: "meme" | "standard" | "unknown";
  launchMetrics?: LaunchMetrics;
  dataProvenance?: DataProvenance;
};

export type MarketRegimeId =
  | "meme_expansion"
  | "new_chain_mania"
  | "risk_on_trend"
  | "sideways_chop"
  | "high_volatility"
  | "risk_off"
  | "panic_crash"
  | "low_liquidity";

export type MarketRegime = {
  id: MarketRegimeId;
  label: string;
  confidence: number;
  tradeAllowed: boolean;
  minAlphaScore: number;
  minCouncilConviction: number;
  positionSizeMultiplier: number;
  reasons: string[];
};


export type MemeRegimeId =
  | "not_meme"
  | "meme_discovery"
  | "meme_breakout"
  | "meme_acceleration"
  | "meme_exhaustion"
  | "meme_unsafe";

export type MemeRegime = {
  id: MemeRegimeId;
  label: string;
  isMeme: boolean;
  likelihood: number;
  breakoutScore: number;
  launchVelocityScore: number;
  holdersPerMinute: number;
  volumeUsdPerMinute: number;
  entryAllowed: boolean;
  minAlphaScore: number;
  minCouncilConviction: number;
  requiredResearchSupport: number;
  starterPositionMultiplier: number;
  broadMarketModifier: number;
  reasons: string[];
};

export type RunnerGenomeGuidance = {
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
  rugSimilarityScore: number;
  rugSampleSize: number;
  rugAdvisory: "LOW" | "ELEVATED" | "HIGH";
  rugEvidence: string[];
  expectedPeakMultiple: number;
  expectedTimeToPeakMinutes: number;
  typicalRunnerDrawdownPct: number;
  trajectoryScore: number;
  trajectoryDumperRiskScore: number;
  trajectoryConfidence: number;
  trajectoryPhase: "INSUFFICIENT" | "IGNITION" | "ACCELERATION" | "PULLBACK" | "RECOVERY" | "DISTRIBUTION" | "STALLED";
  trajectorySampleSize: number;
  trajectoryChainSampleSize: number;
  trajectoryEvidence: string[];
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

export type CouncilProcess = {
  lane: "standard" | "meme" | "early-runner";
  researchSupport: number;
  requiredResearchSupport: number;
  cioVote: Decision;
  executorVote: "READY" | "REDUCE" | "BLOCK";
  alignedBots: number;
  totalBots: 8;
  reasons: string[];
};

export type AlphaComponent = {
  name: string;
  score: number;
  weight: number;
  note: string;
};

export type AlphaSignal = {
  score: number;
  action: "TRADE" | "CAUTION" | "NO_TRADE";
  rewardRiskProxy: number;
  asymmetryScore: number;
  components: AlphaComponent[];
  reasons: string[];
};

export type AgentId =
  | "launch"
  | "social"
  | "wallet"
  | "quant"
  | "contract"
  | "bear"
  | "portfolio"
  | "cio"
  | "executor";

export type ResearchAgentId = Exclude<AgentId, "cio" | "executor" | "portfolio">;


export type CouncilEntityId = "launch" | "social" | "wallet" | "quant" | "contract" | "bear" | "portfolio" | "cio";

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
  teamId?: string;
  teamName?: string;
  memoryNamespace?: string;
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

export type AgentOpinion = {
  id: AgentId;
  name: string;
  shortName: string;
  score: number;
  stance: Stance;
  summary: string;
  detail: string;
  evidence: string[];
  color: string;
};

export type IndependentAgentRead = {
  agentId: ResearchAgentId;
  score: number;
  stance: Stance;
  thesis: string;
  evidence: string[];
  memoryHints?: string[];
  formedAt: string;
};

export type ResearchAgentWeights = Record<ResearchAgentId, number>;

export type ExitLevel = {
  gainPct: number;
  sellPct: number;
  label: string;
};

export type ExitStrategy = {
  stopLossPct: number;
  trailingStopPct: number;
  takeProfits: ExitLevel[];
  maxHoldMinutes: number;
  liquidityFloorUsd: number;
  invalidationRules: string[];
  emergencyRules: string[];
  moonbagPct?: number;
  winnerActivationPct?: number;
  winnerTrailingStopPct?: number;
  winnerMaxHoldMinutes?: number;
  moonbagTrailingStopPct?: number;
  moonbagMaxHoldMinutes?: number;
  breakEvenBufferPct?: number;
};

export type PortfolioRiskContext = {
  equityUsd: number;
  cashUsd: number;
  dailyPnlPct: number;
  openPositions: number;
  totalExposurePct: number;
  chainExposurePct: number;
  strategyExposurePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  maxTotalExposurePct: number;
  maxChainExposurePct: number;
  liveTradingEnabled: boolean;
};

export type RiskCheck = {
  passed: boolean;
  hardBlocks: string[];
  warnings: string[];
  passedChecks: string[];
  maxPositionPct: number;
  riskScore: number;
};

export type ExperimentStage = "research" | "backtest" | "oos" | "paper" | "live" | "paused" | "rejected";

export type ExperimentMetrics = {
  trades: number;
  winRatePct: number;
  expectancyPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  slippageBps: number;
};

export type ProfitabilityMetrics = ExperimentMetrics & {
  startingEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  sharpe: number;
  positiveFoldPct: number;
  baselineReturnPct: number;
  excessReturnPct: number;
  monteCarloMedianReturnPct: number;
  ruinProbabilityPct: number;
  source: "historical" | "paper" | "demo" | "none";
  generatedAt: string;
};

export type StrategyExperiment = {
  id: string;
  name: string;
  hypothesis: string;
  stage: ExperimentStage;
  version: number;
  chains: Chain[];
  metrics: ExperimentMetrics;
  profitability?: ProfitabilityMetrics;
  promotionReady: boolean;
  promotionReasons: string[];
};

export type ExecutionRequest = {
  mode: TradingMode;
  chain: Chain;
  tokenAddress: string;
  symbol: string;
  side: "BUY" | "SELL";
  notionalUsd: number;
  maxSlippageBps: number;
  strategyId: string;
  decisionId: string;
};

export type ExecutionPlan = {
  allowed: boolean;
  mode: TradingMode;
  request?: ExecutionRequest;
  reason: string;
  allocationMultiplier?: number;
};

export type PaperFill = {
  id: string;
  chain: Chain;
  symbol: string;
  side: "BUY" | "SELL";
  requestedUsd: number;
  filledUsd: number;
  fillPrice: number;
  slippageBps: number;
  feeUsd: number;
  routeVerified?: boolean;
  routeProvider?: "jupiter" | "zeroex" | "security" | "unsupported" | "liquidity-model";
  routeNote?: string;
  createdAt: string;
};

export type AgentMemoryRecord = {
  id: string;
  agentId: ResearchAgentId;
  regimeId: MarketRegimeId;
  chain: Chain;
  marketCapBucket: string;
  ageBucket: string;
  entryScore: number;
  entryThesis: string;
  realizedReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  reasoningOutcome: "supported" | "unsupported" | "unclear";
  lesson: string;
  createdAt: string;
};

export type PositionEntryContext = {
  snapshot: MarketSnapshot;
  regime: MarketRegime;
  memeRegime?: MemeRegime;
  councilProcess?: CouncilProcess;
  alpha: AlphaSignal;
  preMeeting: IndependentAgentRead[];
  agentWeights: ResearchAgentWeights;
  decision: Decision;
  conviction: number;
  runnerGenome?: RunnerGenomeGuidance;
  independentCouncil?: IndependentCouncilTrace;
  riskMaxPositionPct?: number;
  initialAllocationPct?: number;
  portfolioEquityUsd?: number;
};

export type WinnerState = "building" | "confirmed" | "runner" | "moonbag";

export type PositionScaleFill = {
  label: string;
  filledUsd: number;
  fillPrice: number;
  confirmationScore: number;
  alphaScore: number;
  councilConviction: number;
  createdAt: string;
};

export type PositionAction = "HOLD" | "SCALE_IN" | "TRIM" | "EXIT";
export type PositionStatus = "open" | "exit_pending" | "unsellable" | "closed";

export type ManagedPosition = {
  id: string;
  chain: Chain;
  tokenAddress: string;
  symbol: string;
  imageUrl?: string;
  strategyId: string;
  decisionId: string;
  mode: TradingMode;
  status: PositionStatus;
  quantity: number;
  remainingQuantity: number;
  initialQuantity?: number;
  entryPrice: number;
  initialEntryPrice?: number;
  markPrice: number;
  highWaterPrice: number;
  lowWaterPrice: number;
  entryNotionalUsd: number;
  initialNotionalUsd?: number;
  remainingNotionalUsd: number;
  realizedProceedsUsd: number;
  realizedCostUsd: number;
  realizedPnlUsd: number;
  pnlPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  profitCapturePct: number;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
  unsellableAt?: string;
  unsellableReason?: string;
  lockedCapitalLossUsd?: number;
  lastMarketDataAt?: string;
  lastAction: PositionAction;
  lastReason: string;
  takenProfitLabels: string[];
  winnerState?: WinnerState;
  moonbagStartedAt?: string;
  forcedExitReleaseVersion?: number;
  scaleIns?: PositionScaleFill[];
  lastConfirmationScore?: number;
  maxGrossExposurePct?: number;
  reentryCount?: number;
  breakEvenArmed?: boolean;
  lastHighWaterAt?: string;
  peakPnlPct?: number;
  exitStrategistScore?: number;
  exitStrategistReason?: string;
  sellAuditStatus?: "pass" | "fail" | "unknown";
  sellAuditProvider?: "jupiter" | "zeroex" | "security" | "unsupported";
  sellAuditCheckedAt?: string;
  sellAuditReason?: string;
  sellAuditPriceImpactPct?: number;
  sellAuditExpectedOutUsd?: number;
  sellAuditConsecutiveFailures?: number;
  sellAuditConsecutiveUnknowns?: number;
  pendingScaleLabel?: string;
  learningRecorded?: boolean;
  exitStrategy: ExitStrategy;
  entryContext?: PositionEntryContext;
};

export type PositionGuardianReport = {
  storage: "redis" | "memory";
  openCount: number;
  urgentCount: number;
  positions: ManagedPosition[];
  generatedAt: string;
  warning?: string;
};

export type PaperWalletFillRecord = {
  id: string;
  positionId?: string;
  decisionId: string;
  chain: Chain;
  tokenAddress: string;
  symbol: string;
  side: "BUY" | "SELL";
  requestedUsd: number;
  filledUsd: number;
  fillPrice: number;
  feeUsd: number;
  slippageBps: number;
  routeVerified?: boolean;
  routeProvider?: "jupiter" | "zeroex" | "security" | "unsupported" | "liquidity-model";
  routeNote?: string;
  createdAt: string;
  action?: "ENTRY" | "SCALE_IN" | "TRIM" | "EXIT";
  quantity?: number;
  remainingQuantityAfter?: number;
  cashAfterUsd?: number;
  portfolioEquityAfterUsd?: number;
  positionRealizedPnlAfterUsd?: number;
  nextTargetPrice?: number;
  moonbagExitFloorPrice?: number;
};

export type PaperEquityHistoryPoint = {
  at: number;
  equity: number;
  cash: number;
  openValue: number;
  event?: "mark" | "peak" | "low" | "reset";
};

export type PaperWalletState = {
  version: 1;
  startingCashUsd: number;
  cashUsd: number;
  totalFeesUsd: number;
  buyFills: number;
  sellFills: number;
  startedAt: string;
  updatedAt: string;
  dayKey: string;
  dayStartEquityUsd: number;
  /** Extra PAPER capital added after the run started; excluded from profit. */
  capitalContributionsUsd?: number;
  equityHistory?: PaperEquityHistoryPoint[];
  allTimeHighEquityUsd?: number;
  allTimeHighAt?: string;
  allTimeLowEquityUsd?: number;
  allTimeLowAt?: string;
  recentFills: PaperWalletFillRecord[];
};

export type PaperWalletSnapshot = PaperWalletState & {
  equityUsd: number;
  openExposureUsd: number;
  openCostUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  totalPnlUsd: number;
  totalReturnPct: number;
  dailyPnlPct: number;
  openPositions: number;
  unsellablePositions: number;
  lockedCapitalLossUsd: number;
  storage: "redis" | "memory";
  accountingVerified: boolean;
  accountingVerifiedAt: string;
};

export type ProviderHealth = {
  name: "birdeye" | "geckoterminal" | "dexscreener" | "goplus" | "helius" | "jupiter" | "redis";
  configured: boolean;
  ok: boolean;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
};

export type AgentPerformance = {
  agentId: ResearchAgentId;
  regimeId: MarketRegimeId;
  segmentKey: string;
  observations: number;
  correct: number;
  directionalAccuracyPct: number;
  reasoningAccuracyPct: number;
  avgEdgePct: number;
  weight: number;
};

export type LearningSnapshot = {
  storage: "redis" | "memory";
  regimeId: MarketRegimeId;
  weights: ResearchAgentWeights;
  performance: AgentPerformance[];
  memories: number;
  recentLessons: string[];
  weeklyFeedback: string[];
  generatedAt: string;
};

export type HistoricalMark = {
  timestamp: string;
  price: number;
  liquidity?: number;
  sellable?: boolean;
  honeypot?: boolean;
  top10Pct?: number;
  bundledPct?: number;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
};

export type HistoricalFrame = {
  timestamp: string;
  snapshot: MarketSnapshot;
  futureReturnPct?: number;
  baselineReturnPct?: number;
  futurePath?: HistoricalMark[];
};

export type ProfitabilityBenchmarkReport = {
  metrics: ProfitabilityMetrics;
  foldReturnsPct: number[];
  tradeReturnsPct: number[];
  warnings: string[];
};

export type WarRoomResult = {
  decisionId: string;
  snapshot: MarketSnapshot;
  regime: MarketRegime;
  memeRegime: MemeRegime;
  runnerGenome: RunnerGenomeGuidance;
  independentCouncil?: IndependentCouncilTrace;
  councilProcess: CouncilProcess;
  alpha: AlphaSignal;
  preMeeting: IndependentAgentRead[];
  agents: AgentOpinion[];
  agentWeights: ResearchAgentWeights;
  learningSource: "defaults" | "regime" | "learned";
  decision: Decision;
  consensus: number;
  conviction: number;
  councilConviction: number;
  risk: RiskCheck;
  experiment: StrategyExperiment;
  exitStrategy: ExitStrategy;
  execution: ExecutionPlan;
  auditTrail: string[];
  generatedAt: string;
  reasoningCompletedAt: string;
};
