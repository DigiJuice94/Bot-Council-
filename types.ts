export type Decision = "BUY" | "WATCH" | "SKIP" | "EXIT";
export type Stance = "bullish" | "neutral" | "bearish" | "ready";
export type TradingMode = "paper" | "live";

export type Chain =
  | "Solana"
  | "Ethereum"
  | "Base"
  | "BNB Chain"
  | "Monad"
  | "Robinhood Chain";

export type ChainFamily = "solana" | "evm";

export type MarketSnapshot = {
  symbol: string;
  name: string;
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
};

export type AgentId =
  | "launch"
  | "social"
  | "wallet"
  | "quant"
  | "contract"
  | "bear"
  | "cio"
  | "executor";

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

export type StrategyExperiment = {
  id: string;
  name: string;
  hypothesis: string;
  stage: ExperimentStage;
  version: number;
  chains: Chain[];
  metrics: ExperimentMetrics;
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
  createdAt: string;
};

export type WarRoomResult = {
  decisionId: string;
  snapshot: MarketSnapshot;
  agents: AgentOpinion[];
  decision: Decision;
  consensus: number;
  conviction: number;
  risk: RiskCheck;
  experiment: StrategyExperiment;
  execution: ExecutionPlan;
  auditTrail: string[];
  generatedAt: string;
};
