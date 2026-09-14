# Bot War Room V1

A repo-ready V1 for an 8-agent crypto trading war room. The UI shows specialized agents debating a token, a deterministic safety layer with veto power, a CIO decision, and a paper-only executor.

## What ships in V1

- 8 visible agents: Launch Scout, Social Scout, Wallet Tracker, Quant Bot, Contract Bot, Bear Bot, CIO, Executor
- Live conference-room dashboard with rotating bot discussion
- Server-side consensus engine
- Deterministic hard risk checks that AI cannot override
- BUY / WATCH / SKIP decision flow
- Paper-mode executor only; no wallet signing
- Mock Solana market cycles so the repo runs without API keys
- Provider-ready environment variables for Anthropic, Helius, Jupiter, and Birdeye
- Responsive desktop/mobile layout

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For a production check:

```bash
npm run typecheck
npm run build
npm start
```

## Architecture

```text
Market data / future providers
          |
          v
  Launch / Social / Wallet / Quant / Contract / Bear
          |                    |
          +--------+-----------+
                   v
          deterministic risk layer
                   |
             hard veto first
                   v
                  CIO
                   |
             BUY/WATCH/SKIP
                   v
               Executor
             (paper only V1)
```

The hard safety layer is implemented in `lib/risk.ts`. The multi-agent scoring engine is in `lib/engine.ts`. The demo feed is in `lib/mock-market.ts`.

## Hard V1 safety rules

A setup is blocked if any of these are true:

- sellability check fails
- mint authority remains enabled
- freeze authority remains enabled
- top 10 holders exceed 80%
- bundled supply exceeds 25%
- executable liquidity is below the V1 floor

Position sizing is capped separately by the deterministic risk layer.

## Turning this into the real trading version

Keep the UI and engine contracts, then replace `lib/mock-market.ts` with server-only adapters:

1. **Helius** — on-chain token, wallet, holder and transaction intelligence.
2. **Birdeye / DEX data** — price, liquidity, volume, token discovery and market structure.
3. **Anthropic** — optional language/reasoning layer for agent summaries and debate. Do not let the model bypass deterministic rules.
4. **Jupiter** — quote and swap execution. Keep private keys server-side and only expose signing to the Executor.
5. **Database** — persist opportunities, agent opinions, paper/live trades, fills, outcomes and learning metrics.

## Suggested production folders for V2

```text
lib/providers/helius.ts
lib/providers/birdeye.ts
lib/providers/anthropic.ts
lib/providers/jupiter.ts
lib/execution/paper.ts
lib/execution/live.ts
lib/db/
```

## Important

V1 is intentionally paper/demo only. It is designed to validate the interface, agent responsibilities, consensus behavior, and safety architecture before real funds are connected.

## Deploy

### Railway

This repo includes `Dockerfile` and `railway.toml`. Connect the GitHub repo to Railway and deploy; V1 does not require environment variables.

### Vercel

Import the GitHub repository into Vercel as a Next.js project. No V1 secrets are required.

Before enabling any future live execution, add provider credentials only as server-side deployment secrets—never commit them to GitHub.
