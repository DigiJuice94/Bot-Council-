import type { ManagedPosition, MarketSnapshot, PortfolioRiskContext, RunnerExitGenomeGuidance } from "./types";
import { loadClaudeSurvivalLedger, recordClaudeApiSpend } from "./claude-survival-store";

export type ClaudeProfitAction = "HOLD" | "TRIM" | "EXIT";

export type ClaudeProfitReview = {
  action: ClaudeProfitAction;
  confidence: number;
  sellPct: number;
  reason: string;
  model: string;
  reviewedAt: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function estimateCost(inputTokens: number, outputTokens: number) {
  const inputPerMillion = Math.max(0, Number(process.env.CLAUDE_INPUT_COST_PER_MILLION_USD ?? 3));
  const outputPerMillion = Math.max(0, Number(process.env.CLAUDE_OUTPUT_COST_PER_MILLION_USD ?? 15));
  return Number(((inputTokens / 1_000_000) * inputPerMillion + (outputTokens / 1_000_000) * outputPerMillion).toFixed(8));
}

function apiKey() {
  return process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim() || "";
}

function enabled() {
  return process.env.CLAUDE_PROFIT_OPTIMIZER_ENABLED !== "false" && Boolean(apiKey());
}

function reviewIntervalMs() {
  return Math.max(15_000, Number(process.env.CLAUDE_PROFIT_OPTIMIZER_REVIEW_MS ?? 60_000));
}


export function getClaudeProfitOptimizerStatus() {
  const keyPresent = Boolean(apiKey());
  const isEnabled = process.env.CLAUDE_PROFIT_OPTIMIZER_ENABLED !== "false";
  return {
    configured: keyPresent,
    enabled: keyPresent && isEnabled,
    model: process.env.CLAUDE_PROFIT_OPTIMIZER_MODEL?.trim() || "claude-sonnet-5",
    reviewMs: reviewIntervalMs(),
  };
}

function nextProfitLevel(position: ManagedPosition) {
  return position.exitStrategy.takeProfits.find((level) => !position.takenProfitLabels.includes(level.label));
}

function approachingNextProfitLevel(position: ManagedPosition) {
  const nextTp = nextProfitLevel(position);
  if (!nextTp || position.lastAction !== "HOLD" || position.entryPrice <= 0) return false;
  const rawMovePct = (position.markPrice / position.entryPrice - 1) * 100;
  return rawMovePct >= Math.max(0, nextTp.gainPct - 5) && rawMovePct < nextTp.gainPct;
}

function decisionContextKey(position: ManagedPosition) {
  if (position.lastAction === "TRIM" || approachingNextProfitLevel(position)) {
    const nextTp = nextProfitLevel(position);
    return `TRIM:${nextTp?.label ?? "next"}`;
  }
  if (position.lastAction === "EXIT" && position.lastReason.startsWith("Exit Strategist")) return "EXIT:strategist";
  return position.lastAction;
}

function isRecent(position: ManagedPosition) {
  if (!position.profitOptimizerReviewedAt) return false;
  if (position.profitOptimizerContextKey !== decisionContextKey(position)) return false;
  const at = new Date(position.profitOptimizerReviewedAt).getTime();
  return Number.isFinite(at) && Date.now() - at < reviewIntervalMs();
}

function optimizerRelevant(position: ManagedPosition) {
  const rawMovePct = position.entryPrice > 0 ? (position.markPrice / position.entryPrice - 1) * 100 : 0;
  // Keep Claude off the scan hot path. A near-target HOLD is pre-reviewed so a
  // fast runner can often hit the TP with a cached decision instead of waiting
  // on network/model latency at the exact execution moment.
  if (approachingNextProfitLevel(position)) return true;
  if (position.lastAction === "TRIM") return true;
  if (position.lastAction === "EXIT" && position.lastReason.startsWith("Exit Strategist") && rawMovePct > 0) return true;
  return false;
}

function extractJson(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("Claude returned no JSON object");
  }
}

function parseReview(raw: unknown, model: string, inputTokens = 0, outputTokens = 0): ClaudeProfitReview {
  if (!raw || typeof raw !== "object") throw new Error("Claude Profit Optimizer response was not an object");
  const row = raw as Record<string, unknown>;
  const action = String(row.action ?? "").toUpperCase();
  if (action !== "HOLD" && action !== "TRIM" && action !== "EXIT") throw new Error(`Unsupported Claude action: ${action || "missing"}`);
  const confidence = clamp(Number(row.confidence ?? 50), 0, 100);
  const sellPct = action === "TRIM" ? clamp(Number(row.sellPct ?? 20), 10, 35) : action === "EXIT" ? 100 : 0;
  const reason = String(row.reason ?? "Claude reviewed the live profit-management snapshot.").replace(/\s+/g, " ").trim().slice(0, 360);
  return { action, confidence: Number(confidence.toFixed(1)), sellPct: Number(sellPct.toFixed(1)), reason, model, reviewedAt: new Date().toISOString(), inputTokens, outputTokens, estimatedCostUsd: estimateCost(inputTokens, outputTokens) };
}

function promptFor(args: {
  position: ManagedPosition;
  snapshot: MarketSnapshot;
  portfolio?: PortfolioRiskContext;
  exitGenome?: RunnerExitGenomeGuidance;
}) {
  const { position, snapshot, portfolio, exitGenome } = args;
  const entry = Math.max(position.entryPrice, 1e-12);
  const rawMovePct = (snapshot.price / entry - 1) * 100;
  const highWaterGainPct = (Math.max(position.highWaterPrice, snapshot.price) / entry - 1) * 100;
  const high = Math.max(position.highWaterPrice, snapshot.price);
  const drawdownFromHighPct = high > 0 ? (high - snapshot.price) / high * 100 : 0;
  const heldMinutes = Math.max(0, (Date.now() - new Date(position.openedAt).getTime()) / 60_000);
  const remainingValueUsd = Math.max(0, position.remainingQuantity) * Math.max(0, snapshot.price);
  const nextTp = position.exitStrategy.takeProfits.find((level) => !position.takenProfitLabels.includes(level.label));

  return `You are the Claude Profit Optimizer inside an autonomous PAPER crypto trading system.
Your only objective is to improve realized profit capture while preserving upside on exceptional runners.
You do not control entries, position increases, liquidity/security rules, or stop-loss rules. Those hard-coded systems outrank you.
You are reviewing a profit-management moment. Be decisive and conservative about round-tripping gains.

Return ONLY one JSON object with exactly these fields:
{"action":"HOLD|TRIM|EXIT","confidence":0-100,"sellPct":0-100,"reason":"one short sentence"}

Action meanings:
- HOLD: keep the current remaining position unchanged for now.
- TRIM: realize part of the current remaining position. Use sellPct between 10 and 35.
- EXIT: close the remaining position.

Guidance:
- Favor HOLD when buy pressure, acceleration, continuation and price structure still support a runner.
- Favor TRIM when the trade is profitable but momentum is mixed, distribution is emerging, or profit capture is lagging.
- Favor EXIT when a profitable move is clearly distributing, badly retracing, or the local Exit Strategist is protecting a gain.
- Never recommend adding size.
- Do not assume a future price move. Use only the supplied data.

LIVE POSITION
symbol=${position.symbol}
chain=${position.chain}
state=${position.winnerState ?? "building"}
localAction=${position.lastAction}
localReason=${position.lastReason}
entryPrice=${position.entryPrice}
markPrice=${snapshot.price}
rawMovePct=${rawMovePct.toFixed(2)}
highWaterGainPct=${highWaterGainPct.toFixed(2)}
drawdownFromHighPct=${drawdownFromHighPct.toFixed(2)}
heldMinutes=${heldMinutes.toFixed(1)}
remainingValueUsd=${remainingValueUsd.toFixed(2)}
realizedPnlUsd=${position.realizedPnlUsd.toFixed(2)}
profitCapturePct=${position.profitCapturePct.toFixed(2)}
takenProfitLabels=${position.takenProfitLabels.join(",") || "none"}
nextTakeProfit=${nextTp ? `${nextTp.label}@+${nextTp.gainPct}% sells ${nextTp.sellPct}%` : "none"}
exitStrategistScore=${position.exitStrategistScore ?? 0}
exitStrategistReason=${position.exitStrategistReason ?? "none"}

LIVE MARKET
marketCapUsd=${snapshot.marketCap.toFixed(0)}
liquidityUsd=${snapshot.liquidity.toFixed(0)}
volume5mUsd=${snapshot.volume5m.toFixed(0)}
volume24hUsd=${snapshot.volume24h.toFixed(0)}
buySellRatio=${snapshot.buySellRatio.toFixed(3)}
volumeAccelerationPct=${(snapshot.volumeAccelerationPct ?? snapshot.launchMetrics?.volumeAccelerationPct ?? 0).toFixed(2)}
marketCapChange5mPct=${(snapshot.marketCapChange5mPct ?? 0).toFixed(2)}
liquidityChangePct=${(snapshot.liquidityChangePct ?? 0).toFixed(2)}
volatility=${snapshot.volatility.toFixed(4)}
sellable=${snapshot.sellable}
honeypot=${snapshot.honeypot}

RUNNER EXIT GENOME
continuationScore=${exitGenome?.continuationScore ?? "n/a"}
distributionRiskScore=${exitGenome?.distributionRiskScore ?? "n/a"}
exitGenomeAction=${exitGenome?.action ?? "n/a"}
exitGenomeReason=${exitGenome?.reason ?? "n/a"}

PORTFOLIO
cashUsd=${portfolio?.cashUsd?.toFixed(2) ?? "n/a"}
equityUsd=${portfolio?.equityUsd?.toFixed(2) ?? "n/a"}
openPositions=${portfolio?.openPositions ?? "n/a"}`;
}

async function callClaude(args: {
  position: ManagedPosition;
  snapshot: MarketSnapshot;
  portfolio?: PortfolioRiskContext;
  exitGenome?: RunnerExitGenomeGuidance;
}): Promise<ClaudeProfitReview> {
  const key = apiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const model = process.env.CLAUDE_PROFIT_OPTIMIZER_MODEL?.trim() || "claude-sonnet-5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(2_500, Number(process.env.CLAUDE_PROFIT_OPTIMIZER_TIMEOUT_MS ?? 4_000)));
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 220,
        system: "You are a bounded profit-management specialist. Return valid JSON only and obey all hard-coded trading constraints described by the user message.",
        messages: [{ role: "user", content: promptFor(args) }],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as AnthropicMessageResponse;
    if (!response.ok) throw new Error(payload.error?.message || `Anthropic API HTTP ${response.status}`);
    const text = payload.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Claude returned no text response");
    const inputTokens = Math.max(0, Number(payload.usage?.input_tokens ?? 0));
    const outputTokens = Math.max(0, Number(payload.usage?.output_tokens ?? 0));
    const review = parseReview(extractJson(text), payload.model || model, inputTokens, outputTokens);
    await recordClaudeApiSpend("profit_optimizer", inputTokens, outputTokens, review.estimatedCostUsd);
    return review;
  } finally {
    clearTimeout(timeout);
  }
}

function withReview(position: ManagedPosition, review: ClaudeProfitReview): ManagedPosition {
  return {
    ...position,
    profitOptimizerProvider: "claude",
    profitOptimizerModel: review.model,
    profitOptimizerAction: review.action,
    profitOptimizerConfidence: review.confidence,
    profitOptimizerSellPct: review.sellPct,
    profitOptimizerReason: review.reason,
    profitOptimizerContextKey: decisionContextKey(position),
    profitOptimizerReviewedAt: review.reviewedAt,
    profitOptimizerError: undefined,
  };
}

function applyReview(position: ManagedPosition, review: ClaudeProfitReview): ManagedPosition {
  let next = withReview(position, review);
  const rawMovePct = next.entryPrice > 0 ? (next.markPrice / next.entryPrice - 1) * 100 : 0;

  // Claude may optimize a deterministic take-profit event, but can never turn it
  // into a larger position. HOLD defers this TP until the next Claude review.
  if (position.lastAction === "TRIM") {
    if (review.action === "HOLD") {
      next = {
        ...next,
        lastAction: "HOLD",
        status: "open",
        lastReason: `Claude Profit Optimizer HOLD ${review.confidence.toFixed(0)}/100: ${review.reason}`,
      };
    } else {
      next = {
        ...next,
        lastAction: "TRIM",
        status: "open",
        profitOptimizerSellPct: review.action === "EXIT" ? 35 : review.sellPct,
        lastReason: `Claude Profit Optimizer TRIM ${review.confidence.toFixed(0)}/100: ${review.reason}`,
      };
    }
    return next;
  }

  // Only the Exit Strategist's soft, profitable exit may be reconsidered.
  // Security, liquidity, stop-loss, breakeven, trailing-stop and time exits never
  // reach this branch because their reason does not start with Exit Strategist.
  if (position.lastAction === "EXIT" && position.lastReason.startsWith("Exit Strategist") && rawMovePct > 0) {
    if (review.action === "HOLD") {
      return {
        ...next,
        lastAction: "HOLD",
        status: "open",
        lastReason: `Claude Profit Optimizer HOLD ${review.confidence.toFixed(0)}/100 over soft strategist exit: ${review.reason}`,
      };
    }
    if (review.action === "TRIM") {
      // A soft EXIT cannot invent a new TP level. Keep the deterministic exit,
      // but record Claude's disagreement visibly for later evaluation.
      return {
        ...next,
        lastReason: `${position.lastReason} Claude preferred a ${review.sellPct.toFixed(0)}% trim (${review.confidence.toFixed(0)}/100): ${review.reason}`,
      };
    }
    return {
      ...next,
      lastReason: `${position.lastReason} Claude Profit Optimizer confirmed EXIT ${review.confidence.toFixed(0)}/100: ${review.reason}`,
    };
  }

  // HOLD periods are advisory only. The optimizer is visible and logged, but it
  // does not manufacture an early sell outside a deterministic TP/exit event.
  return next;
}

function applyCachedDecision(position: ManagedPosition): ManagedPosition {
  if (!position.profitOptimizerReviewedAt || !position.profitOptimizerAction || !isRecent(position)) return position;
  const cached: ClaudeProfitReview = {
    action: position.profitOptimizerAction,
    confidence: position.profitOptimizerConfidence ?? 0,
    sellPct: position.profitOptimizerSellPct ?? 0,
    reason: position.profitOptimizerReason ?? "Recent Claude Profit Optimizer decision remains active.",
    model: position.profitOptimizerModel ?? "claude",
    reviewedAt: position.profitOptimizerReviewedAt,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
  return applyReview(position, cached);
}

export async function applyClaudeProfitOptimizer(args: {
  position: ManagedPosition;
  snapshot: MarketSnapshot;
  portfolio?: PortfolioRiskContext;
  exitGenome?: RunnerExitGenomeGuidance;
}): Promise<ManagedPosition> {
  const { position } = args;
  if (!enabled() || position.mode !== "paper" || !optimizerRelevant(position)) return position;

  const survival = await loadClaudeSurvivalLedger("profit_optimizer");
  if (survival.state === "dead") {
    return {
      ...position,
      profitOptimizerProvider: "claude",
      profitOptimizerError: "Claude Profit Optimizer seat is DEAD: its settled-trade value failed the survival threshold; deterministic Guardian remains in control.",
    };
  }

  if (isRecent(position)) return applyCachedDecision(position);

  try {
    const review = await callClaude(args);
    return applyReview(position, review);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...position,
      profitOptimizerProvider: "claude",
      profitOptimizerError: message.slice(0, 240),
      // Fail open to the existing deterministic Guardian action. Claude being
      // unavailable must never freeze exits or stop trading.
    };
  }
}
