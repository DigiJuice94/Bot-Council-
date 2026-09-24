# V3.6.3.12 — liquidity-modeled PAPER exits

When a full PAPER exit triggers and the reverse-route audit returns UNKNOWN, a fresh live liquidity observation can now settle a *modeled* sell. This is explicitly not a verified executable sale. The model uses current slippage and fees, caps simulated proceeds at half the observed pool liquidity, and records routeVerified=false, sellExecutionKind=liquidity_model, observed liquidity and observation time on the fill. The wallet ledger credits this explicitly modeled PAPER fill without claiming a verified route. The dashboard and per-trade status label modeled exits, and the proof cabinet remains only partially confirmed.

Zero liquidity, an explicit route FAIL, verified unsellability, honeypots, and Solana freeze authority still prevent a modeled fill. A stale or non-live snapshot also cannot support one. Verified exits retain the existing route proof. BUY decisions, entry scoring, position sizing and exit triggers are unchanged.

Existing exit-unverified positions can recover as modeled exits on Guardian retries when fresh positive liquidity appears. If no eligible liquidity is seen, they stay out of liquid equity and continue to retry. This model can overestimate real sellability; PAPER profit includes explicitly marked simulated proceeds and cannot be presented as actual execution.

Validation: 12 regression tests, TypeScript check and production build passed. Docker deployment-source.tar.gz includes the exact updated source tree.
