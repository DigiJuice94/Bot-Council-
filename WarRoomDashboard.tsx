"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentOpinion, ManagedPosition, PaperWalletSnapshot, ProviderHealth, WarRoomResult } from "@/lib/types";
import { buildCouncilDiscussion, type CouncilTurn } from "@/lib/debate";
import { COUNCIL_ART_DATA_URI } from "@/lib/council-art";

type ChatRow = { id: string; at: string; bot: string; message: string; kind: "council" | "system" | "execution" | "guardian" };
type AutopilotPayload = {
  running: boolean;
  mode: "paper";
  dataMode: "adapter" | "birdeye" | "dexscreener";
  intervalMs: number;
  scanningChains: string[];
  currentChain: string;
  lastScanAt?: string;
  nextScanAt?: string;
  scanCount: number;
  candidateCount: number;
  buyCount: number;
  paperWallet: PaperWalletSnapshot;
  providers: ProviderHealth[];
  latestResult: WarRoomResult | null;
  recentDecisions: WarRoomResult[];
  chat: ChatRow[];
  positions: ManagedPosition[];
  lastError?: string;
  generatedAt: string;
};

const fallbackBots: AgentOpinion[] = [
  { id: "launch", name: "Launch Scout", shortName: "LS", score: 0, stance: "neutral", summary: "Waiting for a real listing.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "social", name: "Social Scout", shortName: "SS", score: 0, stance: "neutral", summary: "Waiting for real evidence.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "wallet", name: "Wallet Tracker", shortName: "WT", score: 0, stance: "neutral", summary: "Waiting for real holder data.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "quant", name: "Quant Bot", shortName: "QB", score: 0, stance: "neutral", summary: "Waiting for real market data.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "contract", name: "Contract Bot", shortName: "CB", score: 0, stance: "neutral", summary: "Waiting for security evidence.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "bear", name: "Bear Bot", shortName: "BB", score: 0, stance: "neutral", summary: "Waiting to red-team a real candidate.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "cio", name: "CIO", shortName: "CIO", score: 0, stance: "neutral", summary: "Waiting for the six research reads.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "executor", name: "Executor", shortName: "EX", score: 0, stance: "neutral", summary: "Waiting for a Council-approved paper order.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
];

const botDescriptions: Record<string, { label: string; text: string; tag: string; icon: string }> = {
  cio: { label: "CIO", text: "Synthesizes the six research reads, resolves debate and calls the shot.", tag: "LEAD", icon: "♛" },
  launch: { label: "Launch Scout", text: "Finds new launches, launch velocity and emerging narratives.", tag: "DISCOVERY", icon: "↗" },
  social: { label: "Social Scout", text: "Monitors social velocity, narrative momentum and attention.", tag: "SENTIMENT", icon: "●" },
  wallet: { label: "Wallet Tracker", text: "Tracks holders, unique buyers and smart-money accumulation.", tag: "ON-CHAIN", icon: "▣" },
  quant: { label: "Quant Bot", text: "Analyzes market structure, momentum, volume and liquidity.", tag: "ANALYSIS", icon: "▥" },
  contract: { label: "Contract Bot", text: "Audits sellability, authorities, concentration and security.", tag: "SECURITY", icon: "▤" },
  bear: { label: "Bear Bot", text: "Challenges the thesis and hunts for hidden downside.", tag: "RISK", icon: "◆" },
  executor: { label: "Executor", text: "Automatically paper-executes approved trades and hands them to Guardian.", tag: "EXECUTION", icon: "ϟ" },
};

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

function timeOnly(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ago(value?: string) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function DecisionCard({ result, replaying, dataMode, currentChain }: { result: WarRoomResult | null; replaying: boolean; dataMode?: "adapter" | "birdeye" | "dexscreener"; currentChain?: string }) {
  if (!result) {
    return (
      <section className="decision-card decision-card-empty" aria-live="polite">
        <div className="decision-card-top">
          <div className="asset-heading"><span className="asset-logo live-logo">●</span><div><h2>LIVE FEED</h2><p>{currentChain ?? "Solana"}</p></div></div>
          <div className="decision-badge badge-watch">SCANNING<small>Real market data only</small></div>
        </div>
        <div className="decision-stats">
          <div><strong>—</strong><span>Current Price</span></div>
          <div><strong>—</strong><span>Conviction</span></div>
          <div><strong>—</strong><span>Risk Level</span></div>
          <div className="spark-wrap waiting-spark" aria-hidden="true"><svg viewBox="0 0 120 42" preserveAspectRatio="none"><polyline points="0,30 18,30 34,30 50,30 65,30 83,30 99,30 120,30" /></svg></div>
        </div>
        <p className="decision-thesis">Waiting for the first qualifying live candidate from {dataMode === "adapter" ? "your configured market-data adapter" : dataMode === "birdeye" ? "Birdeye New Listings + DEX enrichment" : "DEX Screener live discovery"}. Demo tokens and placeholder prices are disabled.</p>
        <div className="decision-options" aria-label="Council decision states"><span className="buy">BUY</span><span className="watch">WATCH</span><span className="skip">SKIP</span></div>
      </section>
    );
  }

  const decision = result.decision;
  const symbol = result.snapshot.symbol;
  const chain = result.snapshot.chain;
  const currentPrice = result.snapshot.price;
  const conviction = result.conviction;
  const riskScore = result.risk.riskScore;
  const risk = riskLabel(riskScore);
  const cio = result.agents.find((agent) => agent.id === "cio");
  const thesis = cio?.summary ?? "Council evaluating live market evidence.";
  const activeSkip = decision === "SKIP" || decision === "EXIT";
  const spark = result.snapshot.priceChange24h < 0
    ? "0,7 18,14 34,10 50,23 65,18 83,31 99,27 120,39"
    : "0,36 18,27 34,31 50,20 65,29 83,14 99,19 120,2";
  const source = result.snapshot.dataProvenance?.marketSource === "birdeye" ? "Birdeye + DEX live" : result.snapshot.dataProvenance?.marketSource === "dexscreener" ? "DEX Screener live" : "Live adapter";

  return (
    <section className="decision-card" aria-live="polite">
      <div className="decision-card-top">
        <div className="asset-heading"><span className="asset-logo">{symbol.slice(0, 1)}</span><div><h2>${symbol}</h2><p>{chain} · {source}</p></div></div>
        <div className={`decision-badge badge-${decision.toLowerCase()}`}>{decision}<small>{replaying ? "Council reasoning replay" : "Current Decision"}</small></div>
      </div>
      <div className="decision-stats">
        <div><strong>{price(currentPrice)}</strong><span>Current Price</span></div>
        <div><strong>{conviction}%</strong><span>Conviction</span></div>
        <div><strong className={`risk-${risk.toLowerCase()}`}>{risk}</strong><span>Risk Level</span></div>
        <div className="spark-wrap" aria-hidden="true"><svg viewBox="0 0 120 42" preserveAspectRatio="none"><polyline points={spark} /></svg></div>
      </div>
      <p className="decision-thesis">{thesis}</p>
      <div className="decision-context-mini"><span><b>{result.councilProcess.lane === "meme" ? result.memeRegime.label : result.regime.label}</b><small>{result.councilProcess.lane === "meme" ? "Meme lane" : "Regime"}</small></span><span><b>{result.councilProcess.alignedBots}/8</b><small>Bot alignment</small></span><span><b>{result.memeRegime.isMeme ? `${result.memeRegime.launchVelocityScore.toFixed(0)}/100` : `${result.alpha.score}/100`}</b><small>{result.memeRegime.isMeme ? "Launch velocity" : "Alpha"}</small></span><span><b>{result.councilProcess.executorVote}</b><small>Executor</small></span></div>
      <div className="decision-options" aria-label="Council decision states"><span className={decision === "BUY" ? "active buy" : "buy"}>BUY</span><span className={decision === "WATCH" ? "active watch" : "watch"}>WATCH</span><span className={activeSkip ? "active skip" : "skip"}>{decision === "EXIT" ? "EXIT" : "SKIP"}</span></div>
    </section>
  );
}

function CouncilBot({ bot, index, active, speech, context }: { bot: AgentOpinion; index: number; active: boolean; speech?: string; context?: string }) {
  return <div className={`council-bot bot-pos-${index} ${active ? "speaking" : ""}`}>{active && <><div className="speech-pop" role="status"><b>{bot.name}</b>{context && <small className="speech-context">{context}</small>}<span>{speech ?? bot.summary}</span></div><span className="active-seat-pulse" aria-hidden="true" /></>}<div className="bot-name-tag">{bot.shortName}</div></div>;
}

function buildVisualCouncilReplay(result: WarRoomResult): CouncilTurn[] {
  const full = buildCouncilDiscussion(result);
  const order: Array<{ agentId: AgentOpinion["id"]; round?: CouncilTurn["round"] }> = [
    { agentId: "launch", round: "opening" },
    { agentId: "social", round: "opening" },
    { agentId: "wallet", round: "opening" },
    { agentId: "quant", round: "rebuttal" },
    { agentId: "contract", round: "rebuttal" },
    { agentId: "bear", round: "rebuttal" },
    { agentId: "cio", round: "decision" },
    { agentId: "executor", round: "execution" },
  ];

  return order.flatMap(({ agentId, round }) => {
    const exact = full.find((turn) => turn.agentId === agentId && (!round || turn.round === round));
    const fallback = full.find((turn) => turn.agentId === agentId);
    return exact ? [exact] : fallback ? [fallback] : [];
  });
}

export default function WarRoomDashboard() {
  const [status, setStatus] = useState<AutopilotPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<WarRoomResult | null>(null);
  const [activeTurn, setActiveTurn] = useState(-1);
  const [scanBubble, setScanBubble] = useState<{ agentId: AgentOpinion["id"]; message: string; round: CouncilTurn["round"] } | null>(null);
  const pendingReplayRef = useRef<WarRoomResult | null>(null);
  const lastObservedDecisionRef = useRef<string | null>(null);
  const lastScanCountRef = useRef(0);
  const result = status?.latestResult ?? null;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/autopilot", { cache: "no-store" });
        if (!response.ok) throw new Error(`Autopilot status ${response.status}`);
        const payload = await response.json() as AutopilotPayload;
        if (!alive) return;
        setStatus(payload);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!result || lastObservedDecisionRef.current === result.decisionId) return;
    lastObservedDecisionRef.current = result.decisionId;
    if (replayResult && activeTurn >= 0) {
      // Do not interrupt a bot mid-sentence. Keep only the newest pending council result.
      pendingReplayRef.current = result;
      return;
    }
    setReplayResult(result);
    setActiveTurn(0);
    setScanBubble(null);
  }, [result, replayResult, activeTurn]);

  const discussion: CouncilTurn[] = useMemo(() => replayResult ? buildVisualCouncilReplay(replayResult) : [], [replayResult]);
  useEffect(() => {
    if (!replayResult || activeTurn < 0 || discussion.length === 0) return;
    const finalTurn = activeTurn >= discussion.length - 1;
    const timer = window.setTimeout(() => {
      if (!finalTurn) {
        setActiveTurn((turn) => turn + 1);
        return;
      }
      const pending = pendingReplayRef.current;
      pendingReplayRef.current = null;
      if (pending && pending.decisionId !== replayResult.decisionId) {
        setReplayResult(pending);
        setActiveTurn(0);
        return;
      }
      setActiveTurn(-1);
      setReplayResult(null);
    }, finalTurn ? 2400 : 2100);
    return () => window.clearTimeout(timer);
  }, [activeTurn, discussion, replayResult]);

  useEffect(() => {
    const scanCount = status?.scanCount ?? 0;
    if (!scanCount || scanCount === lastScanCountRef.current) return;
    lastScanCountRef.current = scanCount;
    if (replayResult && activeTurn >= 0) return;
    setScanBubble({
      agentId: "launch",
      round: "opening",
      message: `Scanning ${status?.currentChain ?? "the next chain"} for a real new listing. No placeholder token or simulated market feed is being used.`,
    });
    const timer = window.setTimeout(() => setScanBubble(null), 1800);
    return () => window.clearTimeout(timer);
  }, [status?.scanCount, status?.currentChain, replayResult, activeTurn]);

  const talking = Boolean(replayResult && activeTurn >= 0 && discussion[activeTurn]);
  const currentTurn = talking ? discussion[activeTurn] : undefined;
  const displayedTurn = currentTurn ?? scanBubble ?? undefined;
  const roomBots = replayResult?.agents ?? result?.agents ?? fallbackBots;
  const visibleBots = useMemo(() => [...roomBots].slice(0, 8), [roomBots]);
  const chat = status?.chat ?? [];
  const positions = status?.positions ?? [];
  const roster = ["cio", "launch", "social", "wallet", "quant", "contract", "bear", "executor"];

  return (
    <main className="light-app">
      <section id="live" className="council-stage">
        <div className="stage-brand-row" aria-label="Bot War Room autonomous status">
          <div className="stage-brand"><span className="brand-orbit" /><strong>Bot War Room V2.12.4</strong></div>
          <span className="autonomous-pill"><i /> AUTONOMOUS</span>
        </div>
        <div className="decision-card-slot"><DecisionCard result={result} replaying={talking} dataMode={status?.dataMode} currentChain={status?.currentChain} /></div>
        <div className="table-scene" aria-label="Eight-bot council meeting room">
          <img className="council-reference-art" src={COUNCIL_ART_DATA_URI} alt="Eight Bot War Room agents seated around the council table" draggable={false} />
          {visibleBots.map((bot, index) => <CouncilBot key={bot.id} bot={bot} index={index} active={Boolean(displayedTurn && bot.id === displayedTurn.agentId)} speech={bot.id === displayedTurn?.agentId ? displayedTurn.message : undefined} context={bot.id === displayedTurn?.agentId ? (replayResult && currentTurn ? `$${replayResult.snapshot.symbol} · ${currentTurn.round}` : `${status?.currentChain ?? "Live"} · real scan`) : undefined} />)}
        </div>
        <div className="live-caption"><span className={`status-dot ${displayedTurn ? "talking" : ""}`} /><b>{displayedTurn ? `${roomBots.find((b) => b.id === displayedTurn.agentId)?.name ?? "Council"} speaking` : "Autonomous Council live"}</b><span>{displayedTurn ? displayedTurn.message : status ? `REAL DATA · ${status.dataMode === "birdeye" ? "Birdeye New Listings" : status.dataMode === "adapter" ? "adapter" : "DEX Screener"} · scanning ${status.currentChain} · ${status.candidateCount} real candidates · ${status.buyCount} paper buys` : "Starting real-data paper scanner"}</span></div>
      </section>

      <section className="autonomy-band">
        <div><span className="green-live"><i /> LIVE</span><strong>Real-data autonomous paper trader</strong><p>Fresh listings flow into the eight-bot Council automatically. Approved BUYs spend the persistent $1,000 paper wallet; Guardian marks positions to market, scales confirmed winners, trims, exits and returns simulated proceeds to cash.</p></div>
        <div className="paper-wallet-strip">
          <span><small>Starting wallet</small><b>${(status?.paperWallet?.startingCashUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Equity</small><b>${(status?.paperWallet?.equityUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Cash</small><b>${(status?.paperWallet?.cashUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Total P/L</small><b className={(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${(status?.paperWallet?.totalPnlUsd ?? 0).toFixed(2)} ({(status?.paperWallet?.totalReturnPct ?? 0).toFixed(2)}%)</b></span>
          <span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span>
        </div>
        <div className="autonomy-stats"><span><b>{status?.scanningChains?.length ?? 6}</b><small>chains</small></span><span><b>{status ? `${Math.round(status.intervalMs / 1000)}s` : "2s"}</b><small>rotation cadence</small></span><span><b>{status?.candidateCount ?? 0}</b><small>real candidates</small></span><span><b>{status?.buyCount ?? 0}</b><small>paper buys</small></span></div>
        <div className="provider-health-row">{(status?.providers ?? []).map((provider) => <span key={provider.name} className={provider.ok ? "provider-ok" : provider.configured ? "provider-warn" : "provider-off"}><i />{provider.name.toUpperCase()} <small>{provider.ok ? "LIVE" : provider.configured ? "WAIT" : "OFF"}</small></span>)}</div>
        {(status?.lastError || error) && <p className="autonomy-warning">{status?.lastError ?? error}</p>}
      </section>

      <section id="chat" className="log-panel page-panel">
        <div className="wide-panel-head"><div><h2>◯ Chat Log</h2><p>Live conversations from the War Room</p></div><span className="live-chip"><i /> LIVE</span></div>
        <div className="chat-table">
          {chat.length ? chat.slice(0, 14).map((row) => <div className="chat-row" key={row.id}><time>{timeOnly(row.at)}</time><span className={`mini-agent mini-${row.kind}`}>{row.bot.slice(0, 2).toUpperCase()}</span><b>{row.bot}</b><p>{row.message}</p></div>) : <div className="empty-row">The autonomous council is booting. New bot messages will appear here without a click.</div>}
        </div>
      </section>

      <section id="trades" className="log-panel page-panel">
        <div className="wide-panel-head"><div><h2>↗ Trades Log</h2><p>Positions executed and managed automatically by the War Room</p></div><span className="quiet-chip">Guardian owned</span></div>
        <div className="trades-table">
          <div className="trade-row trade-head"><span>Token</span><span>Chain</span><span>Entry</span><span>Mark / Exit</span><span>Status</span><span>P/L</span><span>Time</span></div>
          {positions.length ? positions.slice(0, 12).map((position) => <div className="trade-row" key={position.id}><b>${position.symbol}</b><span>{position.chain}</span><span>{price(position.entryPrice)}</span><span>{price(position.markPrice)}</span><span><em className={`status-${position.status}`}>{position.status === "closed" ? "Closed" : "Open"}</em></span><strong className={position.pnlPct >= 0 ? "positive" : "negative"}>{position.pnlPct >= 0 ? "+" : ""}{position.pnlPct.toFixed(1)}%</strong><span>{ago(position.openedAt)}</span></div>) : <div className="empty-row">No autonomous paper positions yet. Executor is waiting for a Council-approved BUY.</div>}
        </div>
      </section>

      <section id="roster" className="roster-panel page-panel">
        <div className="wide-panel-head"><div><h2>♧ Bot Roster</h2><p>Eight specialized decision roles. One coordinated War Room.</p></div><span>Built for better decisions.</span></div>
        <div className="roster-grid">{roster.map((id) => { const bot = botDescriptions[id]; return <article className="roster-card" key={id}><span className="roster-icon">{bot.icon}</span><div><h3>{bot.label}</h3><p>{bot.text}</p><small>{bot.tag}</small></div></article>; })}</div>
      </section>

      <section id="system" className="system-strip page-panel">
        <div><b>Autonomous paper execution</b><span>There is intentionally no Scan button and no Execute Paper button. Approved paper orders are created server-side from real market observations; placeholder/demo candidates are disabled. Decisions and fills are journaled for later analysis.</span></div>
        <div><b>Guardian 24/7</b><span>Scaling, trims, stops, re-entry rules and moonbag logic remain server-owned.</span></div>
        <div><b>Safety still deterministic</b><span>The eight bots cannot vote around honeypot, sellability, concentration, authority or portfolio kill-switch vetoes.</span></div>
      </section>
    </main>
  );
}
