import type { MarketSnapshot, PortfolioRiskContext, RiskCheck } from "./types";

// ---------------------------------------------------------------------------
// v15 entry filters (DexScreener runner-vs-dumper study, 2026-09-29).
// Per-token entry conditions evaluated in the deterministic risk gate. Hard
// blocks beat agent consensus and surface through the v13 fast-path triage as
// complete SKIP verdicts with the reason in chat. These are NOT regime gates
// and NOT loss-streak cooldowns. All thresholds live in this one config object.
// ---------------------------------------------------------------------------
export const ENTRY_FILTERS = {
  MOMENTUM_VETO_PC_M5: -5, // F1: SKIP when 5-min price change < -5% (unknown => no block)
  CHASE_CAP_PC_H1: 50, // F2: SKIP when 1-hour price change >= +50% (unknown => no block)
  MIN_LIQ_USD: 10_000, // F3: entry liquidity floor; unreported liquidity is always vetoed
  BUY_PRESSURE_RATIO: 2.0, // F4/F5: m5 buy/sell ratio threshold
  NEWBORN_AGE_MIN: 60, // F5: pair age (minutes) below which the full filter pass is required
} as const;

/** m5 buy/sell ratio when the venue reported m5 transactions; undefined when unknown. */
export function m5BuySellRatio(m: MarketSnapshot): number | undefined {
  const buys = m.m5Buys;
  const sells = m.m5Sells;
  if (buys === undefined || sells === undefined) return undefined;
  if (!(buys + sells > 0)) return undefined; // no m5 transactions observed: unknown, not weak
  if (sells <= 0) return buys > 0 ? Number.POSITIVE_INFINITY : undefined;
  return buys / sells;
}

function fmtRatio(r: number): string {
  return r === Number.POSITIVE_INFINITY ? "∞" : r.toFixed(2);
}

export const DEFAULT_RISK_CONTEXT: PortfolioRiskContext = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  openPositions: 0,
  totalExposurePct: 0,
  chainExposurePct: 0,
  strategyExposurePct: 0,
  maxDailyLossPct: 5,
  maxOpenPositions: 8,
  maxTotalExposurePct: 35,
  maxChainExposurePct: 15,
  liveTradingEnabled: false,
};

export function runHardRiskChecks(m: MarketSnapshot, p: PortfolioRiskContext = DEFAULT_RISK_CONTEXT): RiskCheck {
  const hardBlocks: string[] = [];
  const warnings: string[] = [];
  const passedChecks: string[] = [];
  const check = (ok: boolean, pass: string, fail: string) => ok ? passedChecks.push(pass) : hardBlocks.push(fail);
  const q = m.dataProvenance?.quality;
  const directLive = Boolean(m.dataProvenance?.live && m.dataProvenance.marketSource !== "adapter");
  const paperCanExploreUnknowns = !p.liveTradingEnabled && process.env.PAPER_FAIL_CLOSED_UNKNOWN !== "true";
  const paperResearchMode = !p.liveTradingEnabled;
  const earlyRunnerLane = !p.liveTradingEnabled && m.marketCap >= 8_000 && m.marketCap <= 80_000 && m.ageMinutes <= 1_440;
  const unknown = (message: string) => paperCanExploreUnknowns ? warnings.push(`${message}; PAPER mode reduced to exploration sizing`) : hardBlocks.push(message);

  // ---- v15 entry filters F1/F2 (F3/F5 follow at the liquidity check below) ----
  // F1: 5-minute momentum veto. Prefer the explicit 5m price-change field; fall
  // back to the 5m mcap-change proxy the engine already tracks. Unknown => no block.
  const pcM5 = m.priceChange5mPct ?? m.marketCapChange5mPct;
  const f1Veto = pcM5 !== undefined && pcM5 < ENTRY_FILTERS.MOMENTUM_VETO_PC_M5;
  if (f1Veto) hardBlocks.push(`5-min momentum veto: pcM5 ${pcM5.toFixed(1)}% < ${ENTRY_FILTERS.MOMENTUM_VETO_PC_M5}%`);
  else if (pcM5 !== undefined) passedChecks.push("5-min momentum veto passed");

  // F2: hourly chase cap. Unknown pcH1 => no block.
  const pcH1 = m.priceChange1hPct;
  const f2Veto = pcH1 !== undefined && pcH1 >= ENTRY_FILTERS.CHASE_CAP_PC_H1;
  if (f2Veto) hardBlocks.push(`chasing extended move: pcH1 ${pcH1.toFixed(1)}% ≥ +${ENTRY_FILTERS.CHASE_CAP_PC_H1}%`);
  else if (pcH1 !== undefined) passedChecks.push("Hourly chase cap passed");

  if (directLive && q) {
    if (!q.sellability) unknown("Sellability verification unavailable from live security provider");
    else check(m.sellable, "Sellability verified", "Sellability check failed");

    if (!q.honeypot) unknown("Honeypot verification unavailable from live security provider");
    else check(!m.honeypot, "Honeypot/security simulation passed", "Honeypot behavior detected");

    if (q.top10) check(m.top10Pct <= 80, "Top-10 concentration under hard cap", "Top 10 holders exceed 80% of supply");
    else warnings.push("Top-10 concentration is not verified; paper size reduced");

    if (q.bundled) check(m.bundledPct <= 25, "Bundled supply under hard cap", "Bundled supply exceeds 25%");
    else warnings.push("Bundled-supply concentration is not verified; paper size reduced");

    if (q.taxes) check(m.sellTaxPct <= 15, "Sell tax under hard cap", "Sell tax exceeds 15%");
    else warnings.push("Token tax data is not verified");

    if (m.chainFamily === "solana") {
      if (!q.authorities) unknown("Solana mint/freeze authority verification unavailable");
      else {
        check(!m.mintAuthority, "Mint authority disabled", "Mint authority is still enabled");
        check(!m.freezeAuthority, "Freeze authority disabled", "Freeze authority is still enabled");
      }
    } else {
      if (!q.ownership) warnings.push("Contract ownership status is not verified");
      else if (!m.ownershipRenounced) warnings.push("Contract ownership remains active");
      if (m.proxyContract) warnings.push("Upgradeable/proxy contract requires elevated monitoring");
    }

    if (!q.liquidityLock) warnings.push("Liquidity lock/burn status is not verified");
    else if (!m.liquidityLocked) warnings.push("Liquidity is not verified as locked/burned");
    if (!q.smartMoney) warnings.push("Smart-money provider is not connected; Wallet Tracker will not invent wallet labels");
    if (!q.socialVelocity) warnings.push("Social-velocity provider is not connected; Social Scout will not invent social momentum");
  } else {
    check(m.sellable, "Sellability verified", "Sellability check failed");
    check(!m.honeypot, "Honeypot simulation passed", "Honeypot behavior detected");
    check(m.top10Pct <= 80, "Top-10 concentration under hard cap", "Top 10 holders exceed 80% of supply");
    check(m.bundledPct <= 25, "Bundled supply under hard cap", "Bundled supply exceeds 25%");
    check(m.sellTaxPct <= 15, "Sell tax under hard cap", "Sell tax exceeds 15%");
    if (m.chainFamily === "solana") {
      check(!m.mintAuthority, "Mint authority disabled", "Mint authority is still enabled");
      check(!m.freezeAuthority, "Freeze authority disabled", "Freeze authority is still enabled");
    } else {
      if (!m.ownershipRenounced) warnings.push("Contract ownership remains active");
      if (m.proxyContract) warnings.push("Upgradeable/proxy contract requires elevated monitoring");
    }
    if (!m.liquidityLocked) warnings.push("Liquidity lock/burn not verified");
  }

  // ---- v15 entry filters F3/F5 ----
  // F3: liquidity floor. Unreported liquidity is always a veto. Otherwise the
  // effective floor is max(v9 floor, $10k): early-runner $5k -> $10k, standard $25k stays.
  const liqMissing = m.liquidityReported === false;
  const v9LiqFloor = earlyRunnerLane
    ? Math.max(5_000, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 5_000))
    : 25_000;
  const liqFloor = Math.max(v9LiqFloor, ENTRY_FILTERS.MIN_LIQ_USD);
  const f3Veto = liqMissing || m.liquidity < liqFloor;
  if (liqMissing) {
    hardBlocks.push("liquidity unreported — veto");
  } else {
    check(
      m.liquidity >= liqFloor,
      `Liquidity above $${liqFloor.toLocaleString()} entry floor`,
      `Liquidity below $${liqFloor.toLocaleString()} entry floor`,
    );
  }

  // F5: newborn rule. Age is generally available (snapshotFromPair floors at 1
  // minute), so a non-positive age is treated as unknown => newborn-strict.
  // Newborns must pass F1/F2/F3 clean AND show known m5 buy pressure >= 2.0x.
  const m5ratio = m5BuySellRatio(m);
  const ageUnknown = !(m.ageMinutes > 0);
  const newborn = ageUnknown || m.ageMinutes < ENTRY_FILTERS.NEWBORN_AGE_MIN;
  if (newborn) {
    const pressureOk = m5ratio !== undefined && m5ratio >= ENTRY_FILTERS.BUY_PRESSURE_RATIO;
    if (!f1Veto && !f2Veto && !f3Veto && pressureOk) {
      passedChecks.push("Newborn full filter pass (momentum/chase/liquidity clean, m5 buy pressure ≥ 2.0x)");
    } else {
      const failing: string[] = [];
      if (f1Veto) failing.push("5m momentum");
      if (f2Veto) failing.push("hourly chase");
      if (f3Veto) failing.push("liquidity");
      if (!pressureOk) failing.push(`m5 buy pressure ≥ ${ENTRY_FILTERS.BUY_PRESSURE_RATIO.toFixed(1)}x`);
      hardBlocks.push(`newborn requires full filter pass — failing: ${failing.join(", ")}`);
    }
  }
  if (paperResearchMode) {
    // Paper kill switches are enforced: new entries halt when the day's loss
    // reaches maxDailyLossPct, when open positions reach maxOpenPositions, or
    // when total/chain exposure reach their caps. The wallet day rollover
    // resets the daily-loss switch. Cash alone is no longer the only boundary.
    check(p.dailyPnlPct > -p.maxDailyLossPct, "Paper daily loss limit available", "Paper daily-loss kill-switch triggered");
    check(p.openPositions < p.maxOpenPositions, "Paper open-position capacity available", "Paper maximum open positions reached");
    check(p.totalExposurePct < p.maxTotalExposurePct, "Paper portfolio exposure below cap", "Paper maximum portfolio exposure reached");
    check(p.chainExposurePct < p.maxChainExposurePct, "Paper chain exposure below cap", "Paper maximum chain exposure reached");
  } else {
    check(p.dailyPnlPct > -p.maxDailyLossPct, "Live daily loss limit available", "Live daily loss kill-switch triggered");
    check(p.openPositions < p.maxOpenPositions, "Live open-position capacity available", "Live maximum open positions reached");
    check(p.totalExposurePct < p.maxTotalExposurePct, "Live portfolio exposure below cap", "Live maximum portfolio exposure reached");
    check(p.chainExposurePct < p.maxChainExposurePct, "Live chain exposure below cap", "Live maximum chain exposure reached");
  }

  if ((q?.top10 ?? true) && m.top10Pct > 40) warnings.push("Holder concentration is elevated");
  if ((q?.bundled ?? true) && m.bundledPct > 12) warnings.push("Bundle concentration is elevated");
  if (m.devRugHistory > 0) warnings.push("Deployer has negative launch history");
  if (m.volatility > 0.8) warnings.push("Volatility is extreme");
  if (m.ageMinutes < 5) warnings.push("Token is under five minutes old");
  if ((q?.taxes ?? true) && (m.buyTaxPct > 5 || m.sellTaxPct > 5)) warnings.push("Token taxes are elevated");

  // Paper research sizing is capped tighter than the old V2.17 Runner Lab
  // posture: oversized early-runner entries into thin pools were the dominant
  // paper loss mechanism. Live remains conservative.
  const paperMode = !p.liveTradingEnabled;
  const configuredPaperMax = Math.max(1, Math.min(12, Number(process.env.PAPER_MAX_POSITION_PCT ?? 3)));
  const configuredLiveMax = Math.max(0.25, Math.min(5, Number(process.env.LIVE_MAX_POSITION_PCT ?? 2)));
  let maxPositionPct = paperMode ? configuredPaperMax : configuredLiveMax;

  // F4: buy-pressure size overlay. m5 ratio >= 2.0x => full computed size;
  // known-but-weak => halve BEFORE the v9 caps below apply. Absent m5 data =>
  // neutral (no halving): the overlay must not punish tokens whose venue simply
  // does not report m5 transactions.
  if (m5ratio !== undefined) {
    if (m5ratio >= ENTRY_FILTERS.BUY_PRESSURE_RATIO) {
      passedChecks.push(`m5 buy pressure ${fmtRatio(m5ratio)}x ≥ 2.0x — full size`);
    } else {
      maxPositionPct = maxPositionPct / 2;
      warnings.push(`Weak m5 buy pressure (${fmtRatio(m5ratio)}x < 2.0x) — entry size halved before caps`);
    }
  } else {
    passedChecks.push("m5 buy-pressure overlay neutral — no m5 txn data at decision point");
  }

  // Fail-closed entry sizing: buy-route verification only exists for Solana
  // (Jupiter/0x). On other chains the entry route is never independently
  // verified, and newborn tokens (age <= 60m) are the population that produced
  // every dead paper position. Cap both to a small per-position size instead
  // of a hard ban so paper research can still observe them; the portfolio and
  // chain exposure kill switches above bound the total bucket.
  const routeUnverified = m.chainFamily !== "solana";
  const newbornToken = m.ageMinutes <= 60;
  if (routeUnverified) warnings.push("Buy route is not independently verifiable on this chain; entry size capped");
  if (newbornToken) warnings.push("Newborn token (age <= 60m); entry size capped");

  if (paperMode) {
    if (warnings.length >= 1) maxPositionPct = Math.min(maxPositionPct, 5);
    if (warnings.length >= 2) maxPositionPct = Math.min(maxPositionPct, 3);
    if (warnings.length >= 3) maxPositionPct = Math.min(maxPositionPct, 1.5);
    if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 2.5);
    if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 1);
    if (!earlyRunnerLane && m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 2);
    if (routeUnverified || newbornToken) maxPositionPct = Math.min(maxPositionPct, Number(process.env.PAPER_UNVERIFIED_NEWBORN_MAX_PCT ?? 1));
  } else {
    if (warnings.length >= 1) maxPositionPct = Math.min(maxPositionPct, 1.25);
    if (warnings.length >= 2) maxPositionPct = Math.min(maxPositionPct, 0.75);
    if (warnings.length >= 3) maxPositionPct = Math.min(maxPositionPct, 0.5);
    if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 0.5);
    if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 0.25);
    if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 0.5);
  }
  if (!paperResearchMode) {
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
    maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  } else if (!hardBlocks.length) {
    // Keep execution-plan math non-zero; actual PAPER sizing is replaced downstream
    // by Runner Genome sizing with a $50 minimum and current wallet cash ceiling.
    maxPositionPct = Math.max(maxPositionPct, 0.25);
  }
  if (hardBlocks.length) maxPositionPct = 0;

  const riskScore = Math.max(0, Math.min(100, Math.round(100 - warnings.length * 8 - hardBlocks.length * 35 - m.volatility * 10)));
  return { passed: hardBlocks.length === 0, hardBlocks, warnings, passedChecks, maxPositionPct, riskScore };
}
