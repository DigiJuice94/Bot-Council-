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
type MainGraphRange = "1m" | "5m" | "15m" | "1h" | "all";

function rangeMs(range: MainGraphRange) {
  if (range === "1m") return 60_000;
  if (range === "5m") return 5 * 60_000;
  if (range === "15m") return 15 * 60_000;
  if (range === "1h") return 60 * 60_000;
  return Number.POSITIVE_INFINITY;
}

function filterHistoryByRange<T extends { at: number }>(rows: T[], range: MainGraphRange) {
  const ms = rangeMs(range);
  if (!Number.isFinite(ms)) return rows;
  const cutoff = Date.now() - ms;
  return rows.filter((row) => row.at >= cutoff);
}

function graphBounds(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!finite.length) return { min: 0, max: 1 };
  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  const rawSpan = Math.max(1e-12, rawMax - rawMin);
  // Zoom out slightly so the live line has breathing room above and below.
  const fallbackSpan = Math.max(Math.abs(rawMax) * 0.02, 1e-8);
  const span = Math.max(rawSpan, fallbackSpan);
  const extra = span * 0.18;
  return { min: rawMin - extra, max: rawMax + extra };
}

function graphLabels(values: number[], count = 6) {
  const { min, max } = graphBounds(values);
  const span = Math.max(1e-12, max - min);
  return Array.from({ length: count }, (_, i) => max - (span * i) / Math.max(1, count - 1));
}

function compactGraphValue(value: number, currency = false) {
  if (!Number.isFinite(value)) return "—";
  if (currency && Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  if (currency && Math.abs(value) >= 0.01) return `$${value.toFixed(4)}`;
  if (currency) return `$${value.toPrecision(3)}`;
  return value.toFixed(2);
}

function svgPolyline(values: number[], scaleValues: number[], width = 1000, height = 220, pad = 16) {
  if (!values.length) return "";
  const { min, max } = graphBounds(scaleValues);
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
  const { min, max } = graphBounds(values);
  const span = Math.max(0.00000001, max - min);
  return pad + (1 - (value - min) / span) * Math.max(1, height - pad * 2);
}

function timeAxisLabel(timestamp: number, range: MainGraphRange) {
  const date = new Date(timestamp);
  if (range === "all") return date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (range === "1h") return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: range === "1m" ? "2-digit" : undefined });
}

function graphTimeLabels(timestamps: number[], range: MainGraphRange, count = 5) {
  if (!timestamps.length) return [];
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  if (timestamps.length === 1 || first === last) return [{ pct: 100, label: timeAxisLabel(last, range) }];
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / Math.max(1, count - 1);
    const target = first + (last - first) * ratio;
    return { pct: ratio * 100, label: timeAxisLabel(target, range) };
  });
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
  const [mainGraphSelection, setMainGraphSelection] = useState<string>("portfolio");
  const [mainGraphRange, setMainGraphRange] = useState<MainGraphRange>("15m");
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
      return next.slice(-2880);
    });
    setPositionHistory((current) => {
      const next = { ...current };
      for (const position of openPositions) {
        const rows = next[position.id] ?? [];
        next[position.id] = [...rows, { at: now, price: position.markPrice }].slice(-2880);
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

  useEffect(() => {
    if (mainGraphSelection === "portfolio") return;
    if (!openPositions.some((position) => position.id === mainGraphSelection)) setMainGraphSelection("portfolio");
  }, [mainGraphSelection, openPositions]);

  const selectedGraphPosition = mainGraphSelection === "portfolio" ? undefined : openPositions.find((position) => position.id === mainGraphSelection);
  const portfolioGraphRows: EquityHistoryPoint[] = filterHistoryByRange<EquityHistoryPoint>(equityHistory, mainGraphRange);
  const positionGraphRows: PositionHistoryPoint[] = selectedGraphPosition ? filterHistoryByRange<PositionHistoryPoint>(positionHistory[selectedGraphPosition.id] ?? [], mainGraphRange) : [];
  const mainGraphCurrent = selectedGraphPosition ? selectedGraphPosition.markPrice : (status?.paperWallet?.equityUsd ?? 0);
  const rawGraphValues = selectedGraphPosition ? positionGraphRows.map((point) => point.price) : portfolioGraphRows.map((point) => point.equity);
  const rawGraphTimes = selectedGraphPosition ? positionGraphRows.map((point) => point.at) : portfolioGraphRows.map((point) => point.at);
  // The last plotted point must always equal the current live value shown in the badge.
  const mainGraphValues = mainGraphCurrent > 0
    ? [...rawGraphValues.slice(0, -1), mainGraphCurrent]
    : rawGraphValues;
  const graphNow = Date.now();
  const mainGraphTimes = mainGraphValues.length
    ? [...rawGraphTimes.slice(0, Math.max(0, mainGraphValues.length - 1)), graphNow].slice(-mainGraphValues.length)
    : [];
  const mainGraphEntry = selectedGraphPosition ? selectedGraphPosition.entryPrice : (status?.paperWallet?.startingCashUsd ?? 1000);
  const mainGraphStop = selectedGraphPosition ? selectedGraphPosition.entryPrice * (1 - (selectedGraphPosition.exitStrategy?.stopLossPct ?? 0) / 100) : undefined;
  const mainGraphTp1 = selectedGraphPosition ? selectedGraphPosition.entryPrice * (1 + ((selectedGraphPosition.exitStrategy?.takeProfits?.[0]?.gainPct ?? 0) / 100)) : undefined;
  const mainGraphHigh = selectedGraphPosition ? selectedGraphPosition.highWaterPrice : undefined;
  const mainGraphScale = [...mainGraphValues, mainGraphCurrent, mainGraphEntry, ...(mainGraphStop ? [mainGraphStop] : []), ...(mainGraphTp1 ? [mainGraphTp1] : []), ...(mainGraphHigh ? [mainGraphHigh] : [])].filter((value) => Number.isFinite(value) && value > 0);
  const mainGraphYAxis = graphLabels(mainGraphScale, 6);
  const mainGraphXAxis = graphTimeLabels(mainGraphTimes, mainGraphRange, 5);
  const mainGraphPnlPct = selectedGraphPosition?.pnlPct ?? (status?.paperWallet?.totalReturnPct ?? 0);
  const mainGraphPositive = mainGraphPnlPct >= 0;
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
          <div className="stage-brand"><span className="brand-orbit" /><strong>Bot War Room V2.20</strong></div>
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

        <div className="main-market-card">
          <div className="main-market-toolbar">
            <div className="market-selector-row">
              <button className={mainGraphSelection === "portfolio" ? "market-selector active" : "market-selector"} onClick={() => setMainGraphSelection("portfolio")}>WALLET</button>
              {openPositions.slice(0, 8).map((position) => <button key={position.id} className={mainGraphSelection === position.id ? "market-selector active" : "market-selector"} onClick={() => setMainGraphSelection(position.id)}>${position.symbol}</button>)}
            </div>
            <div className="market-range-row">
              {(["1m","5m","15m","1h","all"] as MainGraphRange[]).map((range) => <button key={range} className={mainGraphRange === range ? "active" : ""} onClick={() => setMainGraphRange(range)}>{range === "all" ? "ALL" : range.toUpperCase()}</button>)}
            </div>
          </div>

          <div className="market-headline">
            <div>
              <small>{selectedGraphPosition ? `${selectedGraphPosition.chain} · ${selectedGraphPosition.winnerState ?? "building"}` : "PAPER WALLET · LIVE EQUITY"}</small>
              <h3>{selectedGraphPosition ? `$${selectedGraphPosition.symbol}` : "Portfolio Equity"}</h3>
            </div>
            <div className="market-headline-stats">
              <span><small>{selectedGraphPosition ? "PRICE" : "EQUITY"}</small><b>{compactGraphValue(mainGraphCurrent, true)}</b></span>
              <span><small>P/L</small><b className={mainGraphPositive ? "positive" : "negative"}>{mainGraphPnlPct >= 0 ? "+" : ""}{mainGraphPnlPct.toFixed(2)}%</b></span>
              <span><small>{selectedGraphPosition ? "ENTRY" : "START"}</small><b>{compactGraphValue(mainGraphEntry, true)}</b></span>
              <span><small>{selectedGraphPosition ? "HIGH" : "CASH"}</small><b>{compactGraphValue(selectedGraphPosition ? (mainGraphHigh ?? mainGraphCurrent) : (status?.paperWallet?.cashUsd ?? 0), true)}</b></span>
            </div>
          </div>

          <div className="fomo-live-chart">
            <div className="chart-grid-lines" aria-hidden="true">{Array.from({length:6}).map((_,i)=><i key={`h-${i}`} className={`grid-h grid-h-${i}`} />)}{Array.from({length:10}).map((_,i)=><i key={`v-${i}`} className={`grid-v grid-v-${i}`} />)}</div>
            <svg viewBox="0 0 1000 420" preserveAspectRatio="none" aria-label={selectedGraphPosition ? `Live price chart for ${selectedGraphPosition.symbol}` : "Live portfolio equity chart"}>
              {mainGraphEntry > 0 && <line x1="0" y1={relativeY(mainGraphEntry, mainGraphScale, 420, 26)} x2="1000" y2={relativeY(mainGraphEntry, mainGraphScale, 420, 26)} className="market-entry-line" />}
              {mainGraphStop && <line x1="0" y1={relativeY(mainGraphStop, mainGraphScale, 420, 26)} x2="1000" y2={relativeY(mainGraphStop, mainGraphScale, 420, 26)} className="market-stop-line" />}
              {mainGraphTp1 && <line x1="0" y1={relativeY(mainGraphTp1, mainGraphScale, 420, 26)} x2="1000" y2={relativeY(mainGraphTp1, mainGraphScale, 420, 26)} className="market-target-line" />}
              <polyline points={svgPolyline(mainGraphValues, mainGraphScale, 1000, 420, 26)} className="market-main-line" />
            </svg>
            <div className="market-y-axis">{mainGraphYAxis.map((value, index) => <span key={`${value}-${index}`} style={{top:`${(index/(Math.max(1,mainGraphYAxis.length-1)))*100}%`}}>{compactGraphValue(value,true)}</span>)}</div>
            <div className="market-x-axis">{mainGraphXAxis.map((tick, index) => <span key={`${tick.label}-${index}`} style={{left:`${tick.pct}%`}}>{tick.label}</span>)}</div>
            {mainGraphCurrent > 0 && <span className="market-current-badge" style={{top:`${Math.max(3, Math.min(94, relativeY(mainGraphCurrent, mainGraphScale, 420, 26)/420*100))}%`}}>{compactGraphValue(mainGraphCurrent,true)}</span>}
            {!mainGraphValues.length && <div className="market-chart-empty">Waiting for live Guardian marks…</div>}
          </div>

          <div className="market-footer">
            <div className="market-legend">
              <span><i className="legend-live" />LIVE</span>
              <span><i className="legend-entry" />{selectedGraphPosition ? "Entry" : "Starting wallet"}</span>
              {selectedGraphPosition && <><span><i className="legend-stop" />Stop</span><span><i className="legend-target" />TP1</span></>}
            </div>
            <small>{selectedGraphPosition ? `Guardian updates ${selectedGraphPosition.symbol} from live marks. Switch tokens above without creating extra charts.` : "One main chart tracks total wallet equity. Select any open token above to inspect its live price path."}</small>
          </div>
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
