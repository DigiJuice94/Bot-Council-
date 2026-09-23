# V3.6.3.7 Accounting Reconciled / Guardian Recovery

## Proven root causes

- The paper wallet rounded persistent cash to cents after every fill, while Proof Cabinet reconstructed cash from four-decimal fill proceeds and rounded only the final total. Repeated discarded fractions produced the verified $0.74 mismatch.
- The 20-minute deadline was evaluated only after a fresh market snapshot. A failed configured adapter returned `null` immediately instead of using the existing DEX fallback, so old positions could remain open indefinitely.

## Repairs

- Preserve six-decimal ledger cash and round only presentation totals.
- Reconstruct wallet totals from unique, credited fills; SELL proceeds require verified route evidence.
- Exclude unsellable positions from positive open value and deduplicate position lifecycle IDs.
- Fall back to direct DEX position marks when the optional adapter fails.
- Persist the existing 20-minute deadline as `exit_pending` during a mark outage; no fill or proceeds are fabricated.

## Strategy lock

No Council votes, opportunity ranking, BUY/WATCH/SKIP logic, entry score, sizing, risk appetite, take-profit, stop, trailing, prompts or learned behavior changed.
