# Apply Bot War Room V2.18.2

This is cumulative on top of V2.18.1.

Replace/upload the included files into the repository root and redeploy Railway.

The build command remains:
`node prepare-structure.mjs && next build`

During structure preparation the build now applies:
1. seven-chain scanner patch
2. larger paper-sizing patch
3. Guardian exit-liquidity hotfix

No new environment variables are required.
