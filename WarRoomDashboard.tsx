"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = { name: string; configured: boolean; ok: boolean; lastError?: string };
type Payload = {
  scanCount?: number;
  candidateCount?: number;
  buyCount?: number;
  providers?: Provider[];
  research?: { freshCoinWins?: number; targetFreshCoinWins?: number; codeProgressPct?: number };
};

type BotCard = { id: string; name: string; role: string; mood: string; bubble?: string; className: string };

const bots: BotCard[] = [
  { id: "social", name: "Social Scout", role: "Sentiment", mood: "happy", bubble: "Narrative turning positive.", className: "bot-social" },
  { id: "launch", name: "Launch Scout", role: "Discovery", mood: "happy", bubble: "Fresh launch entering velocity lane.", className: "bot-launch" },
  { id: "wallet", name: "Wallet Tracker", role: "Flow", mood: "thinking", bubble: "I agree with Social Scout's direction. Wallet flow needs confirmation.", className: "bot-wallet" },
  { id: "cio", name: "CIO", role: "Lead", mood: "calm", bubble: "Hold the line. Wait for confirmation.", className: "bot-cio" },
  { id: "quant", name: "Quant", role: "Analysis", mood: "thinking", bubble: "Momentum is building, but not enough for a clean buy.", className: "bot-quant" },
  { id: "contract", name: "Contract", role: "Security", mood: "happy", bubble: "No hard red flags so far.", className: "bot-contract" },
  { id: "portfolio", name: "Portfolio", role: "Risk", mood: "bored", bubble: "Don't size up yet.", className: "bot-portfolio" },
  { id: "bear", name: "Bear", role: "Downside", mood: "grumpy", bubble: "Show me distribution improvement first.", className: "bot-bear" },
];

const providerOrder = ["birdeye", "dexscreener", "goplus", "helius", "jupiter", "redis", "moralis", "bitquery", "solana-rpc", "0x"];

function prettyProviderLabel(name: string) {
  const map: Record<string, string> = {
    birdeye: "BIRDEYE",
    dexscreener: "DEXSCREENER",
    goplus: "GOPLUS",
    helius: "HELIUS",
    jupiter: "JUPITER",
    redis: "REDIS",
    moralis: "MORALIS",
    bitquery: "BITQUERY",
    "solana-rpc": "SOLANA-RPC",
    "0x": "ZEROEX",
  };
  return map[name.toLowerCase()] ?? name.toUpperCase();
}

export default function WarRoomDashboard() {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/autopilot", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as Payload;
        if (active) setPayload(next);
      } catch {
        // keep the visual layer alive with defaults
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const providers = useMemo(() => {
    const source = payload?.providers ?? [];
    const byName = new Map(source.map((p) => [p.name.toLowerCase(), p]));
    return providerOrder.map((key) => byName.get(key) ?? { name: key, configured: false, ok: false });
  }, [payload?.providers]);

  const freshWins = payload?.research?.freshCoinWins ?? 0;
  const winTarget = payload?.research?.targetFreshCoinWins ?? 100;
  const progress = Math.round(payload?.research?.codeProgressPct ?? 0);

  const chatRows = [
    ["10:14:22", "CIO", "Four smart wallets still accumulating on dips. This looks intentional."],
    ["10:14:17", "Quant Bot", "Top-10 concentration rising. Currently at 27% (up from 18%)."],
    ["10:14:03", "Wallet Tracker", "Fresh inflows from 4 high-conviction wallets. No major outflows detected."],
    ["10:13:49", "Social Scout", "Social volume up 312% in the last hour. Sentiment is turning positive."],
    ["10:13:28", "Launch Scout", "Liquidity is thinning. Watch for potential volatility."],
    ["10:12:57", "Bear Bot", "Risk remains elevated. Large unlock in 48 hours."],
    ["10:12:41", "Contract Bot", "No red flags in contract. Ownership renounced. Tax 0/0."],
    ["10:12:18", "Executor", "Standing by. Awaiting final decision from CIO."],
  ];

  const tradeRows = [
    ["$NOVA", "Solana", "$0.0062", "$0.0098", "Closed", "+58.1%", "2h ago"],
    ["$DRIFT", "Arbitrum", "$1.24", "$1.11", "Closed", "-10.5%", "5h ago"],
    ["$ZENT", "Base", "$0.032", "$0.048", "Closed", "+50.0%", "12h ago"],
    ["$KAI", "Ethereum", "$0.18", "$0.16", "Closed", "-11.1%", "1d ago"],
    ["$WAVE", "Solana", "$0.011", "-", "Open", "-", "3h ago"],
  ];

  const rosterRows = [
    ["CIO", "Strategic decision maker. Synthesizes all data and calls the shots.", "LEAD"],
    ["Launch Scout", "Finds early opportunities across chains, new launches and trending narratives.", "DISCOVERY"],
    ["Social Scout", "Monitors social sentiment, KOL activity and narrative momentum in real time.", "SENTIMENT"],
    ["Wallet Tracker", "Tracks smart money flows, whale activity and on-chain accumulation.", "ON-CHAIN"],
    ["Quant Bot", "Analyzes market structure, indicators and quantitative signals.", "ANALYSIS"],
    ["Contract Bot", "Audits contracts, checks for risks and monitors on-chain security.", "SECURITY"],
    ["Bear Bot", "Challenges the thesis. Identifies risks, downtrends and potential downside.", "RISK"],
    ["Executor", "Executes trades with precision. Monitors positions and manages exits.", "EXECUTION"],
  ];

  return (
    <main className="bw-shell">
      <header className="bw-topbar">
        <div className="stage-brand"><span className="brand-ring" /> <strong>Bot War Room V2.14</strong></div>
        <nav className="bw-nav"><a className="active">Live</a><a>Features</a><a>Performance</a><a>Pricing</a><a>Docs</a></nav>
        <div className="bw-actions"><button className="icon-btn" aria-label="theme">◐</button><button className="ghost-btn">Sign In</button><button className="solid-btn">Get Started →</button></div>
      </header>

      <section className="bw-hero">
        <div className="decision-card-slot">
          <article className="decision-card">
            <div className="decision-card-top">
              <div className="decision-token"><span className="token-badge">X</span><div><strong>$WAVE</strong><small>Solana</small></div></div>
              <div className="decision-status"><b>WATCH</b><span>Current Decision</span></div>
            </div>
            <div className="decision-stats">
              <div><small>Current Price</small><b>$0.0124</b></div>
              <div><small>Conviction</small><b>78%</b></div>
              <div><small>Risk Level</small><b className="warning">MEDIUM</b></div>
              <div className="mini-chart"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <p className="decision-thesis">Strong momentum with healthy liquidity. Monitoring for a better entry while the Council compares it against runner and dumper patterns.</p>
            <div className="decision-options"><span className="buy">BUY</span><span className="watch">WATCH</span><span className="skip">SKIP</span></div>
          </article>
        </div>

        <section className="council-stage" aria-label="Council Scene">
          <div className="council-scene">
            <div className="speech-strip">• Wallet Tracker speaking &nbsp; I agree with Social Scout&apos;s direction. Wallet flow needs confirmation. 0 tracked buys · 0 tracked sells · holder growth 0.0%</div>
            <div className="council-table" />
            {bots.map((bot) => (
              <div key={bot.id} className={`orb-bot ${bot.className} mood-${bot.mood}`}>
                <div className="orb-head">
                  <span className="orb-face" />
                </div>
                <div className="orb-body" />
                <div className="orb-chair" />
                <div className="orb-laptop" />
                <small className="orb-name">{bot.name}</small>
                {bot.bubble ? <div className={`bubble ${bot.id === "cio" ? "bubble-center" : ""}`}>{bot.bubble}</div> : null}
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="paper-block page-panel">
        <div className="paper-head"><div><span className="live-dot" /> <strong>Real-data autonomous paper trader</strong></div><p>Fresh listings flow into the eight-bot Council automatically. Approved BUYs spend the persistent $1,000 paper wallet; Guardian marks positions to market, scales confirmed winners, trims, exits and returns simulated proceeds to cash.</p></div>
        <div className="paper-stats-top">
          <div><small>Starting Wallet</small><b>$1000.00</b></div>
          <div><small>Equity</small><b>$1000.00</b></div>
          <div><small>Cash</small><b>$1000.00</b></div>
          <div><small>Total P/L</small><b className="profit">+$0.00 (0.00%)</b></div>
          <div><small>Open Positions</small><b>{Math.min(8, payload?.buyCount ?? 0)}</b></div>
        </div>
        <div className="paper-stats-mid">
          <div><b>6</b><span>Chains</span></div>
          <div><b>2s</b><span>Rotation Cadence</span></div>
          <div><b>{payload?.candidateCount ?? 0}</b><span>Real Candidates</span></div>
          <div><b>{payload?.buyCount ?? 0}</b><span>Paper Buys</span></div>
        </div>
        <div className="provider-pills">{providers.map((provider) => <span key={provider.name} className={`provider-pill ${provider.ok ? "live" : provider.configured ? "wait" : "off"}`}><i />{prettyProviderLabel(provider.name)} <b>{provider.ok ? "LIVE" : provider.configured ? "WAIT" : "OFF"}</b></span>)}</div>
        <div className="decipher-strip"><div><small>CODE DECIPHERING</small><b>{progress}%</b></div><div className="decipher-bar"><i style={{ width: `${progress}%` }} /></div><span>{freshWins}/{winTarget} successful fresh-coin wins</span></div>
      </section>

      <section className="clean-section page-panel">
        <div className="clean-panel">
          <div className="panel-head"><div><h3>Chat Log</h3><p>Live conversations from the War Room</p></div><div className="panel-tag">LIVE</div></div>
          <div className="chat-table">{chatRows.map((row) => <div className="chat-row" key={row[0] + row[1]}><span>{row[0]}</span><b>{row[1]}</b><p>{row[2]}</p></div>)}</div>
        </div>

        <div className="clean-panel">
          <div className="panel-head"><div><h3>Trades Log</h3><p>Recent trades executed by the War Room</p></div><button className="mini-btn">View All →</button></div>
          <div className="trades-table">
            <div className="trade-head"><span>Token</span><span>Chain</span><span>Entry</span><span>Exit</span><span>Status</span><span>P/L</span><span>Time</span></div>
            {tradeRows.map((row) => <div className="trade-row" key={row[0] as string}>{row.map((col, idx) => <span key={idx} className={idx === 4 ? `status-${String(col).toLowerCase()}` : idx === 5 ? (String(col).startsWith("+") ? "green" : String(col).startsWith("-") ? "red" : "") : ""}>{col}</span>)}</div>)}
          </div>
        </div>

        <div className="clean-panel">
          <div className="panel-head"><div><h3>Bot Roster</h3><p>Eight specialized AI agents. A unified edge.</p></div><span className="muted-right">Built for better decisions.</span></div>
          <div className="roster-grid">{rosterRows.map((row) => <article className="roster-card" key={row[0] as string}><h4>{row[0]}</h4><p>{row[1]}</p><small>{row[2]}</small></article>)}</div>
        </div>
      </section>
    </main>
  );
}
