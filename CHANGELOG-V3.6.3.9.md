# V3.6.3.9 Entry Rollback

- Reverts the unrequested V3.6.3.8 BUY requirement for a verified reverse-route API. BUY execution is byte-for-byte equivalent to V3.6.3.7 apart from the optional SELL-proof parameter.
- Preserves V3.6.3.8's SELL-only verified-audit handoff, ledger reconciliation and 20-minute deadline behavior.
- Keeps zero-liquidity BUY rejection and verified SELL proceeds. No fabricated exit or wallet reset.
- Existing `exit_pending` positions still count toward the unchanged 12-position cap; this update cannot create capacity if all 12 remain unresolved. The dashboard shows the audit result for each.
