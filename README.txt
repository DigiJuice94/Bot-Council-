BOT WAR ROOM V2.12.2 — PRODUCTION CLEANUP

This is the compact one-folder real-market paper trader.

Production data path:
Birdeye/DEX Screener -> Helius/Birdeye/GoPlus security -> 8-bot Council -> CIO -> Executor -> deterministic risk -> $1,000 paper wallet -> Position Guardian.

There is no mock-market module or smoke-test market generator in this package.
The build script also deletes stale smoke.ts, mock-market.ts, generated tests/, app/, lib/, and components/ from older Railway uploads before Next.js type-checks the project.

Required Railway variables include BIRDEYE_API_KEY, HELIUS_API_KEY, SOLANA_RPC_URL, JUPITER_API_KEY, REDIS_URL and the PAPER_/WAR_ROOM_ variables already discussed.

This build is paper trading: real market data, simulated capital.
