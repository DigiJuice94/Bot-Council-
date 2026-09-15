# Apply Bot War Room V2.17

This is cumulative on top of V2.16.

Upload/replace the included files in the repository root. Railway keeps the same build command:
`node prepare-structure.mjs && next build`

`prepare-structure.mjs` now applies:
1. V2.15 seven-chain fresh-pool patch
2. V2.17 dynamic paper-position sizing patch

No new environment variables are required.
