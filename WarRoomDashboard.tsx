"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AgentOpinion, WarRoomResult } from "@/lib/types";

const starter: WarRoomResult = {
  snapshot: {
    symbol: "NEON", name: "Neon Protocol Demo", chain: "Solana", venue: "Demo DEX",
    price: 0.00423, priceChange24h: 18.7, marketCap: 423000, liquidity: 118000,
    volume5m: 38600, volume24h: 684000, holders: 1842, ageMinutes: 43,
    buySellRatio: 1.86, smartMoneyBuys: 6, smartMoneySells: 1, socialVelocityPct: 212,
    top10Pct: 22.4, bundledPct: 6.8, devRugHistory: 0, mintAuthority: false,
    freezeAuthority: false, sellable: true, volatility: 0.58,
  },
  agents: [
    { id: "launch", name: "Launch Scout", shortName: "LS", score: 80, stance: "bullish", summary: "Early momentum is building.", detail: "5m volume expanding", color: "#ffb13b" },
    { id: "social", name: "Social Scout", shortName: "SS", score: 78, stance: "bullish", summary: "Social velocity is accelerating.", detail: "Mentions rising", color: "#b05cff" },
    { id: "wallet", name: "Wallet Tracker", shortName: "WT", score: 85, stance: "bullish", summary: "Smart money is net accumulating.", detail: "6 buys · 1 sell", color: "#29e693" },
    { id: "quant", name: "Quant Bot", shortName: "QB", score: 82, stance: "bullish", summary: "Momentum and flow align.", detail: "Favorable risk/reward", color: "#28c9ff" },
    { id: "contract", name: "Contract Bot", shortName: "CB", score: 88, stance: "bullish", summary: "Core contract checks passed.", detail: "No hard vetoes", color: "#ffd34f" },
    { id: "bear", name: "Bear Bot", shortName: "BB", score: 63, stance: "neutral", summary: "No fatal bear case found.", detail: "Watching volatility", color: "#ff5f6d" },
    { id: "cio", name: "CIO", shortName: "CIO", score: 82, stance: "bullish", summary: "WATCH: setup is strong, confirmation preferred.", detail: "Max paper allocation 2.00%", color: "#70a8ff" },
    { id: "executor", name: "Executor", shortName: "EX", score: 82, stance: "ready", summary: "Standing by. No order will be sent.", detail: "Paper mode only", color: "#52f6c6" },
  ],
  decision: "WATCH", consensus: 6, conviction: 82,
  risk: { passed: true, hardBlocks: [], warnings: [], maxPositionPct: 2 },
  generatedAt: "2026-09-13T22:00:00.000Z",
};

function money(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function BotAvatar({ bot, active }: { bot: AgentOpinion; active: boolean }) {
  return (
    <div className={`bot-seat ${active ? "active" : ""}`} style={{ "--bot": bot.color } as CSSProperties}>
      <div className="avatar-shell">
        <div className="robot-head"><span>{bot.shortName}</span></div>
      </div>
      <div className="bot-card">
        <div className="bot-card-top">
          <strong>{bot.name}</strong>
          <span>{bot.score}%</span>
        </div>
        <p>{bot.summary}</p>
        <small>{bot.detail}</small>
      </div>
    </div>
  );
}

export default function WarRoomDashboard() {
  const [result, setResult] = useState<WarRoomResult>(starter);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([
    "Launch Scout opened demo opportunity $NEON",
    "Contract Bot completed hard safety checks",
    "CIO requested multi-agent consensus",
  ]);

  const runCycle = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: result.snapshot }),
      });
      const next: WarRoomResult = await res.json();
      setResult(next);
      setActiveIndex((i) => (i + 1) % 8);
      const cio = next.agents.find((a) => a.id === "cio");
      setLogs((prev) => [
        `${cio?.name ?? "CIO"}: ${cio?.summary ?? next.decision}`,
        `Quant Bot updated conviction to ${next.conviction}%`,
        `Wallet Tracker: ${next.snapshot.smartMoneyBuys} buys / ${next.snapshot.smartMoneySells} sells`,
        ...prev,
      ].slice(0, 8));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void runCycle(), 7000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, result.snapshot]);

  const researchBots = result.agents.filter((a) => !["cio", "executor"].includes(a.id));
  const positive = result.snapshot.priceChange24h >= 0;
  const tokenHistory = useMemo(() => [22, 27, 25, 34, 31, 42, 39, 47, 44, 53, 62, 58, 67, 72, 68, 78], []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">W</div><div><strong>Bot War Room</strong><span>AI TRADING. TOGETHER STRONGER.</span></div></div>
        <nav><button className="nav-active">Dashboard</button><button>War Room</button><button>Bots</button><button>Trades</button><button>Analytics</button></nav>
        <div className="top-actions"><span className="demo-pill">PAPER MODE</span><span className="live-dot"/>8/8 Bots Online</div>
      </header>

      <aside className="sidebar">
        <section className="portfolio-card">
          <span className="eyebrow">PAPER PORTFOLIO</span>
          <h2>$10,000.00</h2>
          <div className="gain">▲ +0.00% today</div>
          <div className="mini-line" />
          <div className="mini-stats"><div><span>Trades</span><b>0</b></div><div><span>Win rate</span><b>—</b></div><div><span>P&L</span><b>$0</b></div></div>
        </section>
        <div className="side-nav">
          {['◈ Dashboard','◎ War Room','⬡ Bots','↗ Trades','▥ Analytics','♡ Watchlist','◌ Alerts','⌕ Token Explorer','⚙ Settings'].map((item, i) => <button className={i === 0 ? 'selected' : ''} key={item}>{item}</button>)}
        </div>
        <div className="side-note"><span>V1 SAFETY</span><p>Real wallet signing is disabled. The executor can only simulate paper orders.</p></div>
      </aside>

      <section className="content">
        <div className="section-head">
          <div><div className="eyebrow green">● LIVE WAR ROOM</div><h1>8 AI agents. 1 decision.</h1><p>Research agents debate the setup. Hard-coded safety rules keep veto power.</p></div>
          <div className="head-actions"><label className="toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span/>Auto cycle</label><button className="primary" onClick={() => void runCycle()} disabled={running}>{running ? "Analyzing…" : "Run consensus"}</button></div>
        </div>

        <div className="hero-grid">
          <section className="war-room panel">
            <div className="room-title"><span>THE WAR ROOM</span><span className="timestamp">{new Date(result.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
            <div className="city-lines" />
            <div className="bot-row top-row">
              {result.agents.slice(0, 4).map((bot, i) => <BotAvatar bot={bot} active={activeIndex === i} key={bot.id} />)}
            </div>
            <div className="conference-table">
              <div className="table-ring ring-1"/><div className="table-ring ring-2"/>
              <div className="decision-core">
                <span>TRADE DECISION</span>
                <strong className={`decision ${result.decision.toLowerCase()}`}>{result.decision}</strong>
                <small>{result.consensus}/6 research agents supportive · {result.conviction}% conviction</small>
              </div>
            </div>
            <div className="bot-row bottom-row">
              {result.agents.slice(4).map((bot, i) => <BotAvatar bot={bot} active={activeIndex === i + 4} key={bot.id} />)}
            </div>
          </section>

          <aside className="token-card panel">
            <div className="token-top"><div><span className="token-icon">N</span><div><h3>${result.snapshot.symbol}</h3><p>{result.snapshot.chain} · {result.snapshot.venue}</p></div></div><span className="demo-pill">DEMO</span></div>
            <div className="price">${result.snapshot.price.toFixed(6)}</div>
            <div className={positive ? "gain" : "loss"}>{positive ? "▲" : "▼"} {result.snapshot.priceChange24h.toFixed(1)}% (24h)</div>
            <div className="chart-box"><svg viewBox="0 0 160 70" preserveAspectRatio="none"><polyline points={tokenHistory.map((v,i)=>`${i*(160/(tokenHistory.length-1))},${70-v*.7}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/></svg></div>
            <div className="token-stats"><div><span>Market cap</span><b>{money(result.snapshot.marketCap)}</b></div><div><span>Liquidity</span><b>{money(result.snapshot.liquidity)}</b></div><div><span>24h volume</span><b>{money(result.snapshot.volume24h)}</b></div><div><span>Holders</span><b>{result.snapshot.holders.toLocaleString()}</b></div><div><span>Top 10</span><b>{result.snapshot.top10Pct.toFixed(1)}%</b></div><div><span>Bundles</span><b>{result.snapshot.bundledPct.toFixed(1)}%</b></div></div>
            <div className={`risk-banner ${result.risk.passed ? "safe" : "blocked"}`}><strong>{result.risk.passed ? "Safety layer passed" : "TRADE BLOCKED"}</strong><span>{result.risk.passed ? `Max paper position ${result.risk.maxPositionPct.toFixed(2)}%` : result.risk.hardBlocks[0]}</span></div>
          </aside>
        </div>

        <div className="bottom-grid">
          <section className="panel consensus-card"><div className="panel-title"><h3>Team Consensus</h3><span>{result.consensus}/6 supportive</span></div>{researchBots.map(bot => <div className="bar-row" key={bot.id}><span>{bot.name}</span><div className="bar"><i style={{ width: `${bot.score}%`, background: bot.color }}/></div><b>{bot.score}%</b></div>)}</section>
          <section className="panel activity"><div className="panel-title"><h3>Bot Activity</h3><span className="green">● Live</span></div>{logs.map((log, i) => <div className="log" key={`${log}-${i}`}><time>{new Date(new Date(result.generatedAt).getTime() - i*60000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</time><p>{log}</p></div>)}</section>
          <section className="panel safety"><div className="panel-title"><h3>Deterministic Guardrails</h3><span>Cannot be overridden by AI</span></div><div className="check-list"><div className={result.snapshot.sellable ? 'ok':'bad'}>✓ Sellability</div><div className={!result.snapshot.mintAuthority ? 'ok':'bad'}>✓ Mint authority off</div><div className={!result.snapshot.freezeAuthority ? 'ok':'bad'}>✓ Freeze authority off</div><div className={result.snapshot.top10Pct <= 80 ? 'ok':'bad'}>✓ Top 10 ≤ 80%</div><div className={result.snapshot.bundledPct <= 25 ? 'ok':'bad'}>✓ Bundles ≤ 25%</div><div className={result.snapshot.liquidity >= 15000 ? 'ok':'bad'}>✓ Liquidity floor</div></div></section>
        </div>
      </section>
    </main>
  );
}
