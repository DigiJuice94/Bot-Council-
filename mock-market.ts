import { getChainConfig } from "./chains";
import type { Chain, MarketSnapshot } from "./types";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const jitter = (base: number, pct: number) => base * (1 + (Math.random() * 2 - 1) * pct);

const demoByChain: Record<Chain, { symbol: string; name: string; price: number; marketCap: number; liquidity: number; venue: string }> = {
  Solana: { symbol: "NEON", name: "Neon Protocol Demo", price: 0.00423, marketCap: 423_000, liquidity: 118_000, venue: "Jupiter Paper" },
  Ethereum: { symbol: "AIX", name: "Agent Index Demo", price: 0.0312, marketCap: 3_120_000, liquidity: 610_000, venue: "Uniswap Paper" },
  Base: { symbol: "BYTE", name: "Byte Base Demo", price: 0.0078, marketCap: 780_000, liquidity: 220_000, venue: "Base DEX Paper" },
  "BNB Chain": { symbol: "BNBX", name: "BNB Signal Demo", price: 0.0128, marketCap: 1_280_000, liquidity: 340_000, venue: "Pancake Paper" },
  Monad: { symbol: "MONK", name: "Monad Momentum Demo", price: 0.0194, marketCap: 1_940_000, liquidity: 405_000, venue: "Monad DEX Paper" },
  "Robinhood Chain": { symbol: "RWA", name: "Robinhood RWA Demo", price: 0.042, marketCap: 4_200_000, liquidity: 720_000, venue: "Robinhood DEX Paper" },
};

export function createBaseSnapshot(chain: Chain = "Solana"): MarketSnapshot {
  const d = demoByChain[chain];
  const config = getChainConfig(chain);
  return {
    symbol: d.symbol,
    name: d.name,
    tokenAddress: config.family === "solana" ? "DemoSo111111111111111111111111111111111111" : "0x000000000000000000000000000000000000dEaD",
    chain,
    chainFamily: config.family,
    venue: d.venue,
    price: d.price,
    priceChange24h: 18.7,
    marketCap: d.marketCap,
    liquidity: d.liquidity,
    volume5m: 38_600,
    volume24h: 684_000,
    holders: 1_842,
    ageMinutes: 43,
    buySellRatio: 1.86,
    smartMoneyBuys: 6,
    smartMoneySells: 1,
    socialVelocityPct: 212,
    top10Pct: 22.4,
    bundledPct: 6.8,
    devRugHistory: 0,
    volatility: 0.58,
    sellable: true,
    honeypot: false,
    buyTaxPct: 0,
    sellTaxPct: 0,
    liquidityLocked: true,
    mintAuthority: false,
    freezeAuthority: false,
    ownershipRenounced: config.family === "evm",
    proxyContract: false,
  };
}

export function createMockSnapshot(previous?: MarketSnapshot, chain?: Chain): MarketSnapshot {
  const requestedChain = chain ?? previous?.chain ?? "Solana";
  const base = !previous || previous.chain !== requestedChain ? createBaseSnapshot(requestedChain) : previous;
  const delta = Math.random() * 4 - 1.3;
  return {
    ...base,
    price: Math.max(0.000001, base.price * (1 + delta / 100)),
    priceChange24h: clamp(base.priceChange24h + delta, -80, 300),
    marketCap: jitter(base.marketCap, 0.025),
    liquidity: jitter(base.liquidity, 0.015),
    volume5m: jitter(base.volume5m, 0.12),
    volume24h: jitter(base.volume24h, 0.03),
    holders: Math.max(10, Math.round(base.holders + (Math.random() * 22 - 3))),
    ageMinutes: base.ageMinutes + 1,
    buySellRatio: clamp(jitter(base.buySellRatio, 0.12), 0.15, 5),
    smartMoneyBuys: clamp(Math.round(base.smartMoneyBuys + (Math.random() * 3 - 1)), 0, 20),
    smartMoneySells: clamp(Math.round(base.smartMoneySells + (Math.random() * 2 - 0.5)), 0, 20),
    socialVelocityPct: clamp(jitter(base.socialVelocityPct, 0.1), -100, 1000),
    volatility: clamp(jitter(base.volatility, 0.08), 0.05, 1),
  };
}
