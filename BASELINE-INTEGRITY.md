# Exact Tournament.13 winner integrity

Source: `Bot-War-Room-V3.6.2-Tournament.13-ONE-FOLDER.zip`

The following decision and memory files are byte-for-byte identical to the
Tournament.13 build that produced Team File Cabinet's winning result:

| File | SHA-256 |
|---|---|
| `lib/agent-entity-runtime.ts` | `6a51fbc547e3d6d3662e849628120a40b0c5c0cd3efe4041d1eb7bedbc0a9812` |
| `lib/agent-entity-store.ts` | `0254f08054544a65bbef1b2f262131416382784ecb1ab7d920ec5db24eeadd26` |
| `lib/engine.ts` | `cf5e99dfd5a4b1a57fe00118a4b14c9ad5124a5cd939102b91919f34d33d92bf` |
| `lib/risk.ts` | `0c483146319d67ed90f7292ab0820f30912486668ef955295f9a1f69bbf253a9` |
| `lib/provider-waterfall.ts` | `7ca9cc3079a54c6cabfb307e30e1a8c78c6f9de9aeb3217eeab221bf6a161f85` |
| `lib/runner-research.ts` | `2cc091d5d903155e143504b71d9ebd649bf31d423db0b3651494d5ff127fcc12` |

`lib/tournament.ts` retains the original Team File Cabinet entry, fee, sizing,
marking, exit, locked-capital and accounting functions. Only the nine losing
variants and the qualifier/final transition were disabled so Team 10 can run
continuously as the sole main wallet.

The legacy main-wallet Guardian is not started. No second trading engine can
place positions beside the promoted winner.
