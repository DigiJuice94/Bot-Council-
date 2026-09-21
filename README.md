# Bot War Room V3.6.2 · File Cabinet Main Council

The tournament is retired. The exact qualifier Team File Cabinet now controls the persistent main PAPER wallet.

Its tournament configuration is locked: Team 10 memory namespace, no role bias, -3 threshold delta (54-point BUY line), 0.97 sizing multiplier, $25–$125 entries, 12-position maximum, and BUY-only execution. WATCH and SKIP decisions are recorded but never purchased. Global liquidity/sellability protection, reconciled accounting, Guardian exits, Filing Cabinet learning, and live provider scanning remain shared utilities rather than strategy overrides.

The Rug Autopsy Analyst runs inside the existing Filing Cabinet pipeline without a Council seat, scanner, or timer. Confirmed unsellable/locked-capital and catastrophic rug-like outcomes are immediately labeled as dumper cases, their earliest entry fingerprints are retained, and similarity evidence raises the existing Dumper Genome advisory for future candidates. Learned similarity never creates a hard veto by itself; confirmed current zero liquidity, honeypot, unsellability, and authority failures remain deterministic global blocks.

## Main council

- Eight independent local roles use Team File Cabinet's existing private memory namespace.
- Stored research remains advisory evidence for the CIO; it cannot override global safety.
- The promoted council keeps the File Cabinet threshold adjustment and learned runner/dumper evidence.
- Tournament cash, equity and positions are not merged into the main wallet. This prevents artificial gains and preserves accounting integrity.

## Restored utilities

- The primary paper wallet can open new positions again.
- Portfolio, Active Trades, Moon Bags, Unsellable Capital, Detailed Trade Log, File Cabinet research and diagnostics remain active.
- The API now returns the complete managed-position ledger instead of truncating the dashboard to 50 positions.
- Guardian, Exit Strategist, wallet reconciliation and research maintenance continue in the normal scan loop.

## Global safety

- confirmed zero executable liquidity;
- confirmed honeypot or freeze authority;
- positively confirmed unsellability;
- Executor feasibility;
- locked-capital accounting with no invented sale proceeds.

## GitHub/Railway upload protection

The one-folder package includes `deployment-source.tar.gz`. Keep that root-level file. The Docker build extracts it before compilation so `app`, `components`, `lib` and `public` are restored even when a browser-based GitHub upload drops nested folders.

## Run

```bash
npm ci
npm run typecheck
npm run build
npm start
```

Redis is strongly recommended so the main wallet, trade history and promoted File Cabinet memories survive restarts.
