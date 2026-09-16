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
  chainStats?: Record<string, { scans: number; candidates: number; lastScanAt?: string; lastCandidateAt?: string }>;
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

function chatTone(bot: string, kind: ChatRow["kind"]) {
  const name = bot.toLowerCase();
  if (kind === "system" || name.includes("system")) return "system";
  if (name.includes("cio")) return "cio";
  if (name.includes("launch")) return "launch";
  if (name.includes("social")) return "social";
  if (name.includes("wallet")) return "wallet";
  if (name.includes("quant")) return "quant";
  if (name.includes("contract")) return "contract";
  if (name.includes("bear")) return "bear";
  if (name.includes("executor")) return "executor";
  if (name.includes("guardian")) return "guardian";
  return "neutral";
}

function chatInitials(bot: string) {
  const words = bot.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "AI";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

const CHAT_REVEAL_MS = 1150;

type EquityHistoryPoint = { at: number; equity: number; cash: number; openValue: number };
type PositionHistoryPoint = { at: number; price: number };

function svgPolyline(values: number[], width = 1000, height = 220, pad = 16) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.00000001, max - min);
  const usableW = Math.max(1, width - pad * 2);
  const usableH = Math.max(1, height - pad * 2);
  return values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : pad + (index / (values.length - 1)) * usableW;
    const y = pad + (1 - (value - min) / span) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function relativeY(value: number, values: number[], height = 220, pad = 16) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return height / 2;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = Math.max(0.00000001, max - min);
  return pad + (1 - (value - min) / span) * Math.max(1, height - pad * 2);
}

function DecisionCard({ result, replaying, dataMode, currentChain }: {
  result: WarRoomResult | null;
  replaying: boolean;
  dataMode?: "adapter" | "birdeye" | "dexscreener";
  currentChain?: string;
}) {
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
  const risk = riskLabel(result.risk.riskScore);
  const cio = result.agents.find((agent) => agent.id === "cio");
  const thesis = cio?.summary ?? "Council evaluating live market evidence.";
  const activeSkip = decision === "SKIP" || decision === "EXIT";
  const spark = result.snapshot.priceChange24h < 0
    ? "0,7 18,14 34,10 50,23 65,18 83,31 99,27 120,39"
    : "0,36 18,27 34,31 50,20 65,29 83,14 99,19 120,2";
  const source = result.snapshot.dataProvenance?.marketSource === "birdeye" ? "Birdeye + DEX live"
    : result.snapshot.dataProvenance?.marketSource === "geckoterminal" ? "GeckoTerminal new pool + DEX live"
    : result.snapshot.dataProvenance?.marketSource === "dexscreener" ? "DEX Screener live" : "Live adapter";

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
      <div className="decision-context-mini">
        <span><b>{result.councilProcess.lane === "meme" ? result.memeRegime.label : result.regime.label}</b><small>{result.councilProcess.lane === "meme" ? "Meme lane" : "Regime"}</small></span>
        <span><b>{result.councilProcess.alignedBots}/8</b><small>Bot alignment</small></span>
        <span><b>{result.memeRegime.isMeme ? `${result.memeRegime.launchVelocityScore.toFixed(0)}/100` : `${result.alpha.score}/100`}</b><small>{result.memeRegime.isMeme ? "Launch velocity" : "Alpha"}</small></span>
        <span><b>{result.councilProcess.executorVote}</b><small>Executor</small></span>
      </div>
      <div className="decision-options" aria-label="Council decision states">
        <span className={decision === "BUY" ? "active buy" : "buy"}>BUY</span>
        <span className={decision === "WATCH" ? "active watch" : "watch"}>WATCH</span>
        <span className={activeSkip ? "active skip" : "skip"}>{decision === "EXIT" ? "EXIT" : "SKIP"}</span>
      </div>
    </section>
  );
}

function CouncilBot({ bot, index, active, speech, context }: {
  bot: AgentOpinion; index: number; active: boolean; speech?: string; context?: string;
}) {
  return <div className={`council-bot bot-pos-${index} ${active ? "speaking" : ""}`}>
    {active && <>
      <div className="speech-pop" role="status"><b>{bot.name}</b>{context && <small className="speech-context">{context}</small>}<span>{speech ?? bot.summary}</span></div>
      <span className="active-seat-pulse" aria-hidden="true" />
    </>}
    <div className="bot-name-tag">{bot.shortName}</div>
  </div>;
}

function buildVisualCouncilReplay(result: WarRoomResult): CouncilTurn[] {
  const full = buildCouncilDiscussion(result);
  const order: Array<{ agentId: AgentOpinion["id"]; round?: CouncilTurn["round"] }> = [
    { agentId: "launch", round: "opening" }, { agentId: "social", round: "opening" },
    { agentId: "wallet", round: "opening" }, { agentId: "quant", round: "rebuttal" },
    { agentId: "contract", round: "rebuttal" }, { agentId: "bear", round: "rebuttal" },
    { agentId: "cio", round: "decision" }, { agentId: "executor", round: "execution" },
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
  const [renderedChat, setRenderedChat] = useState<ChatRow[]>([]);
  const [chatQueue, setChatQueue] = useState<ChatRow[]>([]);
  const [chatLive, setChatLive] = useState(true);
  const [chatInitialized, setChatInitialized] = useState(false);
  const [equityHistory, setEquityHistory] = useState<EquityHistoryPoint[]>([]);
  const [positionHistory, setPositionHistory] = useState<Record<string, PositionHistoryPoint[]>>({});
  const pendingReplayRef = useRef<WarRoomResult | null>(null);
  const lastObservedDecisionRef = useRef<string | null>(null);
  const lastScanCountRef = useRef(0);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const chatSeenIdsRef = useRef<Set<string>>(new Set());
  const suppressChatPauseRef = useRef(false);
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
  useEffect(() => {
    if (!status?.paperWallet) return;
    const now = Date.now();
    const openPositions = (status.positions ?? []).filter((position) => position.status !== "closed");
    const openValue = openPositions.reduce((sum, position) => sum + Math.max(0, position.remainingQuantity ?? 0) * Math.max(0, position.markPrice ?? 0), 0);
    setEquityHistory((current) => {
      const next = [...current, { at: now, equity: status.paperWallet.equityUsd, cash: status.paperWallet.cashUsd, openValue }];
      return next.slice(-240);
    });
    setPositionHistory((current) => {
      const next = { ...current };
      for (const position of openPositions) {
        const rows = next[position.id] ?? [];
        next[position.id] = [...rows, { at: now, price: position.markPrice }].slice(-180);
      }
      return next;
    });
  }, [status?.generatedAt]);

  const visibleBots = useMemo(() => [...roomBots].slice(0, 8), [roomBots]);
  const chat = status?.chat ?? [];
  const positions = status?.positions ?? [];
  const openPositions = positions.filter((position) => position.status !== "closed");
  const openPositionValue = openPositions.reduce((sum, position) => sum + Math.max(0, position.remainingQuantity ?? 0) * Math.max(0, position.markPrice ?? 0), 0);
  const openPositionCost = openPositions.reduce((sum, position) => sum + Math.max(0, position.remainingQuantity ?? 0) * Math.max(0, position.entryPrice ?? 0), 0);
  const unrealizedPnl = openPositionValue - openPositionCost;
  const realizedPnl = positions.reduce((sum, position) => sum + (position.realizedPnlUsd ?? 0), 0);
  const reconciledEquity = (status?.paperWallet?.cashUsd ?? 0) + openPositionValue;
  const reconciliationDelta = status?.paperWallet ? status.paperWallet.equityUsd - reconciledEquity : 0;
  const reconciliationPass = Math.abs(reconciliationDelta) <= 0.10;
  const roster = ["cio", "launch", "social", "wallet", "quant", "contract", "bear", "executor"];
  const liveSpeaker = displayedTurn ? roomBots.find((bot) => bot.id === displayedTurn.agentId) : undefined;

  // First load shows a small recent window so the page does not explode in height.
  // After that, every newly-arriving server message is queued and revealed one at a time.
  useEffect(() => {
    if (!chat.length) return;
    const ordered = [...chat].reverse();

    if (!chatInitialized) {
      const recent = ordered.slice(-6);
      setRenderedChat(recent);
      chatSeenIdsRef.current = new Set(chat.map((row) => row.id));
      setChatInitialized(true);
      return;
    }

    const fresh = ordered.filter((row) => !chatSeenIdsRef.current.has(row.id));
    if (!fresh.length) return;
    for (const row of fresh) chatSeenIdsRef.current.add(row.id);
    setChatQueue((current) => [...current, ...fresh].slice(-120));
  }, [chat, chatInitialized]);

  // Drain the live queue at a deliberate conversational pace.
  useEffect(() => {
    if (!chatLive || !chatQueue.length) return;
    const timer = window.setTimeout(() => {
      const next = chatQueue[0];
      setChatQueue((current) => current.slice(1));
      setRenderedChat((current) => [...current, next].slice(-60));
    }, CHAT_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [chatLive, chatQueue]);

  // Only follow the bottom while LIVE is enabled.
  useEffect(() => {
    if (!chatLive) return;
    const feed = chatFeedRef.current;
    if (!feed) return;
    suppressChatPauseRef.current = true;
    const id = window.requestAnimationFrame(() => {
      feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
      window.setTimeout(() => { suppressChatPauseRef.current = false; }, 500);
    });
    return () => window.cancelAnimationFrame(id);
  }, [renderedChat.length, chatLive]);

  const handleChatScroll = () => {
    const feed = chatFeedRef.current;
    if (!feed || suppressChatPauseRef.current || !chatLive) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (distanceFromBottom > 90) setChatLive(false);
  };

  const resumeLiveChat = () => {
    setChatLive(true);
    const feed = chatFeedRef.current;
    if (!feed) return;
    suppressChatPauseRef.current = true;
    window.requestAnimationFrame(() => {
      feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
      window.setTimeout(() => { suppressChatPauseRef.current = false; }, 500);
    });
  };

  return (
    <main className="light-app">
      <section id="live" className="council-stage">
        <div className="stage-brand-row" aria-label="Bot War Room autonomous status">
          <div className="stage-brand"><span className="brand-orbit" /><strong>Bot War Room V2.19</strong></div>
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
        <div className="autonomy-stats"><span><b>{status?.scanningChains?.length ?? 7}</b><small>chains</small></span><span><b>{status ? `${Math.round(status.intervalMs / 1000)}s` : "2s"}</b><small>rotation cadence</small></span><span><b>{status?.candidateCount ?? 0}</b><small>real candidates</small></span><span><b>{status?.buyCount ?? 0}</b><small>paper buys</small></span></div>
        <div className="sizing-policy-strip"><span><b>Dynamic paper sizing</b><small>Full BUY up to 7.5% · WATCH probe up to 1.5% · confirmed winners can scale toward 15%</small></span><span className="sizing-live-note">Live sizing stays conservative until Code Deciphered</span></div>
        <div className="chain-scan-grid">{(status?.scanningChains ?? ["Solana","Ethereum","Base","BNB Chain","Monad","HyperEVM","Robinhood Chain"]).map((chain) => { const stats = status?.chainStats?.[chain]; const active = status?.currentChain === chain; return <span key={chain} className={active ? "chain-scan active" : "chain-scan"}><i /><b>{chain}</b><small>{stats?.scans ?? 0} scans · {stats?.candidates ?? 0} candidates</small></span>; })}</div>
        <div className="provider-health-row">{(status?.providers ?? []).map((provider) => <span key={provider.name} className={provider.ok ? "provider-ok" : provider.configured ? "provider-warn" : "provider-off"}><i />{provider.name.toUpperCase()} <small>{provider.ok ? "LIVE" : provider.configured ? "WAIT" : "OFF"}</small></span>)}</div>
        {(status?.lastError || error) && <p className="autonomy-warning">{status?.lastError ?? error}</p>}
      </section>

      <section id="chat" className="log-panel page-panel group-chat-panel">
        <div className="wide-panel-head group-chat-head">
          <div><h2>◯ Council Group Chat</h2><p>Messages arrive one at a time in the exact order the War Room said them</p></div>
          <div className="group-chat-head-actions">
            <span className="group-chat-order">OLDEST ↑ NEWEST</span>
            {chatLive
              ? <span className="live-chip"><i /> LIVE</span>
              : <button className="chat-paused-chip" onClick={resumeLiveChat}><i /> PAUSED{chatQueue.length ? ` · ${chatQueue.length} NEW` : ""}</button>}
          </div>
        </div>
        <div className="group-chat-feed" ref={chatFeedRef} onScroll={handleChatScroll} aria-live={chatLive ? "polite" : "off"}>
          {renderedChat.length ? renderedChat.map((row, index) => {
            const tone = chatTone(row.bot, row.kind);
            const previous = renderedChat[index - 1];
            const grouped = Boolean(previous && previous.bot === row.bot && previous.kind === row.kind);
            return (
              <div className={`group-message tone-${tone} ${grouped ? "grouped" : ""}`} key={row.id}>
                {!grouped ? <div className="group-avatar" aria-hidden="true">{chatInitials(row.bot)}</div> : <div className="group-avatar-spacer" />}
                <div className="group-message-body">
                  {!grouped && <div className="group-message-meta"><b>{row.bot}</b><time dateTime={row.at} title={new Date(row.at).toLocaleString()}>{timeOnly(row.at)}</time></div>}
                  <div className="group-bubble"><p>{row.message}</p>{grouped && <time dateTime={row.at} title={new Date(row.at).toLocaleString()}>{timeOnly(row.at)}</time>}</div>
                </div>
              </div>
            );
          }) : <div className="group-chat-empty"><span>•••</span><p>The Council is booting. Messages will appear here in speaking order.</p></div>}
          {chatLive && displayedTurn && <div className={`group-message group-typing tone-${chatTone(liveSpeaker?.name ?? "Council", "council")}`}>
            <div className="group-avatar" aria-hidden="true">{chatInitials(liveSpeaker?.name ?? "Council")}</div>
            <div className="group-message-body">
              <div className="group-message-meta"><b>{liveSpeaker?.name ?? "Council"}</b><span>speaking now</span></div>
              <div className="group-bubble typing-bubble"><i /><i /><i /></div>
            </div>
          </div>}
        </div>
        <div className={`group-chat-footer ${chatLive ? "" : "paused"}`}>
          {chatLive
            ? <span><i /> Live auto-scroll · one message every {(CHAT_REVEAL_MS / 1000).toFixed(1)}s</span>
            : <span><i /> Live chat paused while you read earlier messages{chatQueue.length ? ` · ${chatQueue.length} waiting` : ""}</span>}
          <div className="chat-footer-actions">
            <small>Scroll up at any time to pause the live feed.</small>
            {!chatLive && <button onClick={resumeLiveChat}>Resume Live</button>}
          </div>
        </div>
      </section>

      <section id="wallet-live" className="wallet-live-panel page-panel">
        <div className="wide-panel-head wallet-live-head">
          <div><h2>⌁ Live Wallet & Positions</h2><p>Updates automatically as open coins move. Buys, trims and exits are reflected in wallet equity and position charts.</p></div>
          <span className={reconciliationPass ? "wallet-reconcile pass" : "wallet-reconcile fail"}>{reconciliationPass ? "RECONCILIATION PASS" : "RECONCILIATION ERROR"}</span>
        </div>

        <div className="wallet-audit-grid">
          <span><small>Cash</small><b>${(status?.paperWallet?.cashUsd ?? 0).toFixed(2)}</b></span>
          <span><small>Open Cost</small><b>${openPositionCost.toFixed(2)}</b></span>
          <span><small>Current Position Value</small><b>${openPositionValue.toFixed(2)}</b></span>
          <span><small>Unrealized P/L</small><b className={unrealizedPnl >= 0 ? "positive" : "negative"}>{unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}</b></span>
          <span><small>Realized P/L</small><b className={realizedPnl >= 0 ? "positive" : "negative"}>{realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}</b></span>
          <span><small>Equity</small><b>${(status?.paperWallet?.equityUsd ?? 0).toFixed(2)}</b></span>
        </div>

        <div className="wallet-equity-card">
          <div className="chart-title-row"><div><b>Portfolio Equity</b><small>{equityHistory.length ? `${equityHistory.length} live marks` : "Waiting for marks"}</small></div><strong className={(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${(status?.paperWallet?.totalPnlUsd ?? 0).toFixed(2)}</strong></div>
          <div className="live-chart-wrap">
            <svg className="equity-live-chart" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-label="Live portfolio equity chart">
              <line x1="0" y1={relativeY(status?.paperWallet?.startingCashUsd ?? 1000, [...equityHistory.map((point) => point.equity), status?.paperWallet?.startingCashUsd ?? 1000])} x2="1000" y2={relativeY(status?.paperWallet?.startingCashUsd ?? 1000, [...equityHistory.map((point) => point.equity), status?.paperWallet?.startingCashUsd ?? 1000])} className="equity-start-line" />
              <polyline points={svgPolyline(equityHistory.map((point) => point.equity))} className="equity-main-line" />
            </svg>
            {!equityHistory.length && <div className="chart-empty">Live wallet marks will draw here as Guardian updates positions.</div>}
          </div>
          <div className="chart-legend"><span><i className="legend-equity" />Equity</span><span><i className="legend-start" />Starting wallet</span><small>Refreshes from the same wallet + Guardian data powering the account totals above.</small></div>
        </div>

        <div className="position-live-grid">
          {openPositions.length ? openPositions.slice(0, 8).map((position) => {
            const history = positionHistory[position.id] ?? [];
            const marks = history.map((point) => point.price);
            const entry = position.entryPrice;
            const high = position.highWaterPrice ?? Math.max(entry, position.markPrice);
            const stop = entry * (1 - (position.exitStrategy?.stopLossPct ?? 0) / 100);
            const trail = high * (1 - (position.exitStrategy?.trailingStopPct ?? 0) / 100);
            const tp1 = entry * (1 + ((position.exitStrategy?.takeProfits?.[0]?.gainPct ?? 0) / 100));
            const scale = [...marks, entry, high, stop, trail, tp1].filter((value) => Number.isFinite(value) && value > 0);
            return <article className="position-live-card" key={position.id}>
              <div className="position-live-title"><div><b>${position.symbol}</b><small>{position.chain} · {position.winnerState ?? "building"}</small></div><strong className={position.pnlPct >= 0 ? "positive" : "negative"}>{position.pnlPct >= 0 ? "+" : ""}{position.pnlPct.toFixed(1)}%</strong></div>
              <div className="position-chart-wrap">
                <svg viewBox="0 0 500 150" preserveAspectRatio="none" aria-label={`Live chart for ${position.symbol}`}>
                  <line x1="0" y1={relativeY(entry, scale, 150, 12)} x2="500" y2={relativeY(entry, scale, 150, 12)} className="position-entry-line" />
                  <line x1="0" y1={relativeY(stop, scale, 150, 12)} x2="500" y2={relativeY(stop, scale, 150, 12)} className="position-stop-line" />
                  <line x1="0" y1={relativeY(tp1, scale, 150, 12)} x2="500" y2={relativeY(tp1, scale, 150, 12)} className="position-target-line" />
                  <polyline points={svgPolyline(marks, 500, 150, 12)} className={position.pnlPct >= 0 ? "position-price-line positive-line" : "position-price-line negative-line"} />
                </svg>
                {!history.length && <div className="chart-empty small">Waiting for next live mark…</div>}
              </div>
              <div className="position-metrics"><span><small>Entry</small><b>{price(entry)}</b></span><span><small>Now</small><b>{price(position.markPrice)}</b></span><span><small>High</small><b>{price(high)}</b></span><span><small>Stop</small><b>{price(stop)}</b></span></div>
              <div className="position-chart-legend"><span className="entry-key">Entry</span><span className="stop-key">Stop</span><span className="target-key">TP1</span><span>{ago(position.openedAt)}</span></div>
            </article>;
          }) : <div className="wallet-no-positions">No open positions. Live position charts will appear immediately after the next paper BUY.</div>}
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
