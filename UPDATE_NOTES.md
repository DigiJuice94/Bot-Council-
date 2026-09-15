# Bot War Room V2.11 — Autonomous Council

V2.11 fixes both website issues reported after V2.10.1.

## 1. Council artwork cannot disappear anymore

The exact supplied eight-bot/table artwork is now embedded into the compiled client as a PNG data URI in `council-art.ts`. The browser no longer depends on `/public/bot-council-reference.png` successfully resolving. The original PNG and public copy mapping are still retained as a fallback/provenance asset, but the rendered council scene uses the embedded asset.

This specifically fixes the V2.10.1 failure mode where CSS hid the stand-in bots but a missing/404 public image left the War Room blank.

## 2. No human scan or paper-buy controls

`Scan next candidate`, the auto-scout toggle, and `Execute paper` have been removed from the UI.

A server-owned `autopilot.ts` starts at Node server boot through Next.js `instrumentation.ts`. It rotates across Solana, Ethereum, Base, BNB Chain, Monad and Robinhood Chain. When the eight-bot Council reaches an approved BUY and deterministic risk allows the order, Executor performs the paper fill automatically and registers it with Position Guardian.

Guardian remains a separate server loop responsible for scale-ins, trims, stops, re-entry rules and final exits.

The default autonomous mode remains paper. Live wallet signing is not silently enabled.

## 3. No fake autonomous trading

The autonomous worker only scans `fetchLiveCandidate()` from `MARKET_DATA_BASE_URL`. If the live market-data adapter is not connected, it waits and reports that state. Demo candidates are never auto-executed.

`WAR_ROOM_SCAN_INTERVAL_MS` can change the server scan cadence (2s–60s, default 5s). Chains rotate round-robin, so all six are continuously covered without a person selecting tabs.

## 4. Dashboard matches the agreed monitoring layout

The page now centers the War Room scene and then shows:

- autonomous status
- Chat Log from the real Council discussion
- Trades Log from Guardian-managed positions
- the eight-role Bot Roster
- compact system/safety status

The website is now a monitor for an autonomous system, not a control panel a person must click through.
