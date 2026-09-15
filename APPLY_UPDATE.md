# Apply Bot War Room V2.14.1

This is a **cumulative V2.13 + V2.14 + V2.14.1 update overlay** for the current `DigiJuice94/Bot-Council-` repository.

1. Extract the ZIP.
2. Upload every file inside `bot-war-room-v2.14.1-update/` to the repository root, replacing same-name files.
3. Keep your existing Railway variables. No new variable is required for the V2.14.1 layout change.
4. Redeploy Railway.

The requested visual change is contained in `v214.css`, which is already copied to `app/v214.css` by `prepare-structure.mjs` and imported by `layout.tsx`.

### Concurrent positions

No code toggle is needed. The current system already allows multiple concurrent positions on different tokens. Default cap: `PAPER_MAX_OPEN_POSITIONS=8`.
