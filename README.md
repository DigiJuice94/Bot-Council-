# Bot War Room V3.6.2 — Team File Cabinet Exact

This is the promoted Tournament.13 winner running as the only paper wallet.

## Exact winning environment

- Council ID: `team-10`
- Council name: `Team File Cabinet`
- Eight independent members
- Private memory namespace: `tournament:team-10`
- Starting paper wallet: `$1,000`
- BUY threshold adjustment: `-3` (54-point base line)
- Role bias: none
- Filing Cabinet evidence: advisory
- Size multiplier: `0.97`
- Entry range: `$25–$125`
- Maximum active positions: `12`
- Paper fee: `25 bps`
- Profit trims: 20% at +25%, 20% at +50%, 25% at +100%, 25% at +200%
- Regular positions: maximum 20 minutes
- Early exit: after five minutes when verified buying pressure/volume fades
- Moon bag: approximately 10%, maximum 2 hours
- Mark refresh: original shared Tournament.13 rotation

The former main-wallet Guardian does not run. The other nine councils, qualifier,
draft and final round are removed from the active system.

Turnover enforcement is fail-closed: overdue positions get priority for fresh
exit pricing. If two consecutive fresh executable-market checks fail after the
deadline, no proceeds are invented; remaining capital is recorded as locked/lost.

## Global truth protections retained

- Zero or invalid liquidity is rejected again inside the wallet entry function, so no caller can bypass the no-buy rule.
- Every trim and full sale must carry the current market snapshot; zero or invalid liquidity creates a `LOCKED` event, credits `$0` proceeds and records the remaining cost as lost capital.
- Confirmed honeypots block entry.
- Confirmed Solana freeze authority blocks entry.
- Positively confirmed sellability failures block entry.
- Two confirmed sellability failures on an open position record locked capital.
- Unsellable positions receive no fake sale proceeds.
- Wallet accounting displays an explicit reconciliation status.

## Run

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run typecheck
npm run build
```

Set `REDIS_URL` in deployment so the wallet, trades and learned member memories
survive restarts. The promoted wallet uses its own state key and does not reuse
the completed ten-team tournament ledger or the abandoned legacy main wallet.
