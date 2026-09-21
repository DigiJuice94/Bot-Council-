# Locked baseline integrity

Source baseline: `Bot-War-Room-V3.6.2-Risk-Reaper-Immortal-Audit-Watch-ONE-FOLDER.zip`

The existing trading implementation remains byte-for-byte identical in the following critical files:

| File | SHA-256 |
|---|---|
| `lib/engine.ts` | `cf5e99dfd5a4b1a57fe00118a4b14c9ad5124a5cd939102b91919f34d33d92bf` |
| `lib/risk.ts` | `0c483146319d67ed90f7292ab0820f30912486668ef955295f9a1f69bbf253a9` |
| `lib/execution.ts` | `e6d6b427141ae0e11e6f90399e240131630fe18c450deef148e1b3d34ad51bb1` |
| `lib/paper-wallet.ts` | `47d7fe5bc084f2d5924ce0e5d4f50c00bd4d507a9e2a40539ef69aa27e684eaa` |
| `lib/position-manager.ts` | `4ec35862aef67e5687ae12fddc5679028365a849d7b6f7cd1089a2e608d27a02` |
| `lib/sellability-auditor.ts` | `c84d9d7538b6aa302e139cd7b07182d81255a05b1063ed0681759f6bb727a5b9` |
| `lib/liquidity-auditor.ts` | `2d40c078dba6d2bc13c36f70da05cc54742378b5bf530b47a8d4cdd8007461a2` |

`lib/autopilot.ts`, `lib/agent-entity-runtime.ts`, and the tournament modules contain the tournament integration. The primary PAPER wallet is paused while the tournament is active; the critical pricing, risk, execution, Guardian, sellability and liquidity files above remain byte-for-byte locked.
