import { createMockSnapshot } from "./mock-market";
import type { Chain, MarketSnapshot } from "./types";

const demoSymbols: Record<Chain, string[]> = {
  Solana: ["NEON", "WAVE", "FLOCK", "TRENCH"],
  Ethereum: ["AIX", "ORBIT", "SYNTH", "NOVA"],
  Base: ["BYTE", "BASED", "LOOP", "STACK"],
  "BNB Chain": ["BNBX", "HIVE", "PULSE", "BOLT"],
  Monad: ["MONK", "MOMO", "RUSH", "ARC"],
  "Robinhood Chain": ["RWA", "HOODX", "EQUITY", "VAULT"],
};

function evmDemoAddress(index: number) {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

export function createDemoScoutCandidate(previous: MarketSnapshot | undefined, chain: Chain): MarketSnapshot {
  const symbols = demoSymbols[chain];
  const previousIndex = previous?.chain === chain ? symbols.indexOf(previous.symbol) : -1;
  const nextIndex = (previousIndex + 1 + symbols.length) % symbols.length;
  const symbol = symbols[nextIndex];
  const snapshot = createMockSnapshot(undefined, chain);
  const seed = nextIndex + chain.length;
  return {
    ...snapshot,
    symbol,
    name: `${symbol} Scout Demo`,
    tokenAddress: snapshot.chainFamily === "solana" ? `Demo${symbol}111111111111111111111111111111111` : evmDemoAddress(seed),
    volumeAccelerationPct: 80 + seed * 12,
    holderGrowthPct: 3 + seed * 0.8,
    liquidityChangePct: 1 + seed * 0.3,
    marketCapChange5mPct: 2 + seed * 0.5,
    launchMetrics: {
      holdersPerMinute: Math.max(0.2, snapshot.holders / Math.max(30, snapshot.ageMinutes)),
      transactionsPerMinute: 18 + seed * 4,
      uniqueBuyersPerMinute: 2 + seed * 0.5,
      volumeUsdPerMinute: Math.max(1_000, snapshot.volume24h / Math.max(60, Math.min(1440, snapshot.ageMinutes))),
      liquidityAddedUsdPerMinute: Math.max(100, snapshot.liquidity / Math.max(60, Math.min(1440, snapshot.ageMinutes))),
      holderAccelerationPct: 20 + seed * 3,
      transactionAccelerationPct: 30 + seed * 4,
      volumeAccelerationPct: 80 + seed * 12,
    },
    context: {
      benchmark24hPct: 1.2,
      benchmark7dPct: 4.8,
      marketBreadthPct: 58,
      chainVolumeChangePct: 24 + seed * 3,
      newPairs1h: 26 + seed,
      newPairsChangePct: 18 + seed * 2,
      fearGreed: 61,
    },
  };
}
