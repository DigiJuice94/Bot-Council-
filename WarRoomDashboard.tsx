"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentOpinion, Chain, PaperFill, PositionGuardianReport, WarRoomResult } from "@/lib/types";
import { buildCouncilDiscussion, type CouncilTurn } from "@/lib/debate";

const chains: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"];

const fallbackBots: AgentOpinion[] = [
  { id: "launch", name: "Launch Scout", shortName: "LS", score: 74, stance: "bullish", summary: "Scanning the launch and early flow.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "social", name: "Social Radar", shortName: "SR", score: 71, stance: "bullish", summary: "Watching attention and social velocity.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "wallet", name: "Wallet Intel", shortName: "WI", score: 69, stance: "neutral", summary: "Following smart-wallet behavior.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "quant", name: "Quant Bot", shortName: "QB", score: 76, stance: "bullish", summary: "Measuring momentum, liquidity and flow.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "contract", name: "Contract Bot", shortName: "CB", score: 82, stance: "ready", summary: "Checking deterministic contract safety.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "bear", name: "Bear Bot", shortName: "BB", score: 46, stance: "bearish", summary: "Trying to break the bullish thesis.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "cio", name: "CIO", shortName: "CIO", score: 78, stance: "neutral", summary: "Combining the council into one decision.", detail: "Waiting for the first live council cycle.", evidence: [], color: "#111111" },
  { id: "executor", name: "Executor", shortName: "EX", score: 100, stance: "ready", summary: "Standing by for a risk-approved paper order.", detail: "Live wallet signing remains disabled.", evidence: [], color: "#111111" },
];

function money(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function price(n: number) {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function riskLabel(score: number) {
  if (score >= 70) return "LOW";
  if (score >= 38) return "MEDIUM";
  return "HIGH";
}

function DecisionCard({ result, replaying }: { result: WarRoomResult | null; replaying: boolean }) {
  const decision = result?.decision ?? "WATCH";
  const symbol = result?.snapshot.symbol ?? "WAVE";
  const chain = result?.snapshot.chain ?? "Solana";
  const currentPrice = result?.snapshot.price ?? 0.0124;
  const conviction = result?.conviction ?? 78;
  const riskScore = result?.risk.riskScore ?? 52;
  const risk = riskLabel(riskScore);
  const cio = result?.agents.find((agent) => agent.id === "cio");
  const thesis = cio?.summary ?? "Strong momentum with healthy liquidity. Monitoring for a better entry.";
  const activeSkip = decision === "SKIP" || decision === "EXIT";
  const exit = result?.exitStrategy;
  const spark = result
    ? result.snapshot.priceChange24h >= 0
      ? "0,36 18,27 34,31 50,20 65,29 83,14 99,19 120,2"
      : "0,7 18,14 34,10 50,23 65,18 83,31 99,27 120,39"
    : "0,36 18,27 34,31 50,20 65,29 83,14 99,19 120,2";

  return (
    <section className="decision-card" aria-live="polite">
      <div className="decision-card-top">
        <div className="asset-heading">
          <span className="asset-logo">{symbol.slice(0, 1)}</span>
          <div><h2>${symbol}</h2><p>{chain}</p></div>
        </div>
        <div className={`decision-badge badge-${decision.toLowerCase()}`}>{decision}<small>{replaying ? "Decision locked · reasoning replay" : "Current Decision"}</small></div>
      </div>

      <div className="decision-stats">
        <div><strong>{price(currentPrice)}</strong><span>Current Price</span></div>
        <div><strong>{conviction}%</strong><span>Conviction</span></div>
        <div><strong className={`risk-${risk.toLowerCase()}`}>{risk}</strong><span>Risk Level</span></div>
        <div className="spark-wrap" aria-hidden="true"><svg viewBox="0 0 120 42" preserveAspectRatio="none"><polyline points={spark} /></svg></div>
      </div>

      <p className="decision-thesis">{thesis}</p>
      {result && <div className="decision-context-mini"><span><b>{result.councilProcess.lane === "meme" ? result.memeRegime.label : result.regime.label}</b><small>{result.councilProcess.lane === "meme" ? "Meme lane" : "Regime"}</small></span><span><b>{result.councilProcess.alignedBots}/8</b><small>Bot alignment</small></span><span><b>{result.memeRegime.isMeme ? `${result.memeRegime.launchVelocityScore.toFixed(0)}/100` : `${result.alpha.score}/100`}</b><small>{result.memeRegime.isMeme ? "Launch velocity" : "Alpha evidence"}</small></span><span><b>{result.councilProcess.executorVote}</b><small>Executor</small></span></div>}
      {exit && (
        <div className="exit-plan-mini">
          <span><b>{exit.stopLossPct}%</b><small>Stop</small></span>
          <span><b>{exit.trailingStopPct}%</b><small>Trail</small></span>
          <span><b>+{exit.takeProfits[0]?.gainPct ?? 0}%</b><small>TP1</small></span>
          <span><b>{exit.moonbagPct ?? 0}%</b><small>Moonbag</small></span>
        </div>
      )}
      <div className="decision-options" aria-label="Council decision states">
        <span className={decision === "BUY" ? "active buy" : "buy"}>BUY</span>
        <span className={decision === "WATCH" ? "active watch" : "watch"}>WATCH</span>
        <span className={activeSkip ? "active skip" : "skip"}>{decision === "EXIT" ? "EXIT" : "SKIP"}</span>
      </div>
    </section>
  );
}

function CouncilBot({ bot, index, active, speech, context }: { bot: AgentOpinion; index: number; active: boolean; speech?: string; context?: string }) {
  return (
    <div className={`council-bot bot-pos-${index} ${active ? "speaking" : ""}`}>
      {active && (
        <div className="speech-pop" role="status">
          <b>{bot.name}</b>
          {context && <small className="speech-context">{context}</small>}
          <span>{speech ?? bot.summary}</span>
        </div>
      )}
      <div className="chair-shape" />
      <div className={`bot-character expression-${index}`}>
        <div className="orb-head">
          <span className="eye eye-left" /><span className="eye eye-right" /><span className="mouth" />
        </div>
        <div className="bot-torso" />
        <span className="arm arm-left" /><span className="arm arm-right" />
        <span className="hand hand-left" /><span className="hand hand-right" />
      </div>
      <div className="bot-laptop"><span>⌁</span></div>
      <div className="bot-name-tag">{bot.shortName}</div>
    </div>
  );
}

export default function WarRoomDashboard() {
  const [result, setResult] = useState<WarRoomResult | null>(null);
  const [replayResult, setReplayResult] = useState<WarRoomResult | null>(null);
  const [replayQueue, setReplayQueue] = useState<WarRoomResult[]>([]);
  const [selectedChain, setSelectedChain] = useState<Chain>("Solana");
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [activeTurn, setActiveTurn] = useState(-1);
  const [fill, setFill] = useState<PaperFill | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>(["Bot War Room V2.10 Launch Velocity ready", "Paper executor online", "Live wallet signing disabled"]);
  const [history, setHistory] = useState<WarRoomResult[]>([]);
  const [guardian, setGuardian] = useState<PositionGuardianReport | null>(null);

  const runCycle = useCallback(async (chain: Chain = selectedChain) => {
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: result?.snapshot, chain, mode: "paper" }),
      });
      if (!res.ok) throw new Error(`Cycle request failed (${res.status})`);
      const next: WarRoomResult = await res.json();

      // The server already completed independent analysis, debate, CIO decision and exit planning.
      // Switch the card immediately; speech bubbles are only a replay of completed reasoning.
      setResult(next);
      setHistory((previous) => [next, ...previous.filter((item) => item.decisionId !== next.decisionId)].slice(0, 8));
      setLogs((previous) => [
        `[${next.snapshot.chain} $${next.snapshot.symbol}] DECISION READY ${next.decision} · ${next.conviction}% · full reasoning completed`,
        ...previous,
      ].slice(0, 48));
      if (replayResult) {
        setReplayQueue((queue) => [...queue, next].slice(-4));
      } else {
        setReplayResult(next);
        setActiveTurn(0);
      }
    } catch (cycleError) {
      setError(cycleError instanceof Error ? cycleError.message : "Council cycle failed");
    } finally {
      setRunning(false);
    }
  }, [replayResult, result?.snapshot, running, selectedChain]);

  useEffect(() => {
    if (!replayResult || activeTurn < 0) return;
    const discussion = buildCouncilDiscussion(replayResult);
    const turn = discussion[activeTurn];
    if (!turn) return;
    const speakingAgent = replayResult.agents.find((agent) => agent.id === turn.agentId);

    if (speakingAgent) {
      const speechLog = `[${replayResult.snapshot.chain} $${replayResult.snapshot.symbol}] ${turn.round.toUpperCase()} · ${speakingAgent.name}: ${turn.message}`;
      setLogs((previous) => [speechLog, ...previous.filter((entry) => entry !== speechLog)].slice(0, 48));
    }

    const finalTurn = activeTurn >= discussion.length - 1;
    const timer = window.setTimeout(() => {
      if (!finalTurn) {
        setActiveTurn((turnIndex) => turnIndex + 1);
        return;
      }
      setLogs((previous) => [
        `[${replayResult.snapshot.chain} $${replayResult.snapshot.symbol}] REPLAY COMPLETE · Position Guardian remains active`,
        ...replayResult.auditTrail.slice().reverse(),
        ...previous,
      ].filter((entry, index, all) => all.indexOf(entry) === index).slice(0, 48));

      if (replayQueue.length) {
        const [nextReplay, ...rest] = replayQueue;
        setReplayQueue(rest);
        setReplayResult(nextReplay);
        setActiveTurn(0);
      } else {
        setReplayResult(null);
        setActiveTurn(-1);
      }
    }, finalTurn ? 900 : 650);
    return () => window.clearTimeout(timer);
  }, [activeTurn, replayQueue, replayResult]);

  useEffect(() => {
    void runCycle("Solana");
    // The first render intentionally shows the same WAVE/WATCH reference card while the council boots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => void runCycle(selectedChain), 8000);
    return () => window.clearInterval(timer);
  }, [auto, runCycle, selectedChain]);

  const refreshGuardian = useCallback(async () => {
    try {
      const response = await fetch("/api/positions", { cache: "no-store" });
      if (!response.ok) return;
      setGuardian(await response.json() as PositionGuardianReport);
    } catch {
      // Position monitoring remains server-owned; a temporary UI fetch failure should not erase state.
    }
  }, []);

  useEffect(() => {
    void refreshGuardian();
    const timer = window.setInterval(() => void refreshGuardian(), 4000);
    return () => window.clearInterval(timer);
  }, [refreshGuardian]);

  const paperExecute = async () => {
    if (!result?.execution.allowed || !result.execution.request) return;
    const res = await fetch("/api/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: result.execution.request,
        snapshot: result.snapshot,
        exitStrategy: result.exitStrategy,
        entryContext: {
          snapshot: result.snapshot, regime: result.regime, memeRegime: result.memeRegime, councilProcess: result.councilProcess, alpha: result.alpha, preMeeting: result.preMeeting,
          agentWeights: result.agentWeights, decision: result.decision, conviction: result.conviction,
          riskMaxPositionPct: result.risk.maxPositionPct,
          initialAllocationPct: result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1),
          portfolioEquityUsd: (result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1)) > 0
            ? result.execution.request.notionalUsd / ((result.risk.maxPositionPct * (result.execution.allocationMultiplier ?? 1)) / 100)
            : undefined,
        },
      }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      setError(payload.error ?? `Paper execution rejected (${res.status})`);
      return;
    }
    const nextFill: PaperFill = await res.json();
    setFill(nextFill);
    void refreshGuardian();
    setLogs((previous) => [`Executor PAPER fill ${nextFill.symbol} ${money(nextFill.filledUsd)} @ ${price(nextFill.fillPrice)}`, ...previous].slice(0, 48));
  };

  const roomResult = result;
  const roomBots = replayResult?.agents ?? result?.agents ?? fallbackBots;
  const visibleBots = useMemo(() => [...roomBots].slice(0, 8), [roomBots]);
  const activeDiscussion: CouncilTurn[] = replayResult ? buildCouncilDiscussion(replayResult) : [];
  const talking = Boolean(replayResult && activeTurn >= 0 && activeDiscussion[activeTurn]);
  const currentTurn = talking ? activeDiscussion[activeTurn] : undefined;
  const currentSpeaker = currentTurn && replayResult
    ? replayResult.agents.find((agent) => agent.id === currentTurn.agentId)
    : undefined;
  const displayedDecisionKey = roomResult?.decisionId ?? "reference-start";

  return (
    <main className="light-app">
      <header className="site-header">
        <a className="site-brand" href="#live" aria-label="Bot War Room home"><span className="brand-orbit" /><strong>Bot War Room V2.10</strong></a>
        <nav className="site-nav" aria-label="Primary navigation">
          <a className="active" href="#live">Live</a><a href="#features">Features</a><a href="#performance">Performance</a><a href="#pricing">Pricing</a><a href="#docs">Docs</a>
        </nav>
        <div className="header-actions"><button className="moon-button" aria-label="Appearance">◐</button><button className="sign-button">Sign In</button><button className="get-started" onClick={() => void runCycle()}>Get Started <span>→</span></button></div>
      </header>

      <section id="live" className="council-stage">
        <div key={displayedDecisionKey} className="decision-card-slot"><DecisionCard result={roomResult} replaying={Boolean(talking && replayResult?.decisionId === roomResult?.decisionId)} /></div>
        <div className="table-scene" aria-label="Bot council meeting room">
          <div className="conference-table-light"><div className="table-surface-glow" /></div>
          {visibleBots.map((bot, index) => <CouncilBot key={bot.id} bot={bot} index={index} active={talking && bot.id === currentTurn?.agentId} speech={bot.id === currentTurn?.agentId ? currentTurn?.message : undefined} context={bot.id === currentTurn?.agentId && replayResult ? `$${replayResult.snapshot.symbol} · ${currentTurn?.round}` : undefined} />)}
        </div>
        <div className="live-caption"><span className={talking ? "status-dot talking" : "status-dot"} />{talking ? `${currentSpeaker?.name ?? "Council"} replaying $${replayResult?.snapshot.symbol ?? ""} · ${currentTurn?.round ?? "discussion"}` : running ? "Scout analyzing next candidate" : "Scout scanning · Position Guardian watching open trades"}</div>
        {error && <div className="error-toast">{error}</div>}
      </section>

      <section id="features" className="control-section">
        <div className="section-copy"><span>LIVE COUNCIL CONTROLS</span><h2>Enter small. Make the winner prove itself.</h2><p>V2.10 keeps the eight-bot council as the real decision path and adds native launch-speed intelligence. Six specialists form independent reads, Bear red-teams the case, CIO synthesizes the vote, and Executor can reduce or block routing. Meme candidates use token-native breakout context; BTC and the broad market modify starter size instead of automatically vetoing an exceptional meme. Winner Engine behavior from V2.8 remains intact.</p></div>
        <div className="chain-controls">{chains.map((chain) => <button key={chain} className={chain === selectedChain ? "selected" : ""} onClick={() => { setSelectedChain(chain); setFill(null); void runCycle(chain); }}>{chain}</button>)}</div>
        <div className="control-row"><label className="auto-toggle"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /><span /> Auto scout every 8s</label><button className="run-button" disabled={running} onClick={() => void runCycle()}>{running ? "Analyzing…" : "Scan next candidate"}</button></div>
      </section>

      <section id="performance" className="detail-grid">
        <article className="light-panel"><div className="panel-head"><h3>Latest Decision</h3><span>{result?.snapshot.chain ?? "Solana"}</span></div>{result ? <><strong className={`big-decision ${result.decision.toLowerCase()}`}>{result.decision}</strong><p>${result.snapshot.symbol} · {result.conviction}% conviction · {result.councilProcess.alignedBots}/8 bots aligned/ready · {riskLabel(result.risk.riskScore)} risk</p><div className={`risk-line ${result.risk.passed ? "pass" : "fail"}`}>{result.risk.passed ? `Risk gate passed · initial cap ${result.risk.maxPositionPct.toFixed(2)}% before confirmation scaling` : `Vetoed · ${result.risk.hardBlocks[0] ?? "deterministic block"}`}</div><div className="meeting-proof">{result.councilProcess.lane === "meme" ? `${result.memeRegime.label} ${result.memeRegime.breakoutScore}/100` : result.regime.label} · research quorum {result.councilProcess.researchSupport}/{result.councilProcess.requiredResearchSupport} · CIO {result.councilProcess.cioVote} · Executor {result.councilProcess.executorVote}</div><button className="paper-execute" disabled={!result.execution.allowed} onClick={() => void paperExecute()}>{result.execution.allowed ? `Execute paper ${money(result.execution.request?.notionalUsd ?? 0)}` : result.execution.reason}</button>{fill && <small className="fill-note">Paper fill: {money(fill.filledUsd)} @ {price(fill.fillPrice)}</small>}</> : <p>First council decision is being prepared.</p>}</article>

        <article className="light-panel guardian-panel"><div className="panel-head"><h3>Position Guardian</h3><span>{guardian?.storage === "redis" ? "PERSISTENT" : "LOCAL FALLBACK"}</span></div>{guardian ? <><div className="guardian-summary"><strong>{guardian.openCount}</strong><span>open positions</span><b>{guardian.urgentCount} urgent</b></div>{guardian.warning && <p className="guardian-warning">{guardian.warning}</p>}<div className="guardian-list">{guardian.positions.length ? guardian.positions.slice(0, 5).map((position) => <div key={position.id}><div><b>${position.symbol}</b><span>{position.chain}</span></div><strong className={position.pnlPct >= 0 ? "positive" : "negative"}>{position.pnlPct >= 0 ? "+" : ""}{position.pnlPct.toFixed(1)}%</strong><small>{position.lastAction} · {position.lastReason}</small><em>{(position.winnerState ?? "building").toUpperCase()} · Adds {position.scaleIns?.length ?? 0} · Confirm {position.lastConfirmationScore?.toFixed?.(0) ?? "0"}/100 · Moonbag {position.exitStrategy.moonbagPct ?? 0}% · MFE {position.maxFavorableExcursionPct?.toFixed?.(1) ?? "0.0"}%</em></div>) : <p>No open paper positions yet. Guardian is standing by.</p>}</div></> : <p>Loading persistent position memory…</p>}</article>

        <article className="light-panel"><div className="panel-head"><h3>Evidence + Council</h3><span>{result?.councilProcess.lane === "meme" ? "MEME" : result?.alpha.action ?? "SCANNING"}</span></div>{result ? <><div className="guardian-summary"><strong>{result.councilProcess.alignedBots}/8</strong><span>bots aligned / ready</span><b>{result.alpha.score}/100 alpha evidence</b></div><p>{result.councilProcess.lane === "meme" ? `${result.memeRegime.label} · breakout ${result.memeRegime.breakoutScore}/100 · market sizing ${result.memeRegime.broadMarketModifier.toFixed(2)}x` : `${result.regime.label} · ${result.regime.tradeAllowed ? "trading allowed" : "NO-TRADE regime"}`}</p><div className="audit-list">{result.councilProcess.reasons.map((row) => <p key={row}>{row}</p>)}</div></> : <p>The council is waiting for a candidate.</p>}</article>

        <article className="light-panel"><div className="panel-head"><h3>Profitability Lab</h3><span>{result?.experiment.profitability ? "MEASURED" : "BLOCKED"}</span></div>{result?.experiment.profitability ? <><div className="guardian-summary"><strong>{result.experiment.profitability.totalReturnPct.toFixed(1)}%</strong><span>net historical return</span><b>{result.experiment.profitability.profitFactor.toFixed(2)} PF</b></div><p>{result.experiment.profitability.trades} trades · {result.experiment.profitability.positiveFoldPct.toFixed(0)}% positive folds · {result.experiment.profitability.ruinProbabilityPct.toFixed(1)}% Monte Carlo ruin risk</p><small className="fill-note">Live promotion: {result.experiment.promotionReady ? "eligible for governance review" : result.experiment.promotionReasons[0]}</small></> : <><p>No reproducible historical benchmark has been stored yet. Demo numbers never unlock live promotion.</p><small className="fill-note">POST real historical frames to /api/benchmark to measure return, drawdown, profit factor, walk-forward folds and Monte Carlo ruin risk.</small></>}</article>

        <article className="light-panel"><div className="panel-head"><h3>Decision History</h3><span>Newest first</span></div><div className="history-list">{history.length ? history.map((item) => <div key={item.decisionId}><b>${item.snapshot.symbol}</b><span>{item.snapshot.chain}</span><strong className={item.decision.toLowerCase()}>{item.decision}</strong><small>{item.conviction}%</small></div>) : <p>No completed decisions yet.</p>}</div></article>

        <article className="light-panel"><div className="panel-head"><h3>Audit Trail</h3><span>PAPER ONLY</span></div><div className="audit-list">{logs.map((log, index) => <p key={`${log}-${index}`}>{log}</p>)}</div></article>
      </section>

      <section id="pricing" className="simple-strip"><b>V2.10 Launch Velocity + eight-bot Meme Council</b><span>holders/min · transactions/min · unique buyers/min · volume/min · liquidity formation/min · 6 independent specialist reads · CIO + Executor · Winner Engine retained</span></section>
      <section id="docs" className="simple-strip docs-strip"><b>Safety contract</b><span>Alpha finds candidates mathematically. Specialists think independently first. CIO decides. Risk code can veto. Executor alone creates orders. Guardian owns every unit until exit and grades the outcome afterward.</span></section>
    </main>
  );
}
