import { buildExecutionPlan } from "./execution";
import { createCoreExperiment } from "./experiments";
import { DEFAULT_RISK_CONTEXT, runHardRiskChecks } from "./risk";
import type { AgentOpinion, Decision, MarketSnapshot, PortfolioRiskContext, TradingMode, WarRoomResult } from "./types";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const stance = (score: number): AgentOpinion["stance"] => score >= 70 ? "bullish" : score >= 45 ? "neutral" : "bearish";
function agent(id: AgentOpinion["id"], name: string, shortName: string, score: number, summary: string, detail: string, evidence: string[], color: string): AgentOpinion {
  return { id, name, shortName, score: clamp(score), stance: stance(score), summary, detail, evidence, color };
}

export function runWarRoom(snapshot: MarketSnapshot, options?: { mode?: TradingMode; portfolio?: PortfolioRiskContext }): WarRoomResult {
  const mode = options?.mode ?? "paper";
  const portfolio = options?.portfolio ?? DEFAULT_RISK_CONTEXT;
  const risk = runHardRiskChecks(snapshot, portfolio);
  const experiment = createCoreExperiment(["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"]);
  const decisionId = `DEC-${Date.now().toString(36).toUpperCase()}`;

  const launchScore = 48 + Math.min(20, snapshot.priceChange24h * 0.45) + Math.min(17, snapshot.volume5m / 4000) + (snapshot.ageMinutes < 180 ? 8 : 2);
  const socialScore = 45 + Math.min(45, snapshot.socialVelocityPct / 6);
  const walletScore = 50 + snapshot.smartMoneyBuys * 6 - snapshot.smartMoneySells * 7;
  const quantScore = 45 + (snapshot.buySellRatio - 1) * 24 + Math.min(18, snapshot.priceChange24h * 0.4) - snapshot.volatility * 9;
  let contractScore = 94 - Math.max(0, snapshot.top10Pct - 20) * 0.55 - snapshot.bundledPct * 0.7 - snapshot.sellTaxPct * 1.5;
  if (!snapshot.liquidityLocked) contractScore -= 10;
  if (snapshot.proxyContract) contractScore -= 6;
  if (!risk.passed) contractScore = 5;
  const bearPressure = 18 + snapshot.volatility * 30 + Math.max(0, snapshot.top10Pct - 30) * 0.8 + Math.max(0, snapshot.bundledPct - 8) * 1.4 + (snapshot.liquidity < 50_000 ? 22 : 0) + snapshot.devRugHistory * 28 + risk.warnings.length * 5;
  const bearInFavor = 100 - bearPressure;

  const core = [launchScore, socialScore, walletScore, quantScore, contractScore, bearInFavor].map(clamp);
  const weighted = core[0] * 0.12 + core[1] * 0.10 + core[2] * 0.18 + core[3] * 0.23 + core[4] * 0.27 + core[5] * 0.10;
  const conviction = risk.passed ? clamp(weighted) : 0;
  let decision: Decision = "SKIP";
  if (risk.passed && conviction >= 78) decision = "BUY";
  else if (risk.passed && conviction >= 58) decision = "WATCH";
  const consensus = risk.passed ? core.filter((s) => s >= 58).length : 0;

  const agents: AgentOpinion[] = [
    agent("launch", "Launch Scout", "LS", launchScore, launchScore >= 70 ? "Launch momentum is building." : "Launch momentum is mixed.", `5m volume $${Math.round(snapshot.volume5m).toLocaleString()} · age ${snapshot.ageMinutes}m`, [`24h move ${snapshot.priceChange24h.toFixed(1)}%`, `${snapshot.chain} venue: ${snapshot.venue}`], "#ffb13b"),
    agent("social", "Social Scout", "SS", socialScore, socialScore >= 70 ? "Narrative velocity is accelerating." : "Social traction is not decisive.", `Mention velocity ${Math.round(snapshot.socialVelocityPct)}% vs baseline`, [`Social velocity ${snapshot.socialVelocityPct.toFixed(0)}%`, "Requires source-quality weighting before live use"], "#b05cff"),
    agent("wallet", "Wallet Tracker", "WT", walletScore, walletScore >= 70 ? "Smart money is net accumulating." : "Wallet flow needs confirmation.", `${snapshot.smartMoneyBuys} tracked buys · ${snapshot.smartMoneySells} tracked sells`, [`Net tracked flow ${snapshot.smartMoneyBuys - snapshot.smartMoneySells}`, `Holder count ${snapshot.holders.toLocaleString()}`], "#29e693"),
    agent("quant", "Quant Bot", "QB", quantScore, quantScore >= 70 ? "Momentum and flow align." : "Risk/reward is not clean yet.", `Buy/sell ${snapshot.buySellRatio.toFixed(2)}x · volatility ${(snapshot.volatility * 100).toFixed(0)}%`, [`Volume 5m $${Math.round(snapshot.volume5m).toLocaleString()}`, `Liquidity/MC ${(snapshot.liquidity / Math.max(snapshot.marketCap, 1) * 100).toFixed(1)}%`], "#28c9ff"),
    agent("contract", "Contract Bot", "CB", contractScore, risk.passed ? "Core security checks passed." : "Hard safety veto triggered.", risk.passed ? `Top 10 ${snapshot.top10Pct.toFixed(1)}% · bundles ${snapshot.bundledPct.toFixed(1)}%` : risk.hardBlocks[0], risk.passed ? risk.passedChecks.slice(0, 3) : risk.hardBlocks.slice(0, 3), "#ffd34f"),
    agent("bear", "Bear Bot", "BB", bearInFavor, bearInFavor >= 58 ? "Red team found no fatal bear case." : "Downside case is too strong.", risk.warnings[0] ?? "Stress-testing liquidity, concentration and volatility", risk.warnings.length ? risk.warnings.slice(0, 3) : ["No elevated deterministic warnings", `Volatility ${(snapshot.volatility * 100).toFixed(0)}%`], "#ff5f6d"),
    { id: "cio", name: "CIO", shortName: "CIO", score: conviction, stance: conviction >= 70 ? "bullish" : conviction >= 45 ? "neutral" : "bearish", summary: risk.passed ? `${decision}: ${consensus}/6 research agents support the setup.` : "SKIP: deterministic risk layer vetoed the trade.", detail: risk.passed ? `Risk cap ${risk.maxPositionPct.toFixed(2)}% · experiment ${experiment.id}` : `${risk.hardBlocks.length} hard block(s)`, evidence: [`Weighted conviction ${conviction}%`, `Experiment stage ${experiment.stage}`, `Risk quality ${risk.riskScore}%`], color: "#70a8ff" },
    { id: "executor", name: "Executor", shortName: "EX", score: risk.passed ? conviction : 0, stance: "ready", summary: decision === "BUY" ? `${mode.toUpperCase()} order can be routed after risk approval.` : "Standing by. No entry order generated.", detail: mode === "paper" ? "Same execution request schema as live; fill is simulated" : "Live mode remains gated by global + strategy controls", evidence: ["Only Executor may submit an order", "AI cannot override deterministic risk"], color: "#52f6c6" },
  ];

  const execution = buildExecutionPlan({ mode, snapshot, decision, conviction, risk, portfolio, experiment, decisionId });
  const auditTrail = [
    `${snapshot.chain}: opportunity admitted to War Room`,
    `Six research agents completed independent scoring`,
    `Bear Bot red-team pass completed with ${risk.warnings.length} warning(s)`,
    `Deterministic risk gate: ${risk.passed ? "PASS" : "VETO"}`,
    `CIO decision: ${decision} at ${conviction}% conviction`,
    `Executor: ${execution.allowed ? "ORDER PLAN CREATED" : execution.reason}`,
  ];

  return { decisionId, snapshot, agents, decision, consensus, conviction, risk, experiment, execution, auditTrail, generatedAt: new Date().toISOString() };
}
