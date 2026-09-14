# Bot War Room V2

A GitHub-ready V2 foundation for an 8-agent, multi-chain crypto trading research and paper-execution system.

## What changed from V1

V2 moves the project from a Solana-oriented dashboard demo into a chain-agnostic trading architecture inspired by strong patterns from open-source multi-agent and systematic trading projects.

### Supported chain abstractions

- Solana
- Ethereum
- Base
- BNB Chain
- Monad
- Robinhood Chain

All six chains enter the same War Room, CIO, deterministic risk gate, and execution request schema. Solana routes through a Solana-family adapter boundary; the other five use the EVM-family boundary.

## Eight-agent team

1. **Launch Scout** — discovery, age, volume acceleration and launch quality.
2. **Social Scout** — narrative/social velocity.
3. **Wallet Tracker** — tracked wallet and smart-money flow.
4. **Quant Bot** — price/volume/liquidity/volatility structure.
5. **Contract Bot** — chain-aware contract and token security checks.
6. **Bear Bot** — red-team critique; looks for the strongest reason not to trade.
7. **CIO** — combines research scores into a constrained decision.
8. **Executor** — the only role allowed to create an execution request.

The AI/agent layer never gets veto power over deterministic risk controls.

## V2 decision pipeline

```text
chain opportunity
      |
      v
6 research agents
      |
      v
Bear / red-team pass
      |
      v
CIO decision + conviction
      |
      v
deterministic risk gate  <--- cannot be overridden by AI
      |
      v
shared ExecutionRequest
      |
      +--> paper adapter now
      |
      +--> live adapter later, only after strategy + global approval
```

## Experiment Lab

Every strategy is meant to move through a promotion pipeline instead of being sent directly to a wallet:

```text
RESEARCH -> BACKTEST -> OOS -> PAPER -> LIVE
```

V2 includes an experiment object, metrics, and automatic promotion gates based on:

- evaluated trades
- expectancy
- maximum drawdown
- profit factor
- observed slippage

The default experiment is intentionally kept in **PAPER** even when its promotion metrics pass. Live promotion should require a deliberate governance action and live trading remains disabled by default.

## Paper/live parity

The important V2 design rule is that strategy logic does not know whether an order is paper or live. It produces the same `ExecutionRequest` either way.

Paper mode sends that request to `executePaper()`.

A future live mode will send the same request to a chain adapter after these checks:

- strategy is approved for LIVE
- global live trading switch is enabled
- deterministic risk gate passes
- chain adapter is healthy
- quote/slippage checks pass immediately before signing

This minimizes differences between what is tested and what eventually trades.

## Deterministic risk checks

Current V2 hard blocks include:

- sellability failure
- honeypot behavior
- top-10 concentration above 80%
- bundled supply above 25%
- executable liquidity below minimum
- sell tax above hard cap
- daily loss kill-switch
- maximum open positions
- portfolio exposure limit
- per-chain exposure limit
- Solana mint authority still enabled
- Solana freeze authority still enabled

Warnings reduce maximum position size even if a trade is not vetoed.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The dashboard uses simulated market feeds and cannot submit a real transaction.

## Smoke tests

The core engine does not need Next.js or React to run its smoke tests:

```bash
npm run smoke
```

The test currently checks all six chains and verifies that a forced honeypot is vetoed before execution.

## API routes

### `POST /api/cycle`
Runs a new multi-agent paper-analysis cycle.

Example request:

```json
{
  "chain": "Base",
  "mode": "paper"
}
```

### `POST /api/paper`
Consumes an approved paper `ExecutionRequest` and simulates chain-aware slippage and fees.

The endpoint rejects live requests.

### `GET /api/experiments`
Returns the current core experiment and promotion state.

## Railway

V2 still runs as one Next.js service for the demo. The next infrastructure milestone should split into:

1. Web/API service
2. Bot/market worker
3. Isolated execution worker
4. Postgres
5. Redis/queue

Only the isolated execution worker should ever receive live wallet-signing credentials.

## Environment variables

Copy `.env.example` to `.env.local` when real integrations are added.

No API key is required for the included demo/paper feed.

## Real-data adapters planned

- Solana RPC / Helius-style on-chain data
- Jupiter-style Solana quote/execution adapter
- EVM RPC providers
- EVM DEX/aggregator quote adapter
- market/DEX feeds for liquidity and price
- social/news provider
- persistent Postgres trade/experiment journal

V2 intentionally defines the boundaries before tying the project to any one vendor.

## Open-source design notes

See `docs/OPEN_SOURCE_DESIGN.md`.

V2 reimplements architecture ideas rather than copying GPL/AGPL source. If source code from a third-party project is incorporated later, its license and attribution must be reviewed before merge.

## Important

This repository is an experimental trading system. Backtests, paper results, public project claims and AI confidence scores do not guarantee live profitability. Transaction costs, liquidity, failed transactions, MEV, latency and market regime changes can materially change results.
