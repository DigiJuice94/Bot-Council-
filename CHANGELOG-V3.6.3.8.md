# V3.6.3.8 Verified Exit Handoff

## Root cause

An `exit_pending` position could perform as many as three reverse-route audits in one five-second Guardian cycle. A successful audit was not passed into execution, so a later provider timeout or rate limit changed the same exit to `UNKNOWN`. The resulting exception occurred before the audit state was persisted, leaving the dashboard stuck on the original 20-minute message.

## Repair

- A fresh `PASS` audit is handed directly to the corresponding paper exit and is consumed once.
- Pending exits retry `UNKNOWN` coverage at the existing 30-second audit interval instead of hammering providers every five seconds.
- `UNKNOWN` never credits proceeds and never becomes a fabricated locked-capital loss.
- Two verified `FAIL` results still move the position to Unsellable / Locked Capital with zero proceeds.
- New paper entries require a verified executable reverse route, preventing unsupported positions from entering the wallet.
- Exit cards now show the saved sell-verification status and reason.

## Strategy lock

Council votes, opportunity ranking, entry scores, sizing, take-profit levels, trailing logic, stops, the 20-minute rule, prompts and learned behavior are unchanged.
