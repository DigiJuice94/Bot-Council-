# V3.6.3.13 — unverified is not a loss

The V3.6.3.12 `exit_unverified` state removed unverified positions from liquid equity at zero, producing an apparent total loss even though no zero-liquidity or scam evidence existed. Live observations showed six unresolved positions with UNKNOWN audits and stale market data, while three other positions exited through the liquidity PAPER model.

Fix: keep remaining unverified cost in wallet equity as an at-risk reserve, separate from cash and confirmed locked-capital losses. Do not book sale proceeds, realized profit, or a loss based solely on missing route verification or stale data. An unverified position still leaves the active trade slot and retries in the background. A fresh live positive-liquidity snapshot can settle a distinctly labeled modeled PAPER exit; confirmed zero liquidity/honeypot/security failure still records a loss. Zero-cost mark is no longer assigned when parking.

Modified: `lib/paper-accounting.ts`, `lib/paper-wallet.ts`, `lib/position-lifecycle.ts`, `lib/types.ts`, `lib/cabinet-export.ts`, `components/WarRoomDashboard.tsx`, regression tests. BUY choices and exit triggers unchanged.

Verification: 12 regression tests, TypeScript and production Next build passed. Existing persisted exit-unverified positions recover their remaining cost automatically on the first wallet reconstruction after deployment; no reset is needed.
