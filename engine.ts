import { runHardRiskChecks } from "./risk";
import type { AgentOpinion, Decision, MarketSnapshot, WarRoomResult } from "./types";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const stance = (score: number): AgentOpinion["stance"] => score >= 70 ? "bullish" : score >= 45 ? "neutral" : "bearish";

function agent(id: AgentOpinion["id"], name: string, shortName: string, score: number, summary: string, detail: string, color: string): AgentOpinion {
  return { id, name, shortName, score: clamp(score), stance: stance(score), summary, detail, color };
}

export function runWarRoom(snapshot: MarketSnapshot): WarRoomResult {
  const risk = runHardRiskChecks(snapshot);

  const launchScore = 48
    + Math.min(20, snapshot.priceChange24h * 0.45)
    + Math.min(17, snapshot.volume5m / 4000)
    + (snapshot.ageMinutes < 180 ? 8 : 2);

  const socialScore = 45 + Math.min(45, snapshot.socialVelocityPct / 6);
  const walletScore = 50 + snapshot.smartMoneyBuys * 6 - snapshot.smartMoneySells * 7;
  const quantScore = 45
    + (snapshot.buySellRatio - 1) * 24
    + Math.min(18, snapshot.priceChange24h * 0.4)
    - snapshot.volatility * 9;

  let contractScore = 92 - Math.max(0, snapshot.top10Pct - 20) * 0.55 - snapshot.bundledPct * 0.7;
  if (!risk.passed) contractScore = 5;

  const bearPressure = 18
    + snapshot.volatility * 30
    + Math.max(0, snapshot.top10Pct - 30) * 0.8
    + Math.max(0, snapshot.bundledPct - 8) * 1.4
    + (snapshot.liquidity < 50000 ? 22 : 0)
    + snapshot.devRugHistory * 28;
  const bearInFavor = 100 - bearPressure;

  const core = [launchScore, socialScore, walletScore, quantScore, contractScore, bearInFavor].map(clamp);
  const weighted = (
    core[0] * 0.13 +
    core[1] * 0.10 +
    core[2] * 0.18 +
    core[3] * 0.22 +
    core[4] * 0.27 +
    core[5] * 0.10
  );

  const conviction = risk.passed ? clamp(weighted) : 0;
  let decision: Decision = "SKIP";
  if (risk.passed && conviction >= 78) decision = "BUY";
  else if (risk.passed && conviction >= 58) decision = "WATCH";

  const directionalVotes = core.filter((s) => s >= 58).length;
  const consensus = risk.passed ? directionalVotes : 0;

  const agents: AgentOpinion[] = [
    agent("launch", "Launch Scout", "LS", launchScore,
      launchScore >= 70 ? "Early momentum is building." : "Launch momentum is mixed.",
      `5m volume $${Math.round(snapshot.volume5m).toLocaleString()} · age ${snapshot.ageMinutes}m`, "#ffb13b"),
    agent("social", "Social Scout", "SS", socialScore,
      socialScore >= 70 ? "Social velocity is accelerating." : "Social traction is not decisive.",
      `Mention velocity ${Math.round(snapshot.socialVelocityPct)}% vs baseline`, "#b05cff"),
    agent("wallet", "Wallet Tracker", "WT", walletScore,
      walletScore >= 70 ? "Smart money is net accumulating." : "Wallet flow needs confirmation.",
      `${snapshot.smartMoneyBuys} tracked buys · ${snapshot.smartMoneySells} tracked sells`, "#29e693"),
    agent("quant", "Quant Bot", "QB", quantScore,
      quantScore >= 70 ? "Momentum and flow align." : "Risk/reward is not clean yet.",
      `Buy/sell ${snapshot.buySellRatio.toFixed(2)}x · volatility ${(snapshot.volatility * 100).toFixed(0)}%`, "#28c9ff"),
    agent("contract", "Contract Bot", "CB", contractScore,
      risk.passed ? "Core contract checks passed." : "Hard safety veto triggered.",
      risk.passed ? `Top 10 ${snapshot.top10Pct.toFixed(1)}% · bundles ${snapshot.bundledPct.toFixed(1)}%` : risk.hardBlocks[0], "#ffd34f"),
    agent("bear", "Bear Bot", "BB", bearInFavor,
      bearInFavor >= 58 ? "No fatal bear case found." : "Downside case is too strong.",
      risk.warnings[0] ?? "Watching liquidity, volatility and concentration", "#ff5f6d"),
    {
      id: "cio", name: "CIO", shortName: "CIO", score: conviction,
      stance: conviction >= 70 ? "bullish" : conviction >= 45 ? "neutral" : "bearish",
      summary: risk.passed ? `${decision}: ${consensus}/6 research agents support the setup.` : "SKIP: deterministic risk layer vetoed the trade.",
      detail: risk.passed ? `Max paper allocation ${risk.maxPositionPct.toFixed(2)}%` : `${risk.hardBlocks.length} hard block(s)`,
      color: "#70a8ff"
    },
    {
      id: "executor", name: "Executor", shortName: "EX", score: risk.passed ? conviction : 0,
      stance: "ready",
      summary: decision === "BUY" ? "Paper order is ready for approval." : "Standing by. No order will be sent.",
      detail: "V1 executor is paper-only; wallet signing is disabled", color: "#52f6c6"
    },
  ];

  return {
    snapshot,
    agents,
    decision,
    consensus,
    conviction,
    risk,
    generatedAt: new Date().toISOString(),
  };
}
