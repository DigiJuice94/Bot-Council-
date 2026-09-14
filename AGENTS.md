# Bot War Room V2 agent contract

## Research agents

The six research agents return a score, stance, concise thesis and evidence. They never sign transactions and never directly create wallet instructions.

## Bear Bot

Bear Bot is a red-team participant, not a generic risk manager. Its job is to attack the bullish thesis and surface failure modes that may not trigger a deterministic rule.

## CIO

CIO combines independent research outputs using explicit weighting. It may return BUY, WATCH, SKIP or EXIT. It cannot override a deterministic veto.

## Risk gate

The deterministic risk gate is ordinary code. Hard blocks always beat agent consensus. Warnings reduce sizing.

## Executor

Executor is the only component that may turn an approved CIO decision into an `ExecutionRequest`. In V2 the only implemented adapter is paper execution. Live execution remains gated and unimplemented by default.

## Experiment governance

Strategies move through RESEARCH -> BACKTEST -> OOS -> PAPER -> LIVE. Automatic metrics may mark an experiment promotion-ready, but promotion to LIVE should remain an explicit governance action.
