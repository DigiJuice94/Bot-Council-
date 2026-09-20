# Bot War Room V3.6.2 · File Cabinet Main Council

The tournament is retired. Team File Cabinet—the best qualifier performer—is promoted to the persistent main PAPER wallet.

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
