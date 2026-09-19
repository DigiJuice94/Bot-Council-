# Bot War Room V3

## V3.6.0 Risk Reaper + Verified Sellability

V3.6 removes the retired Claude **Alpha Hunter**, **Profit Optimizer**, and **Survival CIO** seats. **Risk Reaper is the only Claude seat left.** It can only PASS or VETO a local BUY/WATCH candidate; it cannot upgrade WATCH to BUY, increase size, control exits, or override deterministic safety. Its survival ledger uses a new V3.6 namespace so the prior scorecard—corrupted by unverified paper profits—does not keep the surviving seat dead on deploy.

Sellability is now fail-closed at the money boundary. Immediately before every PAPER buy, the bot performs a reverse sell-route preflight on the approximate position quantity. **PASS with a real executable route is required before any paper-wallet debit.** Solana uses Jupiter token→USDC reverse quotes. Ethereum/Base/BNB use 0x when `ZEROEX_API_KEY` is configured. Chains without a supported reverse-route provider are blocked from new PAPER entries rather than assumed sellable. A pool/liquidity number alone is never treated as proof that capital can exit.

Guardian exits are now equally strict. A PAPER trim or full exit is settled only when Audit Bot returns **PASS** with a positive executable quote. The quoted output—not the dashboard mark—is the only amount credited as realized proceeds. **UNKNOWN never creates a sale or profit**; the position remains open/exit-pending with zero new realized proceeds until verification recovers. A hard FAIL is rechecked once; two consecutive hard FAILs move the position to **Unsellable / Locked Capital**, credit no fake proceeds, and count the remaining cost as lost capital.

Paper fill records now persist route-verification metadata (`routeVerified`, provider, and route note) so future accounting can distinguish verified proceeds from modeled marks. Existing historical fills are not rewritten automatically.

## Historical: V3.5.0 Four-Seat Claude Survival Council (retired in V3.6)

V3.5 builds on V3.4 without replacing the fast local Council. Candidates are still discovered and measured locally first. Only PAPER candidates that pass deterministic hard risk and reach local BUY/WATCH summon the Claude layer, keeping obvious junk off the paid path. Three Claude specialists lock independent reads in parallel: **Alpha Hunter** looks for asymmetric early-runner upside, **Risk Reaper** tries to kill weak/distributing setups, and **Profit Optimizer** judges whether the entry has a credible profit-capture path. A fourth seat, **Survival CIO**, sees those locked reads plus the local Council evidence and returns BACK/PASS/VETO. BACK can upgrade a local WATCH to BUY, PASS preserves the local decision, and VETO rejects the entry. Claude can never override hard liquidity, sellability, honeypot/security, stop-loss or execution rules.

The existing V3.4 Profit Optimizer remains active after entry, so the same Profit Optimizer seat participates in the entry meeting and later reviews near-target take profits / soft profitable exits. All four seats share the existing `ANTHROPIC_API_KEY`; separate API keys are not required.

**Make money or lose your seat:** each Claude seat has a persistent Redis-backed scorecard tracking calls, input/output tokens, estimated API cost, settled trades, wins/losses, attributed trade value and net value after API cost. After the configured sample thresholds, an underwater seat moves to PROBATION and then DEAD. A DEAD seat stops receiving paid Claude calls automatically. The local deterministic Council and Guardian remain available if a seat dies or Anthropic fails. Trade-value attribution is intentionally directional rather than a claim of exact counterfactual P/L: BACK owns the realized direction, VETO is rewarded for correctly opposing losses and penalized for opposing winners, and PASS receives small attribution.

The dashboard now exposes all four survival scorecards. Cost is estimated from actual Anthropic input/output token counts using configurable per-million-token prices (`CLAUDE_INPUT_COST_PER_MILLION_USD` and `CLAUDE_OUTPUT_COST_PER_MILLION_USD`), so those values should match the pricing on the Anthropic account/model being used. Defaults are only bookkeeping assumptions and do not change Anthropic billing.

## Historical: V3.4.0 Claude Profit Optimizer (retired in V3.6)

This release adds an optional Claude-powered Profit Optimizer on top of the existing local Quant, Exit Strategist and Position Guardian. Scanning, candidate scoring and the Council remain local and fast. Claude is called only for PAPER positions around profit-management moments, with a per-position review throttle (default 60 seconds) so the 5-second Guardian loop does not turn into an LLM call loop. When a position gets within five percentage points of its next take-profit level, the optimizer can pre-review that TP so a fast move can often use a cached Claude decision instead of waiting at the exact sell trigger.

When the deterministic Guardian reaches a scheduled take-profit or a soft profitable Exit Strategist decision, Claude receives the current mark, entry/high-water structure, buy/sell pressure, volume acceleration, liquidity, Runner Exit Genome context, realized profit and local Exit Strategist state. It returns a bounded HOLD/TRIM/EXIT opinion. On scheduled take-profit events it can defer the trim or resize it to 10-35% of scaled size. It can reconsider only a soft, profitable Exit Strategist exit. It cannot add size, bypass zero-liquidity/security rules, cancel stop-loss/breakeven/trailing/time exits, or block an already-pending verified exit. If Claude times out, errors, returns malformed output or is not configured, the existing deterministic Guardian behavior continues unchanged. The latest Claude recommendation/error is persisted on the position and shown on Active Trade cards.

Required Railway variable: `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`). Optional controls are `CLAUDE_PROFIT_OPTIMIZER_ENABLED`, `CLAUDE_PROFIT_OPTIMIZER_MODEL`, `CLAUDE_PROFIT_OPTIMIZER_REVIEW_MS`, `CLAUDE_PROFIT_OPTIMIZER_TIMEOUT_MS`. Default model is `claude-sonnet-5`. Anthropic API billing is separate from the normal Claude chat subscription.

## V3.3.2 pending-exit repair and buy diagnostics

The Guardian no longer treats missing sellability verification as an emergency exit signal. The old strategy also set a $15,000 emergency-exit liquidity floor for early runners that were explicitly allowed to enter smaller pools. New early-runner exits use a floor tied to their entry liquidity; previously opened trades with a recorded sub-$15,000 entry pool get the corrected floor when Guardian reviews them. On each cycle it re-evaluates previously pending positions against actual exit reasons: if no exit trigger remains, the position returns to Open; if a real stop, security change or hold limit still calls for an exit, it remains pending until a verified sale or loss can be recorded. No sale proceeds are invented and no PAPER wallet balance is reset. Pending cards display their recorded reason.

The top navigation now links to the existing Decision Funnel under "WHY TRADES STOP". That panel reports the number of candidates, BUY signals and actual PAPER fills, plus the leading rejection reasons. The independent Liquidity Auditor from V3.3.1 still requires confirmation from the second pool provider; an unavailable or unmatched second provider will block new buys and appear in those rejection counts. This may reduce trading during provider outages. The Council's buy thresholds and trade sizing remain unchanged.

## V3.3.1 Liquidity Auditor

This release builds directly on the V3.3.0 locked-capital buy strategy. The Council's candidate scoring, BUY/WATCH thresholds, scan cycle and position sizing are unchanged. Immediately before a PAPER buy, the Liquidity Auditor queries GeckoTerminal for the exact pool address selected by the existing DEX Screener execution snapshot, verifies its base token address, and requires an independent positive pool reserve. If the second provider cannot confirm the same pool, has no data, shows less than half the original liquidity, or shows insufficient reserves for the order, it blocks the entry and records the reason. The existing last-minute DEX check and simulated slippage check still run. The second lookup adds up to five seconds to a prospective buy, not to scans that have no buy candidate.

Pool reserve is an estimate, not proof that a token can be sold. The Guardian now requires verified sellability before labeling a pending exit an unsellable loss. If live sellability evidence is missing, it keeps the position pending without inventing sale proceeds or booking a proven loss. Already recorded losses are preserved; the new check cannot establish whether a past sell was possible. No paper wallet reset is triggered by this release. A failed or unsupported independent pool lookup blocks the buy rather than silently accepting one provider's report.

## V3.3 locked-capital accounting

When Guardian confirms that an owned PAPER token is not sellable, is a honeypot, or can freeze transfers, the position is moved to **Unsellable / Locked Capital**. No simulated sale proceeds are credited. The remaining cost is counted as a loss in verified portfolio accounting, the stuck token remains visible, and the completed failure is retained by specialist learning. Entry rules, Council thresholds, profit-taking levels, and Moon Bag behavior are unchanged.

Zero liquidity is an absolute execution rule: a candidate reporting `$0` liquidity cannot be bought, regardless of Council output. If an already-owned token later reaches `$0` liquidity, Guardian records it as Unsellable with `$0` proceeds rather than manufacturing a paper exit.

Every PAPER buy now performs a second fresh token lookup immediately before fill creation. The order fails closed when that lookup is missing, stale/non-executable, or reports `$0` liquidity, preventing an earlier Council snapshot from authorizing a pool that disappeared while the Council was deliberating.

## Fast dashboard, Moon Bags and one-time fresh bankroll

This release automatically starts one fresh, verified PAPER ledger at server startup, before runtime loops start. It uses the existing configured starting balance (default $1,000), clears the PAPER trade log/positions/fills and starts a new portfolio history marker. Runner Genome, Filing Cabinet, Trajectory Observer and private agent research are retained. Keep REDIS_URL connected to the same existing database: the completed release marker is stored in wallet reset metadata so subsequent restarts do not restart the run. Do not clear that metadata.

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

Set `REDIS_URL` to preserve the existing paper wallet, managed positions, all-time portfolio history, Runner Genome/Filing Cabinet research, Trajectory Observer research, and private Council entity memories. The Redis key namespaces are unchanged from V2.29.4.

`PAPER_STARTING_CASH_USD` controls the reset bankroll and defaults to `$1,000`.

The fast specialist Council remains local and does not require OpenAI. V3.6 uses the configured Anthropic key only for Claude Risk Reaper on qualifying BUY/WATCH candidates. The three other Claude seats and the post-entry Profit Optimizer are retired. No OpenAI/ChatGPT API is required.

## Historical: V3.5.1 Audit-only repair (superseded by V3.6)

V3.5.1 briefly allowed an `UNKNOWN` independent sell audit to fall back to a modeled PAPER close so positions would not remain pending. **That behavior is removed in V3.6 because it could manufacture realized profit when real sellability was not proven.** V3.6 requires a verified reverse route before either entry capital is committed or sell proceeds are credited.
