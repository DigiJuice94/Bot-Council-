"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AgentOpinion, Chain, PaperFill, WarRoomResult } from "@/lib/types";

const chains: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"];

function money(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function BotAvatar({ bot, active }: { bot: AgentOpinion; active: boolean }) {
  return (
    <div className={`bot-seat ${active ? "active" : ""}`} style={{ "--bot": bot.color } as CSSProperties}>
      <div className="avatar-shell"><div className="robot-head"><span>{bot.shortName}</span></div></div>
      <div className="bot-card">
        <div className="bot-card-top"><strong>{bot.name}</strong><span>{bot.score}%</span></div>
        <p>{bot.summary}</p>
        <small>{bot.detail}</small>
      </div>
    </div>
  );
}

export default function WarRoomDashboard() {
  const [result, setResult] = useState<WarRoomResult | null>(null);
  const [selectedChain, setSelectedChain] = useState<Chain>("Solana");
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fill, setFill] = useState<PaperFill | null>(null);
  const [logs, setLogs] = useState<string[]>(["V2 engine booted", "Live wallet signing disabled", "Paper executor ready across 6 chains"]);

  const runCycle = async (chain = selectedChain) => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: result?.snapshot, chain, mode: "paper" }),
      });
      const next: WarRoomResult = await res.json();
      setResult(next);
      setActiveIndex((i) => (i + 1) % 8);
      setLogs((prev) => [...next.auditTrail.slice(-3).reverse(), ...prev].slice(0, 9));
    } finally {
      setRunning(false);
    }
  };

  const paperExecute = async () => {
    if (!result?.execution.allowed || !result.execution.request) return;
    const res = await fetch("/api/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: result.execution.request, snapshot: result.snapshot }),
    });
    const nextFill: PaperFill = await res.json();
    setFill(nextFill);
    setLogs((prev) => [`Executor PAPER fill ${nextFill.symbol} ${money(nextFill.filledUsd)} @ $${nextFill.fillPrice.toFixed(6)}`, ...prev].slice(0, 9));
  };

  useEffect(() => { void runCycle(selectedChain); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedChain]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void runCycle(selectedChain), 9000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, selectedChain, result?.snapshot]);

  const tokenHistory = useMemo(() => [22, 27, 25, 34, 31, 42, 39, 47, 44, 53, 62, 58, 67, 72, 68, 78], []);

  if (!result) return <main className="loading-screen"><div><strong>Bot War Room V2</strong><span>Starting multi-chain paper engine…</span></div></main>;

  const researchBots = result.agents.filter((a) => !["cio", "executor"].includes(a.id));
  const positive = result.snapshot.priceChange24h >= 0;
  const experiment = result.experiment;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">W</div><div><strong>Bot War Room V2</strong><span>MULTI-CHAIN AI TRADING LAB</span></div></div>
        <nav><button className="nav-active">War Room</button><button>Experiments</button><button>Paper Trades</button><button>Analytics</button></nav>
        <div className="top-actions"><span className="demo-pill">PAPER ONLY</span><span className="live-dot"/>8/8 Bots Online</div>
      </header>

      <aside className="sidebar">
        <section className="portfolio-card">
          <span className="eyebrow">PAPER PORTFOLIO</span><h2>$10,000.00</h2><div className="gain">Risk-gated simulation</div><div className="mini-line" />
          <div className="mini-stats"><div><span>Mode</span><b>PAPER</b></div><div><span>Chains</span><b>6</b></div><div><span>Live</span><b>OFF</b></div></div>
        </section>
        <div className="side-nav">
          {['◈ War Room','⌁ Experiments','↗ Paper Trades','▥ Analytics','⬡ Chain Router','◌ Risk Controls','⌕ Token Explorer','⚙ Settings'].map((item, i) => <button className={i === 0 ? 'selected' : ''} key={item}>{item}</button>)}
        </div>
        <div className="side-note"><span>V2 SAFETY MODEL</span><p>Agents can recommend. The CIO can approve. Only deterministic risk + Executor can create an order.</p></div>
      </aside>

      <section className="content">
        <div className="section-head">
          <div><div className="eyebrow green">● MULTI-CHAIN WAR ROOM</div><h1>8 agents. 6 chains. One risk gate.</h1><p>Research → red-team debate → CIO → deterministic risk → paper execution.</p></div>
          <div className="head-actions"><label className="toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span/>Auto cycle</label><button className="primary" onClick={() => void runCycle()} disabled={running}>{running ? "Analyzing…" : "Run consensus"}</button></div>
        </div>

        <div className="chain-strip">
          {chains.map((chain) => <button key={chain} onClick={() => { setFill(null); setSelectedChain(chain); }} className={selectedChain === chain ? "selected" : ""}>{chain}</button>)}
        </div>

        <div className="hero-grid">
          <section className="war-room panel">
            <div className="room-title"><span>THE WAR ROOM · {result.snapshot.chain.toUpperCase()}</span><span className="timestamp">{new Date(result.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
            <div className="city-lines" />
            <div className="bot-row top-row">{result.agents.slice(0, 4).map((bot, i) => <BotAvatar bot={bot} active={activeIndex === i} key={bot.id} />)}</div>
            <div className="conference-table"><div className="table-ring ring-1"/><div className="table-ring ring-2"/><div className="decision-core"><span>TRADE DECISION</span><strong className={`decision ${result.decision.toLowerCase()}`}>{result.decision}</strong><small>{result.consensus}/6 supportive · {result.conviction}% conviction · risk {result.risk.riskScore}%</small></div></div>
            <div className="bot-row bottom-row">{result.agents.slice(4).map((bot, i) => <BotAvatar bot={bot} active={activeIndex === i + 4} key={bot.id} />)}</div>
          </section>

          <aside className="token-card panel">
            <div className="token-top"><div><span className="token-icon">{result.snapshot.symbol[0]}</span><div><h3>${result.snapshot.symbol}</h3><p>{result.snapshot.chain} · {result.snapshot.venue}</p></div></div><span className="demo-pill">DEMO FEED</span></div>
            <div className="price">${result.snapshot.price.toFixed(6)}</div><div className={positive ? "gain" : "loss"}>{positive ? "▲" : "▼"} {result.snapshot.priceChange24h.toFixed(1)}% (24h)</div>
            <div className="chart-box"><svg viewBox="0 0 160 70" preserveAspectRatio="none"><polyline points={tokenHistory.map((v,i)=>`${i*(160/(tokenHistory.length-1))},${70-v*.7}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/></svg></div>
            <div className="token-stats"><div><span>Market cap</span><b>{money(result.snapshot.marketCap)}</b></div><div><span>Liquidity</span><b>{money(result.snapshot.liquidity)}</b></div><div><span>24h volume</span><b>{money(result.snapshot.volume24h)}</b></div><div><span>Holders</span><b>{result.snapshot.holders.toLocaleString()}</b></div><div><span>Top 10</span><b>{result.snapshot.top10Pct.toFixed(1)}%</b></div><div><span>Bundles</span><b>{result.snapshot.bundledPct.toFixed(1)}%</b></div></div>
            <div className={`risk-banner ${result.risk.passed ? "safe" : "blocked"}`}><strong>{result.risk.passed ? "Deterministic risk: PASS" : "TRADE VETOED"}</strong><span>{result.risk.passed ? `Max allocation ${result.risk.maxPositionPct.toFixed(2)}%` : result.risk.hardBlocks[0]}</span></div>
            <button className="paper-button" disabled={!result.execution.allowed} onClick={() => void paperExecute()}>{result.execution.allowed ? `Execute paper ${money(result.execution.request?.notionalUsd ?? 0)}` : result.execution.reason}</button>
            {fill && <div className="fill-card"><b>Paper fill recorded</b><span>{fill.chain} · ${fill.symbol}</span><span>{money(fill.filledUsd)} · {fill.slippageBps} bps slippage</span></div>}
          </aside>
        </div>

        <div className="v2-grid">
          <section className="panel experiment-card">
            <div className="panel-title"><h3>Experiment Lab</h3><span>{experiment.id} · v{experiment.version}</span></div>
            <strong>{experiment.name}</strong><p>{experiment.hypothesis}</p>
            <div className="stage-flow">{["research","backtest","oos","paper","live"].map((stage) => <span className={experiment.stage === stage ? "active" : ""} key={stage}>{stage.toUpperCase()}</span>)}</div>
            <div className="metric-grid"><div><span>Trades</span><b>{experiment.metrics.trades}</b></div><div><span>Win rate</span><b>{experiment.metrics.winRatePct}%</b></div><div><span>Expectancy</span><b>+{experiment.metrics.expectancyPct}%</b></div><div><span>Max DD</span><b>-{experiment.metrics.maxDrawdownPct}%</b></div><div><span>Profit factor</span><b>{experiment.metrics.profitFactor}</b></div><div><span>Slippage</span><b>{experiment.metrics.slippageBps} bps</b></div></div>
            <div className={`promotion ${experiment.promotionReady ? "ready" : "hold"}`}><b>{experiment.promotionReady ? "PROMOTION GATES PASSED" : "KEEP IN PAPER"}</b><span>{experiment.promotionReasons[0]}</span></div>
          </section>

          <section className="panel consensus-card"><div className="panel-title"><h3>Team Consensus</h3><span>{result.consensus}/6 supportive</span></div>{researchBots.map(bot => <div className="bar-row" key={bot.id}><span>{bot.name}</span><div className="bar"><i style={{ width: `${bot.score}%`, background: bot.color }}/></div><b>{bot.score}%</b></div>)}</section>

          <section className="panel activity"><div className="panel-title"><h3>Audit Trail</h3><span className="green">● Append-only concept</span></div>{logs.map((log, i) => <div className="log" key={`${log}-${i}`}><time>{new Date(new Date(result.generatedAt).getTime() - i*45000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</time><p>{log}</p></div>)}</section>
        </div>

        <section className="panel safety-wide">
          <div className="panel-title"><h3>Deterministic Guardrails</h3><span>AI cannot override these checks</span></div>
          <div className="guard-grid">
            {result.risk.passedChecks.slice(0, 8).map((check) => <div className="ok" key={check}>✓ {check}</div>)}
            {result.risk.hardBlocks.map((check) => <div className="bad" key={check}>✕ {check}</div>)}
            {result.risk.warnings.slice(0, 4).map((check) => <div className="warn" key={check}>! {check}</div>)}
          </div>
        </section>
      </section>
    </main>
  );
}
