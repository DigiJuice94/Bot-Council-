# Bot War Room V3.6.2 · 80-Bot Council Tournament

This release keeps the verified V3.6.2 trading, liquidity, sellability, Guardian and accounting files locked while adding ten genuinely separate PAPER councils.

## Tournament architecture

- Ten councils receive the same measured market opportunity.
- Every council has eight members: Early Runner Scout, Narrative Scout, Flow Analyst, Pattern Quant, Safety Gate, Dumper Specialist, Portfolio Strategist and Runner CIO.
- Each of the 80 members forms its own private score and vote, uses its own council/role memory namespace and receives its own settled outcome lesson.
- Every council owns a separate $1,000 PAPER wallet, positions, cash, realized P/L and performance ledger.
- Teams 1–9 use controlled variations. Team 10 is Team File Cabinet and treats stored research as advisory evidence.
- Council runs are concurrency-limited to two at a time. This preserves independent decisions without creating 80 processes or repeating provider calls.
- The primary PAPER wallet is sidelined while the tournament is active. Guardian can still manage legacy positions.
- Regular positions have a hard 20-minute maximum and may exit after five minutes when live buy/sell flow and volume acceleration confirm fading pressure. True 10% moon bags are exempt from that turnover rule but close no later than 48 hours after moon-bag conversion.

The Tournament tab shows moving rank, wallet value, realized P/L, active and total trades, Council-run count and the latest vote, score and confidence for every member.

## Safety

The market snapshot is shared, and the following hard protections remain global across all councils:

- confirmed zero executable liquidity;
- confirmed honeypot or freeze authority;
- positively confirmed unsellability;
- Executor feasibility;
- locked-capital accounting with no invented sale proceeds.

UNKNOWN provider coverage remains observational, matching the locked baseline. Hard safety cannot be overridden by team variation or File Cabinet research.

## Two-stage tournament

The qualifier runs for 24 hours by default. After it ends, the best, second-best and third-best performer at each role are drafted into Final Teams 1–3. Drafted roles retain their source member memory stream. Each finalist receives a fresh $1,000 wallet and competes for another 24 hours. If every finalist ends below $1,000, the experiment is marked failed.

This release uses the V3 tournament ledger namespace. Deployment starts a clean qualifier because results produced by the former shared-agent overlay are not valid evidence for an 80-member tournament.

## Tournament.12 GitHub-safe turnover release

The first deployment of this release performs one controlled turnover pass. Every pre-existing PAPER position—including regular positions and moon bags—is queued for a Guardian-verified exit, and tournament entries pause only until the existing tournament positions have cleared. Fresh market snapshots and the normal sellability audit are required: confirmed unsellable positions become locked-capital losses, while positions without a current quote remain pending instead of receiving invented proceeds. The migration is recorded once, so later restarts do not liquidate newly opened trades. Wallet history, realized results, trade logs and learned memory are preserved; this is not a reset.

The Docker build reads the checked-in source tree directly and lets the real Next.js build validate it. It does not require a nested deployment archive or use a brittle pre-build file checklist, keeping GitHub and Railway uploads small and preventing false failures before compilation begins.

Optional controls:

- `TOURNAMENT_QUALIFIER_HOURS` (default `24`)
- `TOURNAMENT_FINAL_HOURS` (default `24`)
- `TOURNAMENT_MAX_OPEN_POSITIONS` (default `12` per council)
- `TOURNAMENT_PAPER_FEE_BPS` (default `25`)
- `WAR_ROOM_SCAN_WORKERS` (`1`–`3`, default `3`)

## Run

```bash
npm ci
npm run typecheck
npm run build
npm start
```

Copy `env.example` to your deployment environment and configure the provider and Redis values you use. Redis is strongly recommended so wallets and all 80 memory streams survive restarts.

See `BASELINE-INTEGRITY.md` for hashes of the locked trading files.
