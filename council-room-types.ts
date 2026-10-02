/**
 * council-room-types.ts
 *
 * Shared contract between the Bot War Room data layer and the
 * CouncilRoomDashboard React components. These interfaces are implemented
 * verbatim — the dashboard never invents data, it only renders what the
 * data layer supplies through these shapes.
 */

export type MeetingTurn = {
  botId: string;
  botName: string;
  shortName: string;
  color: string;
  portrait: string;
  message: string;
  vote?: "BUY" | "WATCH" | "SKIP" | "EXIT" | "BLOCK" | "READY" | "REDUCE";
  confidence?: number;
  kind: "score" | "challenge" | "vote" | "verdict" | "veto" | "system";
  emoji?: string;
};

export type CouncilBotVM = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  portrait: string;
  role: string;
  mission: string;
  status: "LIVE" | "IDLE";
  latestVote?: string;
  latestConfidence?: number;
};

/** The coin the council is currently reviewing — the "NOW REVIEWING" spotlight. */
export type NowReviewing = {
  symbol: string;
  chain?: string;
  price: number | null;
  priceChange24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  ageMinutes: number | null;
  decision: string;
  conviction: number | null;
  at: string;
};

/** One row of the paper trade log (from GET /api/trade-log). */
export type TradeRow = {
  id: string;
  at: string;
  symbol: string;
  chain?: string;
  side: "BUY" | "SELL";
  action: string;
  sizeUsd: number | null;
  price: number | null;
  pnlUsd: number | null;
};

/** One open paper position for the portfolio panel. */
export type PositionRow = {
  id: string;
  symbol: string;
  chain?: string;
  sizeUsd: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  openedAt: string;
};

export type PortfolioData = {
  cashUsd: number | null;
  equityUsd: number | null;
  openExposureUsd: number | null;
  positions: PositionRow[];
};

export type CouncilRoomData = {
  meeting: {
    title: string;
    symbol?: string;
    chain?: string;
    at: string;
    decision: string;
    conviction: number;
    turns: MeetingTurn[];
  } | null;
  /** Coin currently under review (spotlight card). Null = nothing under review. */
  nowReviewing: NowReviewing | null;
  /** Recent paper trades from /api/trade-log. */
  trades: TradeRow[];
  /** Total trades stored server-side (for the "showing N of M" note). */
  tradesTotal: number | null;
  /** Portfolio: cash, equity, open positions. */
  portfolio: PortfolioData;
  bots: CouncilBotVM[];
  wallet: {
    equityUsd: number | null;
    cashUsd: number | null;
    realizedPnlUsd: number | null;
    unrealizedPnlUsd: number | null;
    unverifiedReservedCostUsd: number | null;
  };
  stats: { label: string; value: string }[];
  equitySeries: number[];
  statusNote: string;
};

/** Neutral starting value: every figure renders as "—" / empty state, never a guess. */
export const EMPTY_DATA: CouncilRoomData = {
  meeting: null,
  nowReviewing: null,
  trades: [],
  tradesTotal: null,
  portfolio: { cashUsd: null, equityUsd: null, openExposureUsd: null, positions: [] },
  bots: [],
  wallet: {
    equityUsd: null,
    cashUsd: null,
    realizedPnlUsd: null,
    unrealizedPnlUsd: null,
    unverifiedReservedCostUsd: null,
  },
  stats: [],
  equitySeries: [],
  statusNote: "",
};
