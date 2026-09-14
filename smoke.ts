import { runWarRoom } from "../lib/engine";
import { classifyMarketRegime } from "../lib/regime";
import { createBaseSnapshot } from "../lib/mock-market";
import { executePaper } from "../lib/execution";
import { runProfitabilityBenchmark } from "../lib/backtest";
import { nextScaleStep } from "../lib/position-policy";
import type { HistoricalFrame, ManagedPosition, WarRoomResult } from "../lib/types";

async function main() {
  const chains = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"] as const;
  for (const chain of chains) {
    const snapshot = createBaseSnapshot(chain);
    const result = runWarRoom(snapshot);
    if (result.agents.length !== 8) throw new Error(`${chain}: expected 8 council agents`);
    if (result.preMeeting.length !== 6) throw new Error(`${chain}: expected six isolated research reads`);
    if (!result.alpha || !result.regime || !result.memeRegime) throw new Error(`${chain}: alpha/regime/meme layer missing`);
    if (!result.councilProcess || result.councilProcess.totalBots !== 8) throw new Error(`${chain}: eight-bot decision process missing`);
    if (!result.risk.passed) throw new Error(`${chain}: demo snapshot should pass deterministic risk`);
    if (result.execution.allowed && result.execution.request) {
      const fill = await executePaper(result.execution.request, result.snapshot);
      if (fill.chain !== chain) throw new Error(`${chain}: paper fill routed to wrong chain`);
    }
  }

  const favorable = createBaseSnapshot("Base");
  favorable.context = { benchmark24hPct: 4, benchmark7dPct: 8, chainVolumeChangePct: 25, newPairsChangePct: 10 };
  favorable.liquidity = Math.max(favorable.liquidity, favorable.marketCap * 0.05, 100_000);
  favorable.volatility = Math.min(favorable.volatility, 0.55);
  const favorableRegime = classifyMarketRegime(favorable);
  if (favorableRegime.id !== "risk_on_trend") throw new Error(`Expected risk_on_trend, got ${favorableRegime.id}`);
  if (favorableRegime.minAlphaScore !== 59 || favorableRegime.minCouncilConviction !== 65) throw new Error("V2.10 must retain the V2.7 risk-on gate at 59/65");


  const favorableResult = runWarRoom(favorable);
  const moonbagPct = favorableResult.exitStrategy.moonbagPct ?? 0;
  const distributedPct = favorableResult.exitStrategy.takeProfits.reduce((sum, level) => sum + level.sellPct, 0);
  if (moonbagPct < 10 || moonbagPct > 20) throw new Error(`Expected a 10-20% moonbag, got ${moonbagPct}%`);
  if (Math.abs(distributedPct + moonbagPct - 100) > 0.001) throw new Error(`TP distribution ${distributedPct}% + moonbag ${moonbagPct}% must equal 100%`);
  if ((favorableResult.exitStrategy.winnerMaxHoldMinutes ?? 0) <= favorableResult.exitStrategy.maxHoldMinutes) throw new Error("Winner hold must extend the base hold window");

  const scaleSnapshot = {
    ...favorable,
    price: 1.06,
    liquidity: 200_000,
    buySellRatio: 1.6,
    smartMoneyBuys: 8,
    smartMoneySells: 1,
    volumeAccelerationPct: 180,
  };
  const fakeFresh = {
    decision: "BUY", conviction: 90, alpha: { action: "TRADE", score: 90 },
    risk: { passed: true }, regime: { id: "risk_on_trend" },
  } as unknown as WarRoomResult;
  const scalePosition = {
    quantity: 100, remainingQuantity: 100, entryPrice: 1, entryNotionalUsd: 100, initialNotionalUsd: 100,
    exitStrategy: favorableResult.exitStrategy, takenProfitLabels: [], scaleIns: [],
    entryContext: { snapshot: { ...scaleSnapshot, price: 1, liquidity: 200_000 }, alpha: { ...favorableResult.alpha, score: 82, action: "TRADE" }, conviction: 82 },
  } as unknown as ManagedPosition;
  const add = nextScaleStep(scalePosition, scaleSnapshot, fakeFresh, 90);
  if (add?.label !== "ADD1") throw new Error(`Expected ADD1 on a profitable reconfirmed position, got ${add?.label ?? "none"}`);
  const downSnapshot = { ...scaleSnapshot, price: 0.95 };
  if (nextScaleStep(scalePosition, downSnapshot, fakeFresh, 90)) throw new Error("V2.10 Winner Engine must never average down");

  const defensive = createBaseSnapshot("Base");
  defensive.context = { benchmark24hPct: -4, benchmark7dPct: -8 };
  defensive.priceChange24h = -14;
  defensive.liquidity = Math.max(defensive.liquidity, defensive.marketCap * 0.05, 100_000);
  defensive.volatility = Math.min(defensive.volatility, 0.55);
  const defensiveRegime = classifyMarketRegime(defensive);
  if (defensiveRegime.id !== "risk_off") throw new Error(`Expected risk_off, got ${defensiveRegime.id}`);
  if (defensiveRegime.minAlphaScore !== 82 || defensiveRegime.minCouncilConviction !== 84) throw new Error("Risk-off gate must remain unchanged at 82/84");

  const emberLike = {
    ...createBaseSnapshot("Solana"),
    symbol: "EMBER", name: "ember-like", venue: "Meteora", assetClass: "meme" as const,
    ageMinutes: 540, priceChange24h: 131, marketCap: 6_490_000, liquidity: 251_450,
    volume5m: 48_260, volume24h: 8_080_000, holders: 4_260, holderGrowthPct: 12.45,
    buySellRatio: 0.919, socialVelocityPct: 0, top10Pct: 18.8, bundledPct: 0, volatility: 0.75,
    smartMoneyBuys: 0, smartMoneySells: 0, volumeAccelerationPct: 0, marketCapChange5mPct: 2.25,
    mintAuthority: false, freezeAuthority: false, context: { benchmark24hPct: -2.21, benchmark7dPct: 0 },
  };
  const emberResult = runWarRoom(emberLike);
  if (emberResult.councilProcess.lane !== "meme") throw new Error("EMBER-like setup must use meme-native council lane");
  if (emberResult.councilProcess.researchSupport < emberResult.councilProcess.requiredResearchSupport) throw new Error("Meme BUY must require research quorum");
  if (emberResult.decision !== "BUY") throw new Error(`Expected meme-native EMBER-like BUY, got ${emberResult.decision}`);
  if (emberResult.councilProcess.executorVote === "BLOCK") throw new Error("Clean EMBER-like setup should be executable");

  const blocked = createBaseSnapshot("Base");
  blocked.honeypot = true;
  const blockedResult = runWarRoom(blocked);
  if (blockedResult.risk.passed) throw new Error("Honeypot must be vetoed");
  if (blockedResult.execution.allowed) throw new Error("Risk-vetoed trade must not create an order");

  const panic = createBaseSnapshot("Solana");
  panic.context = { benchmark24hPct: -12, benchmark7dPct: -26 };
  panic.priceChange24h = -38;
  panic.volatility = 0.92;
  const panicResult = runWarRoom(panic);
  if (panicResult.regime.tradeAllowed) throw new Error("Panic regime must block new entries");
  if (panicResult.decision === "BUY") throw new Error("Panic regime cannot produce BUY");

  const base = createBaseSnapshot("Solana");
  const frames: HistoricalFrame[] = Array.from({ length: 220 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
    snapshot: { ...base, symbol: `T${index}`, priceChange24h: 12 + (index % 10), buySellRatio: 1.4 + (index % 5) / 10 },
    futureReturnPct: index % 3 === 0 ? -8 : 12,
    baselineReturnPct: 0.05,
  }));
  const benchmark = runProfitabilityBenchmark(frames, { startingEquityUsd: 10_000, monteCarloRuns: 100 });
  if (!Number.isFinite(benchmark.metrics.totalReturnPct)) throw new Error("Profitability benchmark returned an invalid result");

  console.log("V2.8 smoke tests passed: V2.7 entry gates retained + moonbag + extended winner hold + confirmation-only ADD1 + no-average-down + unchanged defensive/hard vetoes + profitability benchmark.");
}

void main();
