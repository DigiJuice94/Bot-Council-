# Bot War Room agent guide

- Preserve the eight-agent separation of concerns.
- Never let an AI model override `lib/risk.ts` hard blocks.
- Only the Executor layer may eventually sign transactions.
- Keep private keys and provider API keys server-side.
- V1 must remain paper-only unless a deliberate live-execution module is added.
- Any live module should default to disabled and require explicit environment configuration.
