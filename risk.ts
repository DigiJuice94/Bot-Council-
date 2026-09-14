import type { MarketSnapshot, RiskCheck } from "./types";

export function runHardRiskChecks(m: MarketSnapshot): RiskCheck {
  const hardBlocks: string[] = [];
  const warnings: string[] = [];

  if (!m.sellable) hardBlocks.push("Sellability check failed");
  if (m.mintAuthority) hardBlocks.push("Mint authority is still enabled");
  if (m.freezeAuthority) hardBlocks.push("Freeze authority is still enabled");
  if (m.top10Pct > 80) hardBlocks.push("Top 10 holders exceed 80% of supply");
  if (m.bundledPct > 25) hardBlocks.push("Bundled supply exceeds 25%");
  if (m.liquidity < 15000) hardBlocks.push("Executable liquidity below V1 minimum");

  if (m.top10Pct > 40) warnings.push("Holder concentration is elevated");
  if (m.bundledPct > 12) warnings.push("Bundle concentration is elevated");
  if (m.devRugHistory > 0) warnings.push("Deployer has negative launch history");
  if (m.volatility > 0.8) warnings.push("Volatility is extreme");
  if (m.ageMinutes < 5) warnings.push("Token is under five minutes old");

  let maxPositionPct = 2;
  if (warnings.length >= 1) maxPositionPct = 1.25;
  if (warnings.length >= 2) maxPositionPct = 0.75;
  if (m.liquidity < 50000) maxPositionPct = Math.min(maxPositionPct, 0.5);
  if (hardBlocks.length) maxPositionPct = 0;

  return { passed: hardBlocks.length === 0, hardBlocks, warnings, maxPositionPct };
}
