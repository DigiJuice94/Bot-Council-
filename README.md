# Bot War Room V3

## Always-live chat and one-time fresh bankroll

This release automatically starts one fresh PAPER run at server startup, before runtime loops start. It uses the existing configured starting balance (default $1,000), clears the PAPER trade log/positions/fills and starts a new portfolio history marker. Runner Genome, Filing Cabinet, Trajectory Observer and private agent research are retained. Keep REDIS_URL connected to the same existing database: the completed release marker is stored in wallet reset metadata so subsequent restarts do not restart the run. Do not clear that metadata. This startup migration is intended for a single app replica; stop the previous deployment before starting this release to avoid old workers writing positions during the reset.

Chat has no pause state or pause/resume controls. New messages keep appearing and scrolling follows new messages even after the 60-message display limit. Current specialist names now map to distinct colors. Council seats, voting, entry/exit thresholds and the background-only observer are unchanged.

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

## Upload-safe deployment

Extract the ZIP and upload the contents of Bot-War-Room-V3-FULL to the repository root, including deployment-source.tar.gz. Keep existing Railway environment variables and Redis unchanged.

The source remains in normal app/, components/, lib/, and public/ folders. deployment-source.tar.gz is a transport copy of those exact folders, not a patch chain. If a file upload omits the directories, Docker unpacks that copy before building. With the normal folders present, Docker builds them directly.

After editing source for a future release, refresh the transport copy from the project root:

```bash
tar -czf deployment-source.tar.gz app components lib public instrumentation.ts
```

Use the included Dockerfile. This fallback does not apply to a custom build command that bypasses Docker. No old prepare-structure or V2 patch scripts are used.

Validation of this deployment repair: source folders were deliberately omitted from a temporary build directory, then restored with the Dockerfile's extraction logic. Restored folders matched the packaged normal source byte-for-byte. TypeScript checking and the Next production build passed using the existing installed dependencies. The standalone server returned HTTP 200 for the homepage and POST /api/paper-reset, with $1,000 cash in an isolated in-memory wallet. These smoke checks do not establish preservation of populated Redis history. Docker/Railway execution and long-running memory stability were not tested here. No app/, components/, lib/, or public/ source changed in this deployment repair.

## Persistence

Set `REDIS_URL` to preserve the existing paper wallet, managed positions, all-time portfolio history, Runner Genome/Filing Cabinet research, Trajectory Observer research, and private Council entity memories. The Redis key namespaces are unchanged from V2.29.4.

`PAPER_STARTING_CASH_USD` controls the reset bankroll and defaults to `$1,000`.

No OpenAI API key or paid LLM service is used by the local Council.
