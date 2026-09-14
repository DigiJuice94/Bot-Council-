# V2.10 Validation Context — FONE + PEPE

V2.10 is a targeted data-model update. It does not lower the V2.9 Meme Council quorum or deterministic safety thresholds.

## FONE regression

The first-hour FONE snapshot that exposed the V2.9 weakness was replayed without manually supplying `holderGrowthPct`, social velocity, or 5-minute volume.

Published totals used by the replay included roughly 4,398 holders in about 60 minutes, about $11.1M turnover, roughly $915.6K market cap, and about $77.5K liquidity. V2.10 converted the newborn totals into fallback launch rates:

- ~73.3 holders/min
- ~$185,000 volume/min
- ~$1,292 liquidity-formation proxy/min
- Launch Velocity ~78/100

With those rates available to the bots, the direct-fields replay produced:

- Meme Breakout 80/100
- Alpha evidence 63/100
- 4/6 research support
- CIO BUY
- Executor REDUCE
- final conviction 72%
- final decision BUY
- small starter paper order about $19 on the default $10,000 context

The previous V2.9 direct-fields replay was WATCH because Wallet Tracker could see the total holder count but could not infer the acquisition speed without a holder-growth percentage.

At the 13-hour distribution snapshot, V2.10 still classified FONE as Meme Exhaustion and returned SKIP.

## Hard-veto regression

A synthetic token with extreme launch velocity but honeypot behavior was forced through the V2.10 core. Launch Velocity scored near the top of the range, but deterministic risk still forced SKIP and prevented execution.

## PEPE regression

The prior real-candle windows were rerun after the Launch Velocity changes:

- early May 2023 weak window: 0 trades
- September 2023 thin-liquidity window: 0 trades
- February 2024 pre-breakout strict replay: 3 completed trades, positive portfolio result
- May 2024 strict replay: 0 trades
- May 2024 candle-proxy replay: 1 small losing trade, unchanged from the known V2.9 tradeoff

## Limitation

Fallback rates are only used for tokens younger than 24 hours. Direct provider metrics are preferred and override the fallback. This prevents mature tokens from being incorrectly treated as if all holders/volume were acquired during the latest day.
