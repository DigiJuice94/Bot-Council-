# Bot War Room V3 — Clean Base

This is the flattened clean baseline for the current Bot War Room. The trading formula is intentionally frozen.

## Locked trading behavior
- Main File Cabinet strategy retains the established Team 10 compatibility memory namespace.
- BUY threshold: 54 points.
- Sizing multiplier: 0.97.
- Entry range: $25–$125.
- Maximum active positions: 12.
- BUY decisions execute; WATCH and SKIP remain observational.
- Existing liquidity, sellability, Guardian exit, accounting, and learning behavior remains in place.

## Monitoring workspace
The top navigation includes **FILE CABINETS**, which opens a separate read-only workspace with:
- Main File Cabinet
- Rug File Cabinet
- Proof of Work

Each cabinet exposes a Download Data control for analysis outside the running bot.

## Cleanup performed
- Removed the redundant embedded deployment-source archive.
- Removed stale patch-chain baseline documentation.
- Removed retired tournament wording from the visible UI while preserving compatibility identifiers required by the active strategy.
- Kept runtime source, API routes, CSS, trading logic, monitoring, and cabinet exports intact.

Do not rename the legacy `tournament:team-10` memory namespace without a deliberate migration; it is retained only so the current strategy continues reading the same accumulated memory.
