import type { MarketSnapshot, PortfolioRiskContext, RiskCheck } from "./types";

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

  if (m.launchpad?.detected) {
    check(
      m.launchpad.status === "graduated",
      `${m.launchpad.platform} graduation verified on an executable DEX pool`,
      `${m.launchpad.platform} token is still bonding or lacks verified DEX graduation`,
    );
  }

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

  if (earlyRunnerLane) {
    // Early runners are intentionally tiny. Do not demand mature-token liquidity;
    // require a real pool, then let order-size/slippage feasibility decide the $50+ paper order.
    check(m.liquidity >= Math.max(500, Number(process.env.PAPER_EARLY_RUNNER_ABSOLUTE_MIN_LIQUIDITY_USD ?? 1_000)), "Early-runner pool has executable liquidity", "Early-runner pool liquidity is too small to model a real exit");
    if (m.liquidity < 5_000) warnings.push("Very thin early-runner liquidity; route/slippage model must prove the order executable");
  } else {
    check(m.liquidity >= 15_000, "Executable liquidity above minimum", "Executable liquidity below minimum");
  }
  if (paperResearchMode) {
    passedChecks.push("Paper Runner Lab has NO daily-loss kill switch");
    passedChecks.push("Paper Runner Lab has NO max-open-position kill switch");
    passedChecks.push("Paper Runner Lab has NO portfolio-exposure kill switch");
    passedChecks.push("Paper Runner Lab has NO chain-exposure kill switch");
    passedChecks.push("Actual paper-wallet cash is the only portfolio capital boundary");
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

  // V2.17: paper research can take materially larger positions so wins/losses
  // teach the Runner Genome with meaningful portfolio impact. Live remains conservative.
  const paperMode = !p.liveTradingEnabled;
  const configuredPaperMax = Math.max(1, Math.min(12, Number(process.env.PAPER_MAX_POSITION_PCT ?? 7.5)));
  const configuredLiveMax = Math.max(0.25, Math.min(5, Number(process.env.LIVE_MAX_POSITION_PCT ?? 2)));
  let maxPositionPct = paperMode ? configuredPaperMax : configuredLiveMax;

  if (paperMode) {
    if (warnings.length >= 1) maxPositionPct = Math.min(maxPositionPct, 5);
    if (warnings.length >= 2) maxPositionPct = Math.min(maxPositionPct, 3);
    if (warnings.length >= 3) maxPositionPct = Math.min(maxPositionPct, 1.5);
    if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 2.5);
    if (directLive && q && (!q.sellability || !q.honeypot || (m.chainFamily === "solana" && !q.authorities))) maxPositionPct = Math.min(maxPositionPct, 1);
    if (!earlyRunnerLane && m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 2);
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
