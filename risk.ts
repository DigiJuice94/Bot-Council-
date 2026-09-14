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

  check(m.sellable, "Sellability verified", "Sellability check failed");
  check(!m.honeypot, "Honeypot simulation passed", "Honeypot behavior detected");
  check(m.top10Pct <= 80, "Top-10 concentration under hard cap", "Top 10 holders exceed 80% of supply");
  check(m.bundledPct <= 25, "Bundled supply under hard cap", "Bundled supply exceeds 25%");
  check(m.liquidity >= 15_000, "Executable liquidity above minimum", "Executable liquidity below minimum");
  check(m.sellTaxPct <= 15, "Sell tax under hard cap", "Sell tax exceeds 15%");
  check(p.dailyPnlPct > -p.maxDailyLossPct, "Daily loss limit available", "Daily loss kill-switch triggered");
  check(p.openPositions < p.maxOpenPositions, "Open-position capacity available", "Maximum open positions reached");
  check(p.totalExposurePct < p.maxTotalExposurePct, "Portfolio exposure below cap", "Maximum portfolio exposure reached");
  check(p.chainExposurePct < p.maxChainExposurePct, "Chain exposure below cap", "Maximum chain exposure reached");

  if (m.chainFamily === "solana") {
    check(!m.mintAuthority, "Mint authority disabled", "Mint authority is still enabled");
    check(!m.freezeAuthority, "Freeze authority disabled", "Freeze authority is still enabled");
  } else {
    if (!m.ownershipRenounced) warnings.push("Contract ownership remains active");
    if (m.proxyContract) warnings.push("Upgradeable/proxy contract requires elevated monitoring");
  }

  if (!m.liquidityLocked) warnings.push("Liquidity lock/burn not verified");
  if (m.top10Pct > 40) warnings.push("Holder concentration is elevated");
  if (m.bundledPct > 12) warnings.push("Bundle concentration is elevated");
  if (m.devRugHistory > 0) warnings.push("Deployer has negative launch history");
  if (m.volatility > 0.8) warnings.push("Volatility is extreme");
  if (m.ageMinutes < 5) warnings.push("Token is under five minutes old");
  if (m.buyTaxPct > 5 || m.sellTaxPct > 5) warnings.push("Token taxes are elevated");

  let maxPositionPct = 2;
  if (warnings.length >= 1) maxPositionPct = 1.25;
  if (warnings.length >= 2) maxPositionPct = 0.75;
  if (warnings.length >= 3) maxPositionPct = 0.5;
  if (m.liquidity < 50_000) maxPositionPct = Math.min(maxPositionPct, 0.5);
  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxTotalExposurePct - p.totalExposurePct));
  maxPositionPct = Math.min(maxPositionPct, Math.max(0, p.maxChainExposurePct - p.chainExposurePct));
  if (hardBlocks.length) maxPositionPct = 0;

  const riskScore = Math.max(0, Math.min(100, Math.round(100 - warnings.length * 11 - hardBlocks.length * 35 - m.volatility * 10)));
  return { passed: hardBlocks.length === 0, hardBlocks, warnings, passedChecks, maxPositionPct, riskScore };
}
