# Apply Bot War Room V2.26

Use this cumulative one-folder release.

Upload/replace the contents of `Bot-War-Room-V2.26-FULL` into the repository root and redeploy Railway.

## Required for true independent AI entities

Add this in Railway Variables:

`OPENAI_API_KEY=...`

Do not paste the API key into chat.

Recommended defaults are already in `env.example`:
- `COUNCIL_ENTITY_MODE=independent-ai`
- `COUNCIL_AGENT_MODEL=gpt-5.6-luna`
- `COUNCIL_CIO_MODEL=gpt-5.6-terra`
- `COUNCIL_DEBATE_ROUND=true`
- `COUNCIL_ALLOW_DEGRADED_FALLBACK=false`

Without the API key, V2.26 will not silently claim the old shared engine is eight independent AI entities.
