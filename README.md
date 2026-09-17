# Bot War Room V3

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
tar -czf deployment-source.tar.gz app components lib public
```

Use the included Dockerfile. This fallback does not apply to a custom build command that bypasses Docker. No old prepare-structure or V2 patch scripts are used.

Validation of this deployment repair: source folders were deliberately omitted from a temporary build directory, then restored with the Dockerfile's extraction logic. Restored folders matched the packaged normal source byte-for-byte. TypeScript checking and the Next production build passed using the existing installed dependencies. The standalone server returned HTTP 200 for the homepage and POST /api/paper-reset, with $1,000 cash in an isolated in-memory wallet. These smoke checks do not establish preservation of populated Redis history. Docker/Railway execution and long-running memory stability were not tested here. No app/, components/, lib/, or public/ source changed in this deployment repair.

## Persistence

Set `REDIS_URL` to preserve the existing paper wallet, managed positions, all-time portfolio history, Runner Genome/Filing Cabinet research, Trajectory Observer research, and private Council entity memories. The Redis key namespaces are unchanged from V2.29.4.

`PAPER_STARTING_CASH_USD` controls the reset bankroll and defaults to `$1,000`.

No OpenAI API key or paid LLM service is used by the local Council.
