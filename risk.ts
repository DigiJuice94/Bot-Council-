import type { MarketSnapshot, PortfolioRiskContext, RiskCheck } from "./types";

export const DEFAULT_RISK_CONTEXT: PortfolioRiskContext = {
  equityUsd: 10_000,
  cashUsd: 10_000,
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
  const directLive = m.dataProvenance?.marketSource === "dexscreener";

  if (directLive && q) {
    if (!q.sellability) hardBlocks.push("Sellability verification unavailable from live security provider");
    else check(m.sellable, "Sellability verified", "Sellability check failed");

    if (!q.honeypot) hardBlocks.push("Honeypot verification unavailable from live security provider");
    else check(!m.honeypot, "Honeypot/security simulation passed", "Honeypot behavior detected");

    if (q.top10) check(m.top10Pct <= 80, "Top-10 concentration under hard cap", "Top 10 holders exceed 80% of supply");
    else warnings.push("Top-10 concentration is not verified; paper size reduced");

    if (q.bundled) check(m.bundledPct <= 25, "Bundled supply under hard cap", "Bundled supply exceeds 25%");
    else warnings.push("Bundled-supply concentration is not verified; paper size reduced");

    if (q.taxes) check(m.sellTaxPct <= 15, "Sell tax under hard cap", "Sell tax exceeds 15%");
    else warnings.push("Token tax data is not verified");

    if (m.chainFamily === "solana") {
      if (!q.authorities) hardBlocks.push("Solana mint/freeze authority verification unavailable");
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
    if (!q.smartMoney) warnings.push("Smart-money flow provider is not connected; Wallet Tracker will not invent wallet flow");
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

  check(m.liquidity >= 15_000, "Executable liquidity above minimum", "Executable liquidity below minimum");
  check(p.dailyPnlPct > -p.maxDailyLossPct, "Daily loss limit available", "Daily loss kill-switch triggered");
  check(p.openPositions < p.maxOpenPositions, "Open-position capacity available", "Maximum open positions reached");
  check(p.totalExposurePct < p.maxTotalExposurePct, "Portfolio exposure below cap", "Maximum portfolio exposure reached");
  check(p.chainExposurePct < p.maxChainExposurePct, "Chain exposure below cap", "Maximum chain exposure reached");

  if ((q?.top10 ?? true) && m.top10Pct > 40) warnings.push("Holder concentration is elevated");
  if ((q?.bundled ?? true) && m.bundledPct > 12) warnings.push("Bundle concentration is elevated");
  if (m.devRugHistory > 0) warnings.push("Deployer has negative launch history");
  if (m.volatility > 0.8) warnings.push("Volatility is extreme");
  if (m.ageMinutes < 5) warnings.push("Token is under five minutes old");
  if ((q?.taxes ?? true) && (m.buyTaxPct > 5 || m.sellTaxPct > 5)) warnings.push("Token taxes are elevated");

  let maxPositionPct = 2;
  if (warnings.length >= 1) maxPositionPct = 1.25;
  if (warnings.length >= 2) maxPositionPct = 0.75;
  if (warnings.length >= 3) maxPositionPct = 0.5;
  if (directLive && q && (!q.top10 || !q.bundled || !q.socialVelocity || !q.smartMoney)) maxPositionPct = Math.min(maxPositionPct, 0.5);
  if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 0.5);
  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  if (hardBlocks.length) maxPositionPct = 0;

  const riskScore = Math.max(0, Math.min(100, Math.round(100 - warnings.length * 8 - hardBlocks.length * 35 - m.volatility * 10)));
  return { passed: hardBlocks.length === 0, hardBlocks, warnings, passedChecks, maxPositionPct, riskScore };
}
