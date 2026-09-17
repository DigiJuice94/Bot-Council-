# Bot War Room V3

Clean source-of-truth baseline flattened from the complete V2.29.4 runtime.

## Validation

```bash
npm ci
npm run typecheck
npm run build
```

The Railway Docker deployment uses Next.js standalone output and starts with `node server.js`.

## Persistence

Set `REDIS_URL` to preserve the existing paper wallet, managed positions, all-time portfolio history, Runner Genome/Filing Cabinet research, Trajectory Observer research, and private Council entity memories. The Redis key namespaces are unchanged from V2.29.4.

`PAPER_STARTING_CASH_USD` controls the reset bankroll and defaults to `$1,000`.

No OpenAI API key or paid LLM service is used by the local Council.
