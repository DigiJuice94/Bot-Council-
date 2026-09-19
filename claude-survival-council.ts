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

const RISK_REAPER_ID: ClaudeSurvivalAgentId = "risk_reaper";
const RISK_REAPER_NAME = "Claude Risk Reaper";

function apiKey() {
  return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || "";
}

function model() {
  return process.env.CLAUDE_SURVIVAL_MODEL?.trim() || "claude-sonnet-5";
}

function enabled() {
  return process.env.CLAUDE_SURVIVAL_COUNCIL_ENABLED !== "false" && Boolean(apiKey());
}

function timeoutMs() {
  return Math.max(2_500, Number(process.env.CLAUDE_SURVIVAL_TIMEOUT_MS ?? 5_000));
}

function estimateCost(inputTokens: number, outputTokens: number) {
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

function parseRiskVote(value: unknown): ClaudeSurvivalVote {
  const vote = String(value ?? "").toUpperCase();
  if (vote === "VETO" || vote === "PASS") return vote;
  // Risk Reaper is no longer an upside/entry seat. A legacy BACK response can
  // never upgrade local conviction; treat it as PASS.
  if (vote === "BACK") return "PASS";
  throw new Error(`Unsupported Risk Reaper vote: ${vote || "missing"}`);
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
    sellabilityVerified: Boolean(s.dataProvenance?.quality?.sellability),
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
    cashUsd: Number(portfolio.cashUsd.toFixed(2)),
    equityUsd: Number(portfolio.equityUsd.toFixed(2)),
    openPositions: portfolio.openPositions,
  };
}

function riskPrompt(data: ReturnType<typeof packet>, survival: { apiCostUsd: number; attributedValueUsd: number; settledTrades: number; state: string }) {
  return `You are ${RISK_REAPER_NAME}, the ONLY Claude seat remaining in an autonomous PAPER crypto Bot Council.

YOUR JOB:
Red-team candidate entries. Try to kill bad trades before they consume capital. Focus on rug/locked-capital risk, false liquidity, distribution, concentration, decaying momentum, suspicious price/market-cap behavior, and reasons the local Council may be overexcited.

MAKE-MONEY-OR-LOSE-YOUR-SEAT RULE:
Your API spending and settled-trade value are tracked. Poor long-run contribution can put your seat on probation or disable it. This is NEVER permission to gamble or loosen safety. Hard-coded sellability, liquidity, honeypot, stop-loss and execution rules always outrank you.

Return ONLY JSON:
{"vote":"PASS|VETO","confidence":0-100,"reason":"one concise sentence"}

PASS = do not interfere; preserve the local Council decision.
VETO = reject the entry because downside/rug/quality risk is too high.
You cannot upgrade WATCH to BUY and you cannot increase position size.

YOUR SCORECARD SO FAR:
settledTrades=${survival.settledTrades}
attributedValueUsd=${survival.attributedValueUsd.toFixed(4)}
apiCostUsd=${survival.apiCostUsd.toFixed(6)}
seatState=${survival.state}

CANDIDATE DATA:
${JSON.stringify(data)}`;
}

async function callRiskReaper(prompt: string): Promise<ClaudeSurvivalOpinion> {
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
        system: "You are a bounded risk-red-team specialist. Return valid JSON only. Never override deterministic hard safety constraints and never increase risk.",
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
      agentId: RISK_REAPER_ID,
      agentName: RISK_REAPER_NAME,
      vote: parseRiskVote(parsed.vote),
      confidence: Number(clamp(Number(parsed.confidence ?? 50), 0, 100).toFixed(1)),
      reason: String(parsed.reason ?? "Risk Reaper reviewed the candidate.").replace(/\s+/g, " ").trim().slice(0, 320),
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

function finalDecision(localDecision: Decision, opinion?: ClaudeSurvivalOpinion): Decision {
  if (opinion?.vote === "VETO") return "SKIP";
  return localDecision;
}

export async function applyClaudeSurvivalCouncil(result: WarRoomResult, portfolio: PortfolioRiskContext): Promise<WarRoomResult> {
  if (!enabled()) return result;
  if (!result.risk.passed || (result.decision !== "BUY" && result.decision !== "WATCH")) return result;

  const ledger = await loadClaudeSurvivalLedger(RISK_REAPER_ID);

  const startedAt = new Date().toISOString();
  const sessionId = `RR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  let opinion: ClaudeSurvivalOpinion | undefined;
  try {
    opinion = await callRiskReaper(riskPrompt(packet(result, portfolio), ledger));
  } catch (error) {
    console.error("[claude-risk-reaper]", error);
  }

  const nextDecision = finalDecision(result.decision, opinion);
  const completedAt = new Date().toISOString();
  const trace: ClaudeSurvivalCouncilTrace = {
    sessionId,
    model: model(),
    startedAt,
    completedAt,
    localDecision: result.decision,
    finalDecision: nextDecision,
    specialists: opinion ? [opinion] : [],
    skippedReason: opinion ? undefined : "Risk Reaper unavailable; deterministic/local Council decision preserved.",
  };

  return {
    ...result,
    decision: nextDecision,
    conviction: nextDecision === "SKIP" ? 0 : result.conviction,
    execution: nextDecision === "SKIP"
      ? { ...result.execution, allowed: false, request: undefined, reason: `Risk Reaper vetoed entry: ${opinion?.reason ?? "risk veto"}` }
      : result.execution,
    claudeSurvivalCouncil: trace,
    councilProcess: {
      ...result.councilProcess,
      reasons: [
        ...result.councilProcess.reasons,
        opinion
          ? `Claude Risk Reaper ${opinion.vote} at ${opinion.confidence.toFixed(0)}%; local ${result.decision} → ${nextDecision}.`
          : "Claude Risk Reaper unavailable; local decision preserved.",
      ],
    },
    auditTrail: [
      ...result.auditTrail,
      `CLAUDE RISK REAPER · session ${sessionId} · permanent seat · performance accounting active`,
      opinion ? `RISK REAPER · ${opinion.vote} · ${opinion.confidence.toFixed(0)}% · ${opinion.reason}` : "RISK REAPER · unavailable; local decision retained",
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
