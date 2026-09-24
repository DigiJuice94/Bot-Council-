# Deploy this complete folder

Put the **contents** of this folder at the GitHub repository root (so `app/`, `components/`, `lib/`, `package.json`, `Dockerfile`, and `deployment-source.tar.gz` are at root), then deploy the resulting commit. Do not upload this as a nested folder alongside old sources. Docker restores the included archive before building.

Check that the live dashboard header reads `Bot War Room V3.6.3.12` and the Proof cabinet build reads `V3.6.3.12 Liquidity Paper Exits / Verified or Modeled`. An earlier label means an earlier package is still deployed. This package only changes PAPER simulation; it does not execute on-chain trades or connect private keys.
