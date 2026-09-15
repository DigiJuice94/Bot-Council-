# Apply Bot War Room V2.14

This ZIP is a **cumulative V2.13 + V2.14 update overlay** for the current `DigiJuice94/Bot-Council-` repository.

1. Extract the ZIP.
2. Upload every file inside `bot-war-room-v2.14-update/` to the repository root, replacing files with the same name.
3. Add any new Railway variables you want from `env.example`. The research engine runs without paid fallback providers, but Redis is strongly recommended so the Filing Cabinet survives redeploys.
4. Redeploy Railway. `prepare-structure.mjs` copies the root release files into the Next.js `app/`, `components/` and `lib/` folders during build.

New root files that must be included:
- `runner-research.ts`
- `live-gate.ts`
- `paper-wallet.ts`
- `RunnerResearchPanel.tsx`
- `v214.css`

V2.13 provider/funnel files are included again so this is one update ZIP rather than multiple patch packages.

## Important live-trading detail

The Code Deciphered gate can automatically arm live trading at 100%, but real orders are forwarded only when `LIVE_EXECUTOR_URL` and `LIVE_EXECUTOR_TOKEN` are configured. The dashboard server does not store private keys or fake a live fill.
