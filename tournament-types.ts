import type { Chain } from "./types";

export const TOURNAMENT_ROLES = ["launch", "social", "wallet", "quant", "contract", "bear", "portfolio", "cio"] as const;
export type TournamentRole = typeof TOURNAMENT_ROLES[number];
export type TournamentPhase = "qualifier" | "final" | "complete";

export type TournamentRolePerformance = {
  role: TournamentRole;
  trades: number;
  wins: number;
  losses: number;
  attributedPnlUsd: number;
  sourceTeamId?: string;
  sourceTeamName?: string;
};

export type TournamentPosition = {
  id: string;
  chain: Chain;
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  markPrice: number;
  highWaterPrice: number;
  initialQuantity: number;
  remainingQuantity: number;
  entryNotionalUsd: number;
  remainingCostUsd: number;
  realizedPnlUsd: number;
  openedAt: string;
  status: "open" | "closed" | "unsellable";
  closedAt?: string;
  lockedReason?: string;
  sellabilityFailureCount?: number;
  takenTargets: number[];
  stopLossPct: number;
  trailingStopPct: number;
  maxHoldMinutes: number;
  roleScores: Record<TournamentRole, number>;
  rolesSettled?: boolean;
};

export type TournamentTrade = {
  id: string;
  at: string;
  symbol: string;
  chain: Chain;
  action: "BUY" | "TRIM" | "SELL" | "LOCKED";
  quantity: number;
  price: number;
  valueUsd: number;
  pnlUsd: number;
  note: string;
};

export type TournamentTeam = {
  id: string;
  name: string;
  description: string;
  startingCashUsd: number;
  cashUsd: number;
  realizedPnlUsd: number;
  lockedCapitalLossUsd: number;
  totalTrades: number;
  positions: TournamentPosition[];
  trades: TournamentTrade[];
  rolePerformance: Record<TournamentRole, TournamentRolePerformance>;
  roleBias: Partial<Record<TournamentRole, number>>;
  thresholdDelta: number;
  sizeMultiplier: number;
  fileCabinet: boolean;
  draftSources?: Partial<Record<TournamentRole, { teamId: string; teamName: string; rank: number }>>;
};

export type TournamentState = {
  version: 1;
  phase: TournamentPhase;
  status: "running" | "winner" | "failed";
  createdAt: string;
  qualifierStartedAt: string;
  qualifierEndsAt: string;
  finalStartedAt?: string;
  finalEndsAt?: string;
  completedAt?: string;
  winnerTeamId?: string;
  failureReason?: string;
  opportunityCount: number;
  processedOpportunityIds: string[];
  teams: TournamentTeam[];
  qualifierArchive?: TournamentTeam[];
  fileCabinetEvidence: string[];
  lastOpportunityAt?: string;
  lastMarkRefreshAt?: string;
};

export type TournamentTeamView = TournamentTeam & {
  rank: number;
  openValueUsd: number;
  equityUsd: number;
  unrealizedPnlUsd: number;
  activeTrades: number;
  returnPct: number;
};

export type TournamentView = Omit<TournamentState, "teams" | "qualifierArchive"> & {
  teams: TournamentTeamView[];
  qualifierArchive?: TournamentTeamView[];
  roundLabel: string;
  generatedAt: string;
};
