# Bot War Room V2.10 — Launch Velocity

V2.10 fixes the data-normalization problem exposed by the FONE replay without lowering the V2.9 Council standards.

The first-hour FONE snapshot already contained the important information: roughly 4,398 holders in about an hour and roughly $11.1M of turnover while the token was still below a $1M market cap. V2.9 could see the totals, but Wallet Tracker expected a `holderGrowthPct` field. If the historical/provider feed did not explicitly publish that percentage, the total holder count was not translated into launch speed and the Council could remain at WATCH.

V2.10 adds a dedicated **Launch Velocity Engine**.

## Native launch-speed metrics

Providers can now send these fields directly in `snapshot.launchMetrics`:

- holders per minute
- transactions per minute
- unique buyers per minute
- USD volume per minute
- liquidity added per minute
- holder acceleration
- transaction acceleration
- volume acceleration

For tokens younger than 24 hours, V2.10 can also derive conservative fallback rates from totals already present in the snapshot. Example: `holders / ageMinutes` becomes holders-per-minute, and `volume24h / ageMinutes` becomes the since-launch volume pace. Direct provider rates always override fallbacks.

## Which bots use it

- **Launch Scout** now scores launch velocity directly instead of relying mostly on percentage momentum.
- **Wallet Tracker** understands absolute holder-acquisition speed, so 4,398 holders in ~60 minutes is recognized even if `holderGrowthPct` is missing.
- **Quant Bot** receives launch turnover/volume pace.
- **Alpha Engine** uses launch volume and holder velocity for newborn tokens.
- **Meme Regime** includes launch velocity in Breakout/Acceleration classification.

Social Scout, Contract Bot and Bear Bot keep their own domains. CIO and Executor remain the seventh/eighth active roles from V2.9.

## Safety behavior is unchanged

Launch velocity cannot overrule deterministic hard vetoes. Honeypot, unsellable, mint/freeze authority, Top-10 >80%, bundled supply >25%, insufficient executable liquidity and portfolio kill-switches still block the order.

Extreme velocity also does not mean a large initial position. V2.9 meme starter sizing and V2.8 Winner Engine scaling remain intact.

## FONE regression

Using only the directly published first-hour FONE totals and leaving `holderGrowthPct`, social velocity and 5-minute volume at zero, V2.10 now derives roughly:

- 73.3 holders/min
- $185,000/min volume pace
- about $1,292/min liquidity-formation proxy
- Launch Velocity: ~78/100

That is enough for Wallet Tracker/Quant/Alpha to understand the launch without inventing a holder-growth percentage.

The exact V2.10 replay changes the direct-fields FONE result from **WATCH in V2.9** to **BUY in V2.10**, while the 13-hour distribution snapshot remains **SKIP / Meme Exhaustion**.

This is a heuristic/data-architecture improvement, not proof of future profitability. It still needs broad timestamped out-of-sample testing.

## V2.10.1 UI patch — supplied council artwork
- Replaced the CSS-drawn bot/chair/laptop stand-ins with the exact bot/table artwork from the supplied V2.4 reference image.
- The reference was cropped only to isolate the council/table scene; the characters were not regenerated or redrawn.
- The live decision card remains dynamic and independent from the artwork.
- Eight invisible seat anchors remain mapped to the eight council roles so the real debate replay can still show speech bubbles over the correct bot.
- Active speaker pulse/name tag remains code-driven.
- `prepare-structure.mjs` now copies `bot-council-reference.png` into `/public` during Railway/Next build reconstruction.
- Trading logic, V2.10 Launch Velocity, risk gates, Winner Engine, and eight-bot decision process are unchanged.
