# Clean baseline — V3.6.3.12

This is one complete project folder. Docker restores the included `deployment-source.tar.gz` containing this same `app/`, `components/`, `lib/` and `public/` tree before compiling. Update both root files and archive together.

BUY decisions, scoring, entry sizing, zero-liquidity protection and exit triggers are unchanged. Full PAPER exits may now credit an explicitly labeled liquidity-modeled fill if a fresh live pool has positive liquidity and the executable route audit is UNKNOWN. A modeled fill has `routeVerified=false`, is capped to half observed liquidity and is not evidence that the token could actually be sold. Verified fills remain separately labeled. Confirmed route failures and hard security failures are never modeled as sold. See `CHANGELOG-V3.6.3.12.md`.
