# Bot War Room V3

## V3.4 Sellability Investigator

The Council now has nine independent local entities: eight private-read specialists plus the separate Runner CIO. The new **Sellability Investigator** has a Council seat and a deliberately narrow job. Every Unsellable / Locked Capital outcome preserves its entry-time liquidity, liquidity/market-cap, volume/liquidity, holder concentration, bundle, tax, authority, ownership, lock and provider-verification fingerprint in Redis. Every future candidate is compared with those filed failures. One unusual loss can inform the vote but cannot create a learned ban; blocking requires repeated close cases, including a same-chain match, at high aggregate risk.

Recognized Pump.fun, Moonshot, Four.meme and Fomo launchpad candidates must prove graduation before entry. A launchpad/bonding venue is a hard SKIP. Graduation is accepted only when the fresh execution snapshot identifies a separate DEX pair with executable liquidity. Ordinary non-launchpad DEX tokens keep the existing entry rules. This graduation and learned-sellability check runs both during the independent Council round and again on the fresh last-mile snapshot immediately before every PAPER fill.

The Sellability Investigator is local and uses no OpenAI/ChatGPT API. Its case file is preserved across wallet resets together with the existing learning stores. This V3.4 package intentionally triggers one fresh PAPER wallet reset on its first successful deployment only; later restarts retain the new run.

## V3.3 locked-capital accounting

When Guardian confirms that an owned PAPER token is not sellable, is a honeypot, or can freeze transfers, the position is moved to **Unsellable / Locked Capital**. No simulated sale proceeds are credited. The remaining cost is counted as a loss in verified portfolio accounting, the stuck token remains visible, and the completed failure is retained by specialist learning. Entry rules, Council thresholds, profit-taking levels, and Moon Bag behavior are unchanged.

Zero liquidity is an absolute execution rule: a candidate reporting `$0` liquidity cannot be bought, regardless of Council output. If an already-owned token later reaches `$0` liquidity, Guardian records it as Unsellable with `$0` proceeds rather than manufacturing a paper exit.

Every PAPER buy now performs a second fresh token lookup immediately before fill creation. The order fails closed when that lookup is missing, stale/non-executable, or reports `$0` liquidity, preventing an earlier Council snapshot from authorizing a pool that disappeared while the Council was deliberating.

## Fast dashboard, Moon Bags and one-time fresh bankroll

This release automatically starts one fresh, verified PAPER ledger before the autopilot, Guardian, cycle API, or position API can perform PAPER work. The runtime entry points await the reset directly, so correctness does not depend on Railway invoking the Next.js instrumentation hook. It uses the existing configured starting balance (default $1,000), clears the PAPER trade log/positions/fills and starts a new portfolio history marker. Runner Genome, Filing Cabinet, Trajectory Observer and private agent research are retained. Keep REDIS_URL connected to the same existing database: the completed release marker is stored in wallet reset metadata so subsequent restarts do not restart the run. Do not clear that metadata.

The background Portfolio Auditor is the single source of truth for Cash, Open Cost, Current Position Value, Unrealized P/L, Realized P/L, Total P/L and Equity. It reconciles the full server ledger rather than the limited UI trade list. Cross-process execution leases prevent overlapping Railway workers from applying the same PAPER buy, trim or exit twice. Automatic research refills are disabled by default; if explicitly enabled, added PAPER capital is tracked separately and excluded from profit.

The visible Council chat has been removed from the browser while the local Council, its private/meeting rounds, memories and trading decisions continue running unchanged. One shared status poll now feeds the dashboard panels. Open positions are separated into Active Trades and Moon Bags; the latter reconcile realized profit, remaining-position P/L and total trade P/L without double-counting.

## Wallet reset repair

This release changes only the dashboard reset flow and wallet snapshot/reset synchronization. Buying, selling, exit rules and research algorithms are unchanged. Reset restores the configured bankroll, clears PAPER positions and trade/portfolio display history without creating synthetic sells, and retains learned research in its separate stores. Trading resumes normally; subsequent fresh buys may spend the new balance.

The dashboard now uses the reset endpoint's returned wallet immediately, rejects pre-reset polling responses, and releases the reset button without waiting for the research-heavy autopilot endpoint. After 20 seconds without a response it reports an unknown outcome and advises refreshing, rather than claiming the reset failed or retrying automatically.

Validation: reproduced the old handler hanging on a delayed autopilot response; tested the repaired handler with successful and timed-out reset requests. Tested the actual reset route handler with isolated simulated Redis data containing 62 open positions, a completed position, fills, all-time history and learning sentinel records. Verified default $1,000 and configured $2,500 balances, retained history/learning, and an overlapping history-writing read. TypeScript checking and production build passed. This is not a test against the deployed Railway Redis instance.

Clean source-of-truth baseline flattened from the complete V2.29.4 runtime.

## Validation

```bash
npm ci
npm run typecheck
npm run build
```

The Railway Docker deployment uses Next.js standalone output and starts with `node server.js`.

## Railway deployment

Extract the ZIP and upload the contents of Bot-War-Room-V3-FULL to the repository root. Keep existing Railway environment variables and Redis unchanged.

The source remains in normal app/, components/, lib/, and public/ folders. An upload-safe deployment archive contains an exact copy of those current folders because some browser-based repository uploads omit directory trees. Docker extracts that current copy authoritatively before every build, preventing either missing folders or stale root files from being deployed.

Use the included Dockerfile. No prepare-structure script or V2 patch chain is used. When changing source in the future, deployment-source.tar.gz must be regenerated from the same final source before packaging.

## Persistence

Set `REDIS_URL` to preserve the existing paper wallet, managed positions, all-time portfolio history, Runner Genome/Filing Cabinet research, Trajectory Observer research, private Council entity memories and Sellability Investigator cases. Existing Redis key namespaces remain unchanged from V2.29.4; V3.4 adds a separate `bot-war-room:sellability-investigator:v1:cases` research key without migrating or deleting prior data.

`PAPER_STARTING_CASH_USD` controls the reset bankroll and defaults to `$1,000`.

No OpenAI API key or paid LLM service is used by the local Council.
