# Bot War Room V3 — Clean Base

This is the flattened canonical baseline for the current Bot War Room.

## Locked trading behavior
- Main File Cabinet strategy runs from one canonical `main:file-cabinet` memory namespace.
- BUY threshold: 54 points.
- Sizing multiplier: 0.97.
- Entry range: $25–$125.
- Maximum active positions: 12.
- BUY decisions execute; WATCH and SKIP remain observational.
- Existing liquidity, sellability, Guardian exit, accounting, and learning behavior remains in place.
- Residual hold allocations are removed. Staged profit targets realize 20% / 20% / 25% / 35% of the original scaled quantity, totaling 100%.
- A partial take-profit remains an Active Trade until the remaining quantity is fully exited.

## Monitoring workspace
The top navigation includes **FILE CABINETS**, which opens a separate read-only workspace with:
- Main File Cabinet
- Rug File Cabinet
- Proof of Work

Each cabinet exposes a Download Data control for analysis outside the running bot.

Proof of Work independently reconstructs persisted paper fills, wallet cash, open exposure, equity and settled P/L. It also reports scanner and Guardian heartbeats without participating in trading decisions.

## Cleanup performed
- Removed the redundant embedded deployment-source archive.
- Removed stale patch-chain release overrides and hard-coded old build labels.
- Migrates accumulated File Cabinet memory into the canonical namespace at startup.
- Immediately rewrites saved open positions to the canonical full-exit policy.
- Kept runtime source, API routes, CSS, trading logic, monitoring, and cabinet exports intact.
- Starts the autonomous scanner and Guardian from the server runtime rather than waiting for a browser visit.

The retired tournament namespace is migration input only. The active Council does not read or write it after startup migration.
