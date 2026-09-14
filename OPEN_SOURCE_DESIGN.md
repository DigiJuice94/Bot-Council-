# Open-source design influences

Bot War Room V2 intentionally combines recurring design patterns from mature or ambitious open-source trading systems instead of copying one repository wholesale.

## Patterns applied

- **Specialized multi-agent roles and debate:** inspired by TradingAgents and AI Hedge Fund-style separation of analysts, risk/research roles and portfolio decision makers.
- **Research -> validation -> paper -> live promotion:** inspired by FinRL/FinRL-X-style separation of research and deployment plus systematic trading research practices.
- **Paper/live parity:** inspired by professional event-driven trading engines where the strategy and risk path stay consistent while the execution adapter changes.
- **Execution abstraction:** inspired by Hummingbot/Gateway-style separation between strategy logic and venue/chain connectors.
- **Deterministic event/risk boundaries:** inspired by NautilusTrader and other production trading engines that avoid placing LLM judgment directly in transaction mechanics.
- **Backtest and experiment discipline:** informed by Jesse, Qlib, Freqtrade and similar research frameworks.

## Licensing rule

This V2 code is a fresh implementation of those architectural ideas. Do not directly copy GPL/AGPL implementation code into this repository unless the project owner intentionally accepts the corresponding license obligations.

Permissively licensed third-party code can be considered later, but preserve notices/attribution and review compatibility before merge.
