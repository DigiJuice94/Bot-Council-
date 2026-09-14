export type Decision = "BUY" | "WATCH" | "SKIP" | "EXIT";
export type Stance = "bullish" | "neutral" | "bearish" | "ready";

export type MarketSnapshot = {
  symbol: string;
  name: string;
  chain: "Solana";
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
  mintAuthority: boolean;
  freezeAuthority: boolean;
  sellable: boolean;
  volatility: number;
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
  color: string;
};

export type RiskCheck = {
  passed: boolean;
  hardBlocks: string[];
  warnings: string[];
  maxPositionPct: number;
};

export type WarRoomResult = {
  snapshot: MarketSnapshot;
  agents: AgentOpinion[];
  decision: Decision;
  consensus: number;
  conviction: number;
  risk: RiskCheck;
  generatedAt: string;
};
