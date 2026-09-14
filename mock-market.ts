import type { MarketSnapshot } from "./types";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const jitter = (base: number, pct: number) => base * (1 + (Math.random() * 2 - 1) * pct);

export function createMockSnapshot(previous?: MarketSnapshot): MarketSnapshot {
  const base: MarketSnapshot = previous ?? {
    symbol: "NEON",
    name: "Neon Protocol Demo",
    chain: "Solana",
    venue: "Demo DEX",
    price: 0.00423,
    priceChange24h: 18.7,
    marketCap: 423000,
    liquidity: 118000,
    volume5m: 38600,
    volume24h: 684000,
    holders: 1842,
    ageMinutes: 43,
    buySellRatio: 1.86,
    smartMoneyBuys: 6,
    smartMoneySells: 1,
    socialVelocityPct: 212,
    top10Pct: 22.4,
    bundledPct: 6.8,
    devRugHistory: 0,
    mintAuthority: false,
    freezeAuthority: false,
    sellable: true,
    volatility: 0.58,
  };

  const delta = Math.random() * 4 - 1.3;
  const price = Math.max(0.000001, base.price * (1 + delta / 100));

  return {
    ...base,
    price,
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
