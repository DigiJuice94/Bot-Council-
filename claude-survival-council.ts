import { buildExecutionPlan } from "./execution";
import { getClaudeSurvivalScoreboard, loadClaudeSurvivalLedger, recordClaudeApiUsage } from "./claude-survival-store";
import type {
  ClaudeSurvivalAgentId,
  ClaudeSurvivalCouncilTrace,
  ClaudeSurvivalOpinion,
  ClaudeSurvivalVote,
  Decision,
  PortfolioRiskContext,
  WarRoomResult,
} from "./types";

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

const AGENT_NAMES: Record<ClaudeSurvivalAgentId, string> = {
  alpha_hunter: "Claude Alpha Hunter",
  risk_reaper: "Claude Risk Reaper",
  profit_optimizer: "Claude Profit Optimizer",
  survival_cio: "Claude Survival CIO",
};

const SPECIALIST_ROLES: Array<{ id: Exclude<ClaudeSurvivalAgentId, "survival_cio">; mission: string }> = [
  {
    id: "alpha_hunter",
    mission: "Find the asymmetric upside. Decide whether this candidate is early enough, accelerating enough, and structurally strong enough to deserve capital now rather than later.",
  },
  {
    id: "risk_reaper",
    mission: "Try to kill bad trades. Focus on distribution, weak liquidity quality, concentration, decaying momentum, false acceleration, and reasons the local Council may be overexcited.",
  },
  {
    id: "profit_optimizer",
    mission: "Judge whether the entry creates a favorable profit-capture path. Focus on expected runner upside versus likely drawdown, staged take-profit feasibility, moon-bag potential, and whether the reward is worth tying up capital.",
  },
];

function apiKey() {
  return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || "";
}

function model() {
  return process.env.CLAUDE_SURVIVAL_MODEL?.trim() || process.env.CLAUDE_PROFIT_OPTIMIZER_MODEL?.trim() || "claude-sonnet-5";
}

function enabled() {
  return process.env.CLAUDE_SURVIVAL_COUNCIL_ENABLED !== "false" && Boolean(apiKey());
}

function timeoutMs() {
  return Math.max(2_500, Number(process.env.CLAUDE_SURVIVAL_TIMEOUT_MS ?? 5_000));
}

function estimateCost(inputTokens: number, outputTokens: number) {
  // Configurable because Anthropic pricing can change by model/account.
  const inputPerMillion = Math.max(0, Number(process.env.CLAUDE_INPUT_COST_PER_MILLION_USD ?? 3));
  const outputPerMillion = Math.max(0, Number(process.env.CLAUDE_OUTPUT_COST_PER_MILLION_USD ?? 15));
  return Number(((inputTokens / 1_000_000) * inputPerMillion + (outputTokens / 1_000_000) * outputPerMillion).toFixed(8));
}

function extractJson(text: string): Record<string, unknown> {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(clean) as Record<string, unknown>; } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error("Claude returned no JSON object");
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function parseVote(value: unknown): ClaudeSurvivalVote {
  const vote = String(value ?? "").toUpperCase();
  if (vote === "BACK" || vote === "PASS" || vote === "VETO") return vote;
  throw new Error(`Unsupported Claude survival vote: ${vote || "missing"}`);
}

function packet(result: WarRoomResult, portfolio: PortfolioRiskContext) {
  const s = result.snapshot;
  const local = result.independentCouncil;
  const split = local?.meetingOpinions.reduce((acc, row) => {
    acc[row.vote] = (acc[row.vote] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};
  return {
    symbol: s.symbol,
    chain: s.chain,
    marketCapUsd: Math.round(s.marketCap),
    liquidityUsd: Math.round(s.liquidity),
    ageMinutes: Math.round(s.ageMinutes),
    priceChange24hPct: s.priceChange24h,
    marketCapChange5mPct: s.marketCapChange5mPct ?? 0,
    volume5mUsd: Math.round(s.volume5m),
    volumeAccelerationPct: s.volumeAccelerationPct ?? s.launchMetrics?.volumeAccelerationPct ?? 0,
    buySellRatio: s.buySellRatio,
    holders: s.holders,
    holderGrowthPct: s.holderGrowthPct ?? 0,
    top10Pct: s.top10Pct,
    bundledPct: s.bundledPct,
    sellable: s.sellable,
    honeypot: s.honeypot,
    volatility: s.volatility,
    alphaScore: result.alpha.score,
    rewardRiskProxy: result.alpha.rewardRiskProxy,
    runnerGenomeEntryScore: result.runnerGenome.entryScore,
    dumperRiskScore: result.runnerGenome.dumperRiskScore,
    trajectoryScore: result.runnerGenome.trajectoryScore,
    trajectoryDumperRiskScore: result.runnerGenome.trajectoryDumperRiskScore,
    expectedPeakMultiple: result.runnerGenome.expectedPeakMultiple,
    expectedTimeToPeakMinutes: result.runnerGenome.expectedTimeToPeakMinutes,
    suggestedTradeUsd: result.runnerGenome.suggestedTradeUsd,
    localDecision: result.decision,
    localConviction: result.conviction,
    localMeetingSplit: `${split.BUY ?? 0} BUY / ${split.WATCH ?? 0} WATCH / ${split.SKIP ?? 0} SKIP`,
    localCio: local ? `${local.cioOpinion.vote} ${local.cioOpinion.confidence}%` : "n/a",
    hardRiskPassed: result.risk.passed,
    hardBlocks: result.risk.hardBlocks,
    warnings: result.risk.warnings,
    stopLossPct: result.exitStrategy.stopLossPct,
    trailingStopPct: result.exitStrategy.trailingStopPct,
    takeProfits: result.exitStrategy.takeProfits,
    moonbagPct: result.exitStrategy.moonbagPct ?? 0,
    cashUsd: Number(portfolio.cashUsd.toFixed(2)),
    equityUsd: Number(portfolio.equityUsd.toFixed(2)),
    openPositions: portfolio.openPositions,
  };
}

function specialistPrompt(agentId: Exclude<ClaudeSurvivalAgentId, "survival_cio">, mission: string, data: ReturnType<typeof packet>, survival: { apiCostUsd: number; attributedValueUsd: number; settledTrades: number; state: string }) {
  return `You are ${AGENT_NAMES[agentId]}, one of four Claude decision seats in an autonomous PAPER crypto Bot Council.

MAKE-MONEY-OR-LOSE-YOUR-SEAT RULE:
Your API spending and actual settled-trade value are tracked. If, after a meaningful sample, your attributed value fails to cover your API cost, your seat can enter probation and eventually be disabled. NEVER take extra risk, ignore safety, or recommend reckless sizing to protect your seat. Hard-coded sellability, liquidity, honeypot, stop-loss and execution rules always outrank you.

YOUR SPECIALTY:
${mission}

Return ONLY JSON:
{"vote":"BACK|PASS|VETO","confidence":0-100,"reason":"one concise sentence"}

Definitions:
BACK = this candidate deserves the strongest allowed PAPER exposure under existing deterministic sizing.
PASS = do not override the local Council; evidence is mixed or the local decision is reasonable.
VETO = the opportunity quality is poor enough that the AI layer should reject the entry.

YOUR SCORECARD SO FAR:
settledTrades=${survival.settledTrades}
attributedValueUsd=${survival.attributedValueUsd.toFixed(4)}
apiCostUsd=${survival.apiCostUsd.toFixed(6)}
seatState=${survival.state}

CANDIDATE DATA:
${JSON.stringify(data)}`;
}

function cioPrompt(data: ReturnType<typeof packet>, opinions: ClaudeSurvivalOpinion[], survival: { apiCostUsd: number; attributedValueUsd: number; settledTrades: number; state: string }) {
  return `You are Claude Survival CIO, the fourth Claude seat in an autonomous PAPER crypto Bot Council.
You hear three independent Claude specialists AFTER they lock their opinions, plus the existing local Council evidence.

MAKE-MONEY-OR-LOSE-YOUR-SEAT RULE:
Your API cost and realized decision value are tracked. After enough settled trades, a seat that does not create more value than it costs can be disabled. This is NOT permission to gamble. You may never override hard liquidity, sellability, honeypot, security, stop-loss or execution constraints.

Return ONLY JSON:
{"vote":"BACK|PASS|VETO","confidence":0-100,"reason":"one concise sentence"}

BACK = final AI layer supports BUY. A local WATCH may be upgraded to BUY only when the evidence is unusually strong.
PASS = preserve the local Council decision exactly.
VETO = reject this entry entirely.

YOUR SCORECARD:
settledTrades=${survival.settledTrades}
attributedValueUsd=${survival.attributedValueUsd.toFixed(4)}
apiCostUsd=${survival.apiCostUsd.toFixed(6)}
seatState=${survival.state}

LOCAL + MARKET DATA:
${JSON.stringify(data)}

LOCKED CLAUDE SPECIALIST READS:
${JSON.stringify(opinions.map((o) => ({ agent: o.agentName, vote: o.vote, confidence: o.confidence, reason: o.reason })))}`;
}

async function callClaude(agentId: ClaudeSurvivalAgentId, prompt: string): Promise<ClaudeSurvivalOpinion> {
  const key = apiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const selectedModel = model();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 180,
        system: "You are a bounded autonomous trading-decision specialist. Return valid JSON only. Never override deterministic hard safety constraints.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as AnthropicMessageResponse;
    if (!response.ok) throw new Error(payload.error?.message || `Anthropic API HTTP ${response.status}`);
    const text = payload.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Claude returned no text response");
    const parsed = extractJson(text);
    const inputTokens = Math.max(0, Number(payload.usage?.input_tokens ?? 0));
    const outputTokens = Math.max(0, Number(payload.usage?.output_tokens ?? 0));
    const opinion: ClaudeSurvivalOpinion = {
      agentId,
      agentName: AGENT_NAMES[agentId],
      vote: parseVote(parsed.vote),
      confidence: Number(clamp(Number(parsed.confidence ?? 50), 0, 100).toFixed(1)),
      reason: String(parsed.reason ?? "Claude reviewed the candidate.").replace(/\s+/g, " ").trim().slice(0, 320),
      model: payload.model || selectedModel,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(inputTokens, outputTokens),
      formedAt: new Date().toISOString(),
    };
    await recordClaudeApiUsage(opinion);
    return opinion;
  } finally {
    clearTimeout(timer);
  }
}

async function liveSpecialist(spec: typeof SPECIALIST_ROLES[number], data: ReturnType<typeof packet>) {
  const ledger = await loadClaudeSurvivalLedger(spec.id);
  if (ledger.state === "dead") return null;
  try {
    return await callClaude(spec.id, specialistPrompt(spec.id, spec.mission, data, ledger));
  } catch (error) {
    console.error(`[claude-survival] ${spec.id}`, error);
    return null;
  }
}

function finalDecision(localDecision: Decision, cioVote: ClaudeSurvivalVote, hardRiskPassed: boolean): Decision {
  if (!hardRiskPassed) return "SKIP";
  if (cioVote === "VETO") return "SKIP";
  if (cioVote === "BACK") return "BUY";
  return localDecision;
}

export async function applyClaudeSurvivalCouncil(result: WarRoomResult, portfolio: PortfolioRiskContext): Promise<WarRoomResult> {
  if (!enabled()) return result;
  if (!result.risk.passed || (result.decision !== "BUY" && result.decision !== "WATCH")) return result;

  const startedAt = new Date().toISOString();
  const sessionId = `CSC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const data = packet(result, portfolio);
  const specialists = (await Promise.all(SPECIALIST_ROLES.map((spec) => liveSpecialist(spec, data)))).filter((row): row is ClaudeSurvivalOpinion => Boolean(row));
  const cioLedger = await loadClaudeSurvivalLedger("survival_cio");

  let cioOpinion: ClaudeSurvivalOpinion | undefined;
  if (cioLedger.state !== "dead") {
    try {
      cioOpinion = await callClaude("survival_cio", cioPrompt(data, specialists, cioLedger));
    } catch (error) {
      console.error("[claude-survival] survival_cio", error);
    }
  }

  const nextDecision = cioOpinion ? finalDecision(result.decision, cioOpinion.vote, result.risk.passed) : result.decision;
  const completedAt = new Date().toISOString();
  const trace: ClaudeSurvivalCouncilTrace = {
    sessionId,
    model: model(),
    startedAt,
    completedAt,
    localDecision: result.decision,
    finalDecision: nextDecision,
    specialists,
    cioOpinion,
    skippedReason: cioOpinion ? undefined : "Survival CIO unavailable/dead; local Council decision preserved.",
  };

  const conviction = cioOpinion ? Math.round(cioOpinion.confidence) : result.conviction;
  const execution = nextDecision === result.decision
    ? result.execution
    : buildExecutionPlan({
        mode: "paper",
        snapshot: result.snapshot,
        decision: nextDecision,
        conviction: nextDecision === "SKIP" ? 0 : conviction,
        risk: result.risk,
        portfolio,
        experiment: result.experiment,
        decisionId: result.decisionId,
        allocationMultiplier: result.execution.allocationMultiplier ?? 1,
      });

  const opinionAudit = specialists.map((o) => `CLAUDE ${o.agentName.toUpperCase()} · ${o.vote} · ${o.confidence.toFixed(0)}% · ${o.reason}`);
  return {
    ...result,
    decision: nextDecision,
    conviction: nextDecision === "SKIP" ? 0 : conviction,
    execution,
    claudeSurvivalCouncil: trace,
    councilProcess: {
      ...result.councilProcess,
      reasons: [
        ...result.councilProcess.reasons,
        `Claude Survival Council ${sessionId}: ${specialists.length}/3 live specialist seats responded.`,
        cioOpinion ? `Claude Survival CIO ${cioOpinion.vote} at ${cioOpinion.confidence.toFixed(0)}% changed ${result.decision} → ${nextDecision}.` : "Claude Survival CIO unavailable; local decision preserved.",
      ],
    },
    auditTrail: [
      ...result.auditTrail,
      `CLAUDE SURVIVAL COUNCIL · session ${sessionId} · make-money-or-lose-your-seat accounting active`,
      ...opinionAudit,
      cioOpinion ? `CLAUDE SURVIVAL CIO · ${cioOpinion.vote} · ${cioOpinion.confidence.toFixed(0)}% · ${cioOpinion.reason}` : "CLAUDE SURVIVAL CIO · unavailable; local decision retained",
      `CLAUDE FINAL · ${result.decision} → ${nextDecision}`,
    ],
    reasoningCompletedAt: completedAt,
  };
}

export async function getClaudeSurvivalCouncilStatus() {
  return {
    configured: Boolean(apiKey()),
    enabled: enabled(),
    model: model(),
    scoreboard: await getClaudeSurvivalScoreboard(),
  };
}
