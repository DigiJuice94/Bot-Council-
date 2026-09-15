# Bot War Room V2.11.2 — Real Paper Feed

This patch removes the remaining fake/demo runtime path from the autonomous website.

## What was wrong in V2.11

The autonomous server correctly refused to auto-execute demo candidates when `MARKET_DATA_BASE_URL` was missing, but the dashboard still rendered a hard-coded `$WAVE` / `$0.0124` / `78%` placeholder. The `/api/cycle` route also still had a fallback to `createDemoScoutCandidate()`. That made the site *look* like it was evaluating a token even though the paper trader was waiting for a market-data adapter.

## V2.11.2 fixes

- **No fake token card:** when there is no real candidate yet, the decision card says `LIVE FEED / SCANNING` and renders dashes instead of a fake token, price, conviction, or risk level.
- **No demo fallback in `/api/cycle`:** if no real candidate exists, the API returns a real-data unavailable response instead of inventing a token.
- **Built-in live discovery:** when no custom adapter is explicitly selected, the server now discovers real candidates from DEX Screener across Solana, Ethereum, Base, BNB Chain, Monad, and Robinhood Chain.
- **Real mark prices for Guardian:** open paper positions are refreshed from the live DEX pair instead of a mock snapshot.
- **GoPlus security enrichment:** live candidates are enriched with contract/security information. Solana uses GoPlus' Solana token-security endpoint; EVM chains use the chain-specific token-security endpoint.
- **Fail closed on critical unknown safety:** if sellability/honeypot verification is unavailable, or Solana mint/freeze authority cannot be verified, the deterministic risk gate blocks the paper entry instead of assuming the token is safe.
- **Unknown means unknown:** bundled supply, smart-money flow, and social velocity are not fabricated. Missing providers create warnings and reduce paper position size.
- **Default is real data:** a legacy `MARKET_DATA_BASE_URL` is used for live scanning only when `WAR_ROOM_MARKET_DATA_MODE=adapter` is explicitly set. Otherwise the autonomous scanner uses direct live DEX discovery.
- **Eight-bot Council remains intact:** Launch Scout, Social Scout, Wallet Tracker, Quant Bot, Contract Bot, Bear Bot, CIO, and Executor still form the decision path. This patch changes the evidence source, not the Council architecture.
- **Automatic paper execution remains server-owned:** no Scan button and no Execute Paper button are required. A verified Council BUY is automatically paper-filled and handed to Position Guardian.

## Important scope

This is **paper trading**, not live-money execution. Direct DEX discovery does not magically provide every data domain. V2.11.2 deliberately leaves unavailable social/smart-money/bundle fields unverified rather than making them up. Dedicated providers can be connected later to strengthen those bots without changing the autonomous paper path.
