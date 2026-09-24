# Clean Baseline

V3.6.3.9 is the flattened canonical base. It restores the V3.6.3.7 BUY path while retaining ledger reconciliation, Guardian data-path recovery, and a single verified sell-audit handoff into execution.

The repository contains the real Next.js directory tree directly. It also carries one generated `deployment-source.tar.gz` containing that exact canonical tree. Docker removes any stale nested source and restores this archive before compilation, protecting browser-based GitHub uploads that drop folders. This is not a historical update or patch chain.

BUY thresholds, position sizing, liquidity/sellability gates, and autonomous scan cadence were not changed. Wallet accounting now preserves ledger precision, credits only verified execution rows, and rounds at the presentation boundary. Staged take profits total 100%; no residual runner allocation is created.

The retired tournament is not an active product mode. Existing File Cabinet learning is copied once into the canonical namespace, and all new learning uses only that canonical namespace.
