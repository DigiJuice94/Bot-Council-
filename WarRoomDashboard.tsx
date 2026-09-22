"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentOpinion, ManagedPosition, PaperWalletFillRecord, PaperWalletSnapshot, ProviderHealth, WarRoomResult } from "@/lib/types";
import { buildCouncilDiscussion, type CouncilTurn } from "@/lib/debate";

type AutopilotPayload = {
  running: boolean;
  mode: "paper";
  dataMode: "adapter" | "birdeye" | "dexscreener";
  intervalMs: number;
  scanWorkers?: number;
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
  positions: ManagedPosition[];
  lastError?: string;
  generatedAt: string;
};

type DetailedTradeRow = PaperWalletFillRecord & {
  action: "ENTRY" | "SCALE_IN" | "TRIM" | "EXIT";
  quantity: number;
  entryPrice?: number;
  entryQuantity?: number;
  imageUrl?: string;
  status?: ManagedPosition["status"];
  realizedPnlAfterUsd?: number;
};

const fallbackBots: AgentOpinion[] = [
  { id: "launch", name: "Early Runner Scout", shortName: "LS", score: 0, stance: "neutral", summary: "Waiting for a real listing.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "social", name: "Narrative Ignition Scout", shortName: "SS", score: 0, stance: "neutral", summary: "Waiting for real evidence.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "wallet", name: "Early Flow Analyst", shortName: "WT", score: 0, stance: "neutral", summary: "Waiting for real holder data.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "quant", name: "Runner Pattern Quant", shortName: "QB", score: 0, stance: "neutral", summary: "Waiting for real market data.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "contract", name: "Fast Safety Gate", shortName: "CB", score: 0, stance: "neutral", summary: "Waiting for security evidence.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "bear", name: "Dumper Pattern Specialist", shortName: "BB", score: 0, stance: "neutral", summary: "Waiting to red-team a real candidate.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "portfolio", name: "Portfolio Strategist", shortName: "PS", score: 0, stance: "neutral", summary: "Waiting to size a real opportunity.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
  { id: "cio", name: "Runner CIO", shortName: "CIO", score: 0, stance: "neutral", summary: "Waiting for seven locked private reads.", detail: "No candidate loaded yet.", evidence: [], color: "#111111" },
];

const botDescriptions: Record<string, { label: string; text: string; tag: string; icon: string }> = {
  cio: { label: "Runner CIO", text: "Synthesizes Runner Genome evidence, specialist debate and missed-runner lessons to call the shot.", tag: "LEAD", icon: "♛" },
  launch: { label: "Early Runner Scout", text: "Hunts the $10K-$50K launch window and compares each setup with previous runners.", tag: "DISCOVERY", icon: "↗" },
  social: { label: "Narrative Ignition Scout", text: "Looks for attention accelerating before price rather than chasing social signals after the move.", tag: "IGNITION", icon: "●" },
  wallet: { label: "Early Flow Analyst", text: "Studies first-minute buyers, holder velocity, accumulation and distribution behavior.", tag: "FLOW", icon: "▣" },
  quant: { label: "Runner Pattern Quant", text: "Models MC velocity, volume acceleration, buy pressure and runner-pattern similarity.", tag: "GENOME", icon: "▥" },
  contract: { label: "Fast Safety Gate", text: "Looks for specific hard sellability/scam failures without punishing a coin merely for being early.", tag: "SAFETY", icon: "▤" },
  bear: { label: "Dumper Pattern Specialist", text: "Compares each setup with failed launches and identifies distribution patterns before the dump.", tag: "DUMPER", icon: "◆" },
  portfolio: { label: "Portfolio Strategist", text: "Forms its own private opinion on starter size, capital allocation and when stronger Runner Genome evidence deserves more than the $50 minimum.", tag: "SIZING", icon: "◫" },
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

function shortCa(address?: string) {
  if (!address) return "—";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function positionPnlUsd(position: ManagedPosition) {
  if (position.status === "closed" || position.status === "unsellable") return position.realizedPnlUsd ?? 0;
  const openValue = Math.max(0, position.remainingQuantity ?? 0) * Math.max(0, position.markPrice ?? 0);
  return (position.realizedProceedsUsd ?? 0) + openValue - (position.entryNotionalUsd ?? 0);
}

function tokenAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 1 ? 8 : 4 }).format(value);
}

function TokenAvatar({ imageUrl, symbol, compact = false }: { imageUrl?: string; symbol: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initial = symbol.replace(/^\$/, "").slice(0, 1).toUpperCase() || "?";
  return <span className={`token-avatar ${compact ? "compact" : ""}`}>
    {imageUrl && !failed
      ? <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <b>{initial}</b>}
  </span>;
}

const AUTOPILOT_STATUS_EVENT = "bot-war-room:status";

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

type PortfolioTradeMarker = {
  id: string;
  at: number;
  label: string;
  symbol: string;
  side: "BUY" | "SELL";
  fillPrice: number;
  filledUsd: number;
  xPct: number;
  yPct: number;
  tooltip: string;
};

function markerLabel(side: "BUY" | "SELL", decisionId: string) {
  const upper = decisionId.toUpperCase();
  const add = upper.match(/-(ADD\d+)$/);
  if (add) return add[1];
  const tp = upper.match(/-(TP\d+)$/);
  if (tp) return tp[1];
  if (upper.endsWith("-EXIT")) return "EXIT";
  if (upper.includes("STOP")) return "STOP";
  return side === "BUY" ? "BUY" : "SELL";
}

function nearestSeriesValue(at: number, times: number[], values: number[], fallback: number) {
  if (!times.length || !values.length) return fallback;
  let best = 0;
  let bestDistance = Math.abs(times[0] - at);
  for (let index = 1; index < times.length; index += 1) {
    const distance = Math.abs(times[index] - at);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return values[Math.min(best, values.length - 1)] ?? fallback;
}

function timePct(at: number, times: number[]) {
  if (!times.length) return 100;
  const first = times[0];
  const last = times[times.length - 1];
  if (last <= first) return 100;
  return Math.max(0, Math.min(100, ((at - first) / (last - first)) * 100));
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
        <div className="asset-heading"><TokenAvatar imageUrl={result.snapshot.imageUrl} symbol={symbol} /><div><h2>${symbol}</h2><p>{chain} · {source}</p></div></div>
        <div className={`decision-badge badge-${decision.toLowerCase()}`}>{decision}<small>{replaying ? "Council reasoning replay" : "Current Decision"}</small></div>
      </div>
      <div className="decision-stats">
        <div><strong>{price(currentPrice)}</strong><span>Current Price</span></div>
        <div><strong>{conviction}%</strong><span>Conviction</span></div>
        <div><strong className={`risk-${risk.toLowerCase()}`}>{risk}</strong><span>Risk Level</span></div>
        <div className="spark-wrap" aria-hidden="true"><svg viewBox="0 0 120 42" preserveAspectRatio="none"><polyline points={spark} /></svg></div>
      </div>
      <p className="decision-thesis">{thesis}</p>
      {result.independentCouncil && <div className={`entity-proof ${result.independentCouncil.mode === "isolated-local-fallback" ? "degraded" : "verified"}`}>
        <b>{result.independentCouncil.mode === "independent-local" ? "8 INDEPENDENT LOCAL ENTITIES · $0 API" : result.independentCouncil.mode === "independent-ai" ? "8 INDEPENDENT ENTITIES" : "ISOLATED LOCAL FALLBACK"}</b>
        <span>7 private reads → peer reveal/meeting → separate Runner CIO</span>
        <small>{result.independentCouncil.agentModel} · CIO {result.independentCouncil.cioModel}</small>
      </div>}
      <div className="decision-context-mini">
        <span><b>{result.councilProcess.lane === "early-runner" ? "EARLY RUNNER" : result.councilProcess.lane === "meme" ? result.memeRegime.label : result.regime.label}</b><small>{result.councilProcess.lane === "early-runner" ? `$${Math.round(result.snapshot.marketCap).toLocaleString()} MC` : result.councilProcess.lane === "meme" ? "Meme lane" : "Regime"}</small></span>
        <span><b>{result.councilProcess.alignedBots}/8</b><small>Bot alignment</small></span>
        <span><b>{`${result.runnerGenome.entryScore.toFixed(0)}/100`}</b><small>Runner Genome</small></span>
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
    { agentId: "portfolio", round: "rebuttal" }, { agentId: "cio", round: "decision" },
  ];
  return order.flatMap(({ agentId, round }) => {
    const exact = full.find((turn) => turn.agentId === agentId && (!round || turn.round === round));
    const fallback = full.find((turn) => turn.agentId === agentId);
    return exact ? [exact] : fallback ? [fallback] : [];
  });
}

export default function WarRoomDashboard() {
  const [status, setStatus] = useState<AutopilotPayload | null>(null);
  const [livePositions, setLivePositions] = useState<ManagedPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<WarRoomResult | null>(null);
  const [activeTurn, setActiveTurn] = useState(-1);
  const [scanBubble, setScanBubble] = useState<{ agentId: AgentOpinion["id"]; message: string; round: CouncilTurn["round"] } | null>(null);
  const [equityHistory, setEquityHistory] = useState<EquityHistoryPoint[]>([]);
  const [positionHistory, setPositionHistory] = useState<Record<string, PositionHistoryPoint[]>>({});
  const [mainGraphSelection, setMainGraphSelection] = useState<string>("portfolio");
  const [mainGraphRange, setMainGraphRange] = useState<MainGraphRange>("15m");
  const [copiedCa, setCopiedCa] = useState<string | null>(null);
  const [resettingPaperWallet, setResettingPaperWallet] = useState(false);
  const [paperResetMessage, setPaperResetMessage] = useState<string | null>(null);
  const [detailedTradeRows, setDetailedTradeRows] = useState<DetailedTradeRow[]>([]);
  const [detailedTradeTotal, setDetailedTradeTotal] = useState(0);
  const [detailedTradeLogActive, setDetailedTradeLogActive] = useState(false);
  const paperResetInFlightRef = useRef(false);
  const livePositionPollInFlightRef = useRef(false);
  const autopilotPollInFlightRef = useRef(false);
  const paperResetGenerationRef = useRef(0);
  const pendingReplayRef = useRef<WarRoomResult | null>(null);
  const lastObservedDecisionRef = useRef<string | null>(null);
  const lastScanCountRef = useRef(0);
  const result = status?.latestResult ?? null;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (paperResetInFlightRef.current || autopilotPollInFlightRef.current) return;
      autopilotPollInFlightRef.current = true;
      const generation = paperResetGenerationRef.current;
      try {
        const response = await fetch("/api/autopilot", { cache: "no-store" });
        if (!response.ok) throw new Error(`Autopilot status ${response.status}`);
        const payload = await response.json() as AutopilotPayload;
        if (!alive || generation !== paperResetGenerationRef.current || paperResetInFlightRef.current) return;
        setStatus(payload);
        window.dispatchEvent(new CustomEvent(AUTOPILOT_STATUS_EVENT, { detail: payload }));
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        autopilotPollInFlightRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  // The detailed ledger is lazy-loaded only after its top tab is opened so it
  // cannot slow the initial War Room boot.
  useEffect(() => {
    if (!detailedTradeLogActive) return;
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/trade-log?limit=1000", { cache: "no-store" });
        if (!response.ok || !alive) return;
        const payload = await response.json() as { rows?: DetailedTradeRow[]; totalStored?: number };
        setDetailedTradeRows(payload.rows ?? []);
        setDetailedTradeTotal(payload.totalStored ?? payload.rows?.length ?? 0);
      } catch {
        // Keep the last verified ledger visible during a temporary refresh miss.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [detailedTradeLogActive]);

  // Keep the Trades Log responsive even while the heavier autopilot payload
  // is rebuilding research statistics.
  useEffect(() => {
    let alive = true;
    const pollPositions = async () => {
      if (paperResetInFlightRef.current || livePositionPollInFlightRef.current) return;
      livePositionPollInFlightRef.current = true;
      try {
        const response = await fetch("/api/positions?light=1", { cache: "no-store" });
        if (!response.ok || !alive || paperResetInFlightRef.current) return;
        const payload = await response.json() as { positions?: ManagedPosition[] };
        if (!payload.positions) return;
        setLivePositions(payload.positions);
      } catch {
        // The main autopilot poll remains responsible for visible errors.
      } finally {
        livePositionPollInFlightRef.current = false;
      }
    };
    void pollPositions();
    const timer = window.setInterval(() => void pollPositions(), 2000);
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
    const openValue = status.paperWallet.openExposureUsd;
    setEquityHistory((current) => {
      const persisted = status.paperWallet.equityHistory ?? [];
      const live = { at: now, equity: status.paperWallet.equityUsd, cash: status.paperWallet.cashUsd, openValue };
      const merged = [...persisted, ...current, live];
      const byTimestamp = new Map<number, EquityHistoryPoint>();
      for (const point of merged) byTimestamp.set(point.at, point);
      return [...byTimestamp.values()].sort((a, b) => a.at - b.at).slice(-100_000);
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
  // Redis hash reads are intentionally unordered. Keep the trade log stable
  // and newest-first after each lightweight live refresh.
  const positions = [...(livePositions ?? status?.positions ?? [])].sort((a, b) =>
    (b.openedAt ?? b.updatedAt ?? "").localeCompare(a.openedAt ?? a.updatedAt ?? "")
  );
  const openPositions = positions.filter((position) => position.status === "open" || position.status === "exit_pending");
  const unsellablePositions = positions.filter((position) => position.status === "unsellable");
  const activePositions = openPositions;
  // The server snapshot includes every open PAPER position; the UI list is display-capped.
  const openPositionValue = status?.paperWallet?.openExposureUsd ?? 0;
  const openPositionCost = status?.paperWallet?.openCostUsd ?? 0;
  const unrealizedPnl = status?.paperWallet?.unrealizedPnlUsd ?? (openPositionValue - openPositionCost);
  const realizedPnl = status?.paperWallet?.realizedPnlUsd ?? 0;
  const reconciledEquity = (status?.paperWallet?.cashUsd ?? 0) + openPositionValue;
  const reconciliationDelta = status?.paperWallet ? status.paperWallet.equityUsd - reconciledEquity : 0;
  const costValueDelta = openPositionCost + unrealizedPnl - openPositionValue;
  const contributionUsd = status?.paperWallet?.capitalContributionsUsd ?? 0;
  const pnlEquityDelta = status?.paperWallet
    ? status.paperWallet.startingCashUsd + contributionUsd + realizedPnl + unrealizedPnl - status.paperWallet.equityUsd
    : 0;
  const reconciliationPass = Boolean(status?.paperWallet?.accountingVerified)
    && Math.abs(reconciliationDelta) <= 0.01
    && Math.abs(costValueDelta) <= 0.01
    && Math.abs(pnlEquityDelta) <= 0.01;

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
  const mainGraphHigh = selectedGraphPosition ? selectedGraphPosition.highWaterPrice : (status?.paperWallet?.allTimeHighEquityUsd ?? (equityHistory.length ? Math.max(...equityHistory.map((point) => point.equity)) : undefined));
  const mainGraphScale = [...mainGraphValues, mainGraphCurrent, mainGraphEntry, ...(mainGraphStop ? [mainGraphStop] : []), ...(mainGraphTp1 ? [mainGraphTp1] : []), ...(mainGraphHigh ? [mainGraphHigh] : [])].filter((value) => Number.isFinite(value) && value > 0);
  const mainGraphYAxis = graphLabels(mainGraphScale, 6);
  const mainGraphXAxis = graphTimeLabels(mainGraphTimes, mainGraphRange, 5);
  const mainGraphPnlPct = selectedGraphPosition?.pnlPct ?? (status?.paperWallet?.totalReturnPct ?? 0);
  const mainGraphPositive = mainGraphPnlPct >= 0;
  const allTimePortfolioHigh = status?.paperWallet?.allTimeHighEquityUsd ?? (equityHistory.length ? Math.max(...equityHistory.map((point) => point.equity)) : (status?.paperWallet?.equityUsd ?? 0));
  const allTimePortfolioDrawdownPct = allTimePortfolioHigh > 0 ? ((allTimePortfolioHigh - (status?.paperWallet?.equityUsd ?? 0)) / allTimePortfolioHigh * 100) : 0;

  const recentFills = status?.paperWallet?.recentFills ?? [];

  const allocationTotal = Math.max(0.01, (status?.paperWallet?.cashUsd ?? 0) + openPositionValue);
  const allocationPalette = ["#f4f4f4","#d7d7d7","#bbbbbb","#9f9f9f","#838383","#686868","#505050","#393939","#232323"];
  const visibleAllocationValue = openPositions.reduce((sum, position) => sum + Math.max(0, (position.remainingQuantity ?? 0) * (position.markPrice ?? 0)), 0);
  const hiddenAllocationValue = Math.max(0, openPositionValue - visibleAllocationValue);
  const allocationRaw = [
    { id: "cash", label: "Cash", imageUrl: undefined as string | undefined, symbol: "$", value: Math.max(0, status?.paperWallet?.cashUsd ?? 0) },
    ...openPositions
      .map((position) => ({
        id: position.id,
        label: `$${position.symbol}`,
        imageUrl: position.imageUrl,
        symbol: position.symbol,
        value: Math.max(0, (position.remainingQuantity ?? 0) * (position.markPrice ?? 0)),
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value),
    ...(hiddenAllocationValue > 0.005 ? [{ id: "other-paper", label: "Other PAPER positions", imageUrl: undefined as string | undefined, symbol: "…", value: hiddenAllocationValue }] : []),
  ];
  let allocationCursor = 0;
  const allocationSlices = allocationRaw.map((row, index) => {
    const pct = row.value / allocationTotal * 100;
    const start = allocationCursor;
    const end = allocationCursor + pct;
    allocationCursor = end;
    return { ...row, pct, start, end, color: allocationPalette[index % allocationPalette.length] };
  });
  const allocationGradient = allocationSlices.length
    ? `conic-gradient(${allocationSlices.map((slice) => `${slice.color} ${slice.start.toFixed(2)}% ${slice.end.toFixed(2)}%`).join(",")})`
    : "#222";

  const roster = ["cio", "launch", "social", "wallet", "quant", "contract", "bear", "portfolio"];

  const resetPaperWallet = async () => {
    if (paperResetInFlightRef.current) return;
    const confirmed = window.confirm(
      "Start a fresh PAPER run at the configured balance (default $1,000) and clear the PAPER trade log, positions and portfolio history?\n\nRunner Genome, Filing Cabinet, Trajectory Observer research and agent memories will NOT be erased."
    );
    if (!confirmed || resettingPaperWallet) return;

    setResettingPaperWallet(true);
    paperResetInFlightRef.current = true;
    paperResetGenerationRef.current += 1;
    setPaperResetMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/paper-reset", { method: "POST", signal: controller.signal, cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string; clearedOpenPositions?: number; wallet?: PaperWalletSnapshot };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Reset failed (${response.status})`);
      if (!payload.wallet) throw new Error("Reset response did not include the wallet. Refresh to check its state.");
      const wallet = payload.wallet;
      // The reset response is authoritative. Do not wait for the research-heavy
      // autopilot endpoint before showing the new bankroll or releasing the button.
      setStatus((current) => current ? {
        ...current,
        paperWallet: wallet,
        positions: current.positions.filter((position) => position.mode !== "paper" || position.status === "closed"),
        generatedAt: wallet.updatedAt,
      } : current);
      setMainGraphSelection("portfolio");
      setDetailedTradeRows([]);
      setDetailedTradeTotal(0);
      setPaperResetMessage(payload.message ?? "Paper wallet reset. Learning preserved.");
      window.setTimeout(() => setPaperResetMessage(null), 6000);
    } catch (err) {
      setPaperResetMessage(controller.signal.aborted
        ? "Reset response timed out. It may have completed; refresh to check the wallet before retrying."
        : err instanceof Error ? err.message : String(err));
    } finally {
      window.clearTimeout(timeout);
      paperResetInFlightRef.current = false;
      setResettingPaperWallet(false);
    }
  };

  const copyContract = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const node = document.createElement("textarea");
      node.value = address;
      node.style.position = "fixed";
      node.style.opacity = "0";
      document.body.appendChild(node);
      node.select();
      document.execCommand("copy");
      node.remove();
    }
    setCopiedCa(address);
    window.setTimeout(() => setCopiedCa((current) => current === address ? null : current), 1400);
  };

  const openDetailedTradeLog = () => {
    setDetailedTradeLogActive(true);
    window.setTimeout(() => document.getElementById("detailed-trade-log")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="light-app">
      <nav className="war-room-top-tabs" aria-label="War Room sections">
        <button type="button" onClick={() => scrollToSection("live")}>WAR ROOM</button>
        <button type="button" onClick={() => scrollToSection("wallet-live")}>PORTFOLIO</button>
        <button type="button" onClick={() => scrollToSection("active-trades")}>ACTIVE TRADES</button>
        <button type="button" onClick={() => scrollToSection("unsellable-capital")}>UNSELLABLE</button>
        <button type="button" className={detailedTradeLogActive ? "active" : ""} onClick={openDetailedTradeLog}>DETAILED TRADE LOG</button>
        <button type="button" onClick={() => scrollToSection("diagnostics")}>WHY TRADES STOP</button>
        <button type="button" className="file-cabinets-tab" onClick={() => { window.location.href = "/cabinets"; }}>FILE CABINETS</button>
      </nav>
      <section id="live" className="council-stage">
        <div className="stage-brand-row" aria-label="Bot War Room autonomous status">
          <div className="stage-brand"><span className="brand-orbit" /><strong>Bot War Room V3</strong><small>FAST · FULL EXITS</small></div>
          <span className="autonomous-pill"><i /> AUTONOMOUS</span>
        </div>
        <div className="decision-card-slot"><DecisionCard result={result} replaying={talking} dataMode={status?.dataMode} currentChain={status?.currentChain} /></div>
        <div className="table-scene" aria-label="Eight-bot council meeting room">
          <img className="council-reference-art" src="/bot-council-reference.png" alt="Eight Bot War Room agents seated around the council table" draggable={false} fetchPriority="high" />
          {visibleBots.map((bot, index) => <CouncilBot key={bot.id} bot={bot} index={index} active={Boolean(displayedTurn && bot.id === displayedTurn.agentId)} speech={bot.id === displayedTurn?.agentId ? displayedTurn.message : undefined} context={bot.id === displayedTurn?.agentId ? (replayResult && currentTurn ? `$${replayResult.snapshot.symbol} · ${currentTurn.round}` : `${status?.currentChain ?? "Live"} · real scan`) : undefined} />)}
        </div>
        <div className="live-caption"><span className={`status-dot ${displayedTurn ? "talking" : ""}`} /><b>{displayedTurn ? `${roomBots.find((b) => b.id === displayedTurn.agentId)?.name ?? "Council"} speaking` : "Autonomous Council live"}</b><span>{displayedTurn ? displayedTurn.message : status ? `REAL DATA · ${status.dataMode === "birdeye" ? "Birdeye New Listings" : status.dataMode === "adapter" ? "adapter" : "DEX Screener"} · scanning ${status.currentChain} · ${status.candidateCount} real candidates · ${status.buyCount} paper buys` : "Starting real-data paper scanner"}</span></div>
      </section>

      <section className="autonomy-band">
        <div><span className="green-live"><i /> LIVE</span><strong>Main File Cabinet Strategy</strong><p>The locked main strategy controls the paper wallet with its established memory, 54-point BUY line, 0.97 sizing, $25–$125 entries and 12-position limit. Only BUY decisions execute; WATCH and SKIP remain observational. Global safety, Guardian exits and reconciled accounting remain active.</p></div>
        <div className="paper-wallet-strip">
          <span><small>Starting wallet</small><b>${(status?.paperWallet?.startingCashUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Equity</small><b>${(status?.paperWallet?.equityUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Cash</small><b>${(status?.paperWallet?.cashUsd ?? 1000).toFixed(2)}</b></span>
          <span><small>Total P/L</small><b className={(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{(status?.paperWallet?.totalPnlUsd ?? 0) >= 0 ? "+" : ""}${(status?.paperWallet?.totalPnlUsd ?? 0).toFixed(2)} ({(status?.paperWallet?.totalReturnPct ?? 0).toFixed(2)}%)</b></span>
          <span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span><span><small>All-time high</small><b>${(status?.paperWallet?.allTimeHighEquityUsd ?? status?.paperWallet?.equityUsd ?? 0).toFixed(2)}</b></span>
        
          <button className="paper-reset-button" onClick={() => void resetPaperWallet()} disabled={resettingPaperWallet}>
            {resettingPaperWallet ? "RESETTING…" : "RESET PAPER WALLET"}
          </button>
        </div>
        {paperResetMessage && <p className="paper-reset-message">{paperResetMessage}</p>}
        <div className="autonomy-stats"><span><b>{status?.scanningChains?.length ?? 7}</b><small>chains</small></span><span><b>{status ? `${Math.round(status.intervalMs / 1000)}s` : "2s"}</b><small>batch cadence</small></span><span><b>{status?.scanWorkers ?? 3}</b><small>parallel lanes</small></span><span><b>{status?.candidateCount ?? 0}</b><small>real candidates</small></span><span><b>{status?.buyCount ?? 0}</b><small>paper buys</small></span></div>
        <div className="sizing-policy-strip"><span><b>$50+ meaningful training</b><small>If Council approves a BUY or qualified probe, soft sizing warnings cannot shrink it below $50 · only real cash/exposure capacity can delay it</small></span><span className="sizing-live-note">Hard safety vetoes still block · exits/trims may stay smaller</span></div>
        <div className="chain-scan-grid">{(status?.scanningChains ?? ["Solana","Ethereum","Base","BNB Chain","Monad","HyperEVM","Robinhood Chain"]).map((chain) => { const stats = status?.chainStats?.[chain]; const active = status?.currentChain === chain; return <span key={chain} className={active ? "chain-scan active" : "chain-scan"}><i /><b>{chain}</b><small>{stats?.scans ?? 0} scans · {stats?.candidates ?? 0} candidates</small></span>; })}</div>
        <div className="provider-health-row">{(status?.providers ?? []).map((provider) => <span key={provider.name} className={provider.ok ? "provider-ok" : provider.configured ? "provider-warn" : "provider-off"}><i />{provider.name.toUpperCase()} <small>{provider.ok ? "LIVE" : provider.configured ? "WAIT" : "OFF"}</small></span>)}</div>
        {(status?.lastError || error) && <p className="autonomy-warning">{status?.lastError ?? error}</p>}
      </section>

      <section id="wallet-live" className="wallet-live-panel page-panel">
        <div className="wide-panel-head wallet-live-head">
          <div><h2>⌁ Live Wallet & Positions</h2><p>Updates automatically as open coins move. Buys, trims and exits are reflected in wallet equity and position charts.</p></div>
          {reconciliationPass && <span className="wallet-reconcile pass">ACCOUNTING VERIFIED</span>}
        </div>

        <div className="wallet-audit-grid">
          <span><small>Cash</small><b>${(status?.paperWallet?.cashUsd ?? 0).toFixed(2)}</b></span>
          <span><small>Open Cost</small><b>${openPositionCost.toFixed(2)}</b></span>
          <span><small>Current Position Value</small><b>${openPositionValue.toFixed(2)}</b></span>
          <span><small>Unrealized P/L</small><b className={unrealizedPnl >= 0 ? "positive" : "negative"}>{unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}</b></span>
          <span><small>Realized P/L</small><b className={realizedPnl >= 0 ? "positive" : "negative"}>{realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}</b></span>
          <span><small>Equity</small><b>${(status?.paperWallet?.equityUsd ?? 0).toFixed(2)}</b></span>
          <span><small>Locked Capital Loss</small><b className="negative">-${(status?.paperWallet?.lockedCapitalLossUsd ?? 0).toFixed(2)}</b></span>
          <span><small>Unsellable Trades</small><b>{status?.paperWallet?.unsellablePositions ?? 0}</b></span>
        </div>

        <div className="portfolio-market-layout">
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
              <span><small>{selectedGraphPosition ? "HIGH" : "ALL-TIME HIGH"}</small><b>{compactGraphValue(selectedGraphPosition ? (mainGraphHigh ?? mainGraphCurrent) : allTimePortfolioHigh, true)}</b></span>{!selectedGraphPosition && <span><small>FROM HIGH</small><b className={allTimePortfolioDrawdownPct <= 0.1 ? "positive" : "negative"}>-{allTimePortfolioDrawdownPct.toFixed(2)}%</b></span>}
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
            <small>{selectedGraphPosition ? `Guardian updates ${selectedGraphPosition.symbol} from live marks.` : "Portfolio equity from live wallet marks. Select any open token above to inspect its price path."}</small>
          </div>
        </div>

        <aside className="allocation-card" aria-label="Current portfolio allocation">
          <div className="allocation-head">
            <div><small>CURRENT HOLDINGS</small><h3>Portfolio Allocation</h3></div>
            <span>{openPositions.length} OPEN</span>
          </div>
          <div className="allocation-donut-wrap">
            <div className="allocation-donut" style={{background: allocationGradient}}>
              <div className="allocation-donut-hole">
                <small>EQUITY</small>
                <b>${allocationTotal.toFixed(2)}</b>
                <span>{((openPositionValue / allocationTotal) * 100).toFixed(1)}% invested</span>
              </div>
            </div>
          </div>
          <div className="allocation-legend">
            {allocationSlices.map((slice) => <div className="allocation-row" key={slice.id} title={`${slice.label}: $${slice.value.toFixed(2)} · ${slice.pct.toFixed(2)}%`}>
              {slice.id === "cash" ? <i style={{background:slice.color}} /> : <TokenAvatar imageUrl={slice.imageUrl} symbol={slice.symbol} compact />}
              <span><b>{slice.label}</b><small>${slice.value.toFixed(2)}</small></span>
              <strong>{slice.pct.toFixed(1)}%</strong>
            </div>)}
          </div>
          <div className="allocation-foot">
            <span>Cash + live marked positions</span>
            <b className="positive">{reconciliationPass ? "VERIFIED" : "VERIFYING"}</b>
          </div>
        </aside>
        </div>
      </section>

      <section id="active-trades" className="active-trades-panel page-panel">
        <div className="wide-panel-head"><div><h2>◉ Active Trades</h2><p>Main PAPER positions actively managed by the Exit Strategist · 20-minute maximum, with earlier exits when live buying pressure fades.</p></div><span className="quiet-chip">{activePositions.length} active</span></div>
        <div className="active-trades-grid">
          {activePositions.length ? activePositions.slice(0, 24).map((position) => {
            const pnlUsd = positionPnlUsd(position);
            return <article className="active-trade-card" key={position.id}>
              <div className="active-trade-top"><TokenAvatar imageUrl={position.imageUrl} symbol={position.symbol} compact /><b>${position.symbol}</b><em className={`status-${position.status}`}>{position.status === "exit_pending" ? "Exit Pending" : "Open"}</em></div>
              <div className="active-trade-values"><span><small>MARK</small><b>{price(position.markPrice)}</b></span><span><small>VALUE</small><b>${(Math.max(0, position.remainingQuantity ?? 0) * Math.max(0, position.markPrice ?? 0)).toFixed(2)}</b></span><span><small>P/L</small><b className={pnlUsd >= 0 ? "positive" : "negative"}>{pnlUsd >= 0 ? "+" : "-"}${Math.abs(pnlUsd).toFixed(2)}</b></span></div>
              <small className="active-trade-meta">{position.chain} · entry {price(position.entryPrice)} · {ago(position.openedAt)}</small>
              {position.status === "exit_pending" && <small className="active-trade-reason" title={position.lastReason}>{position.lastReason}</small>}
            </article>;
          }) : <div className="empty-row">No active PAPER trades. New Council-approved entries will appear here.</div>}
        </div>
        {activePositions.length > 24 && <small className="active-trades-more">Showing 24 of {activePositions.length} active trades. Portfolio totals include every holding.</small>}
      </section>

      <section id="unsellable-capital" className="unsellable-panel page-panel">
        <div className="wide-panel-head"><div><h2>⚠ Unsellable / Locked Capital</h2><p>Tokens the Guardian could not sell. No proceeds are credited; remaining cost is counted as a loss and retained for learning.</p></div><span className="unsellable-chip">{unsellablePositions.length} lost trade{unsellablePositions.length === 1 ? "" : "s"}</span></div>
        <div className="unsellable-grid">
          {unsellablePositions.length ? unsellablePositions.slice(0, 24).map((position) => {
            const lockedLoss = Math.max(0, position.lockedCapitalLossUsd ?? (position.entryNotionalUsd - position.realizedCostUsd));
            return <article className="unsellable-card" key={position.id}>
              <div className="unsellable-top"><TokenAvatar imageUrl={position.imageUrl} symbol={position.symbol} compact /><b>${position.symbol}</b><em>UNSELLABLE</em></div>
              <div className="unsellable-values">
                <span><small>LOCKED / LOST</small><b className="negative">-${lockedLoss.toFixed(2)}</b></span>
                <span><small>TOKENS STUCK</small><b>{tokenAmount(position.remainingQuantity ?? 0)}</b></span>
                <span><small>ORIGINAL ENTRY</small><b>{price(position.entryPrice)}</b></span>
                <span><small>REALIZED BEFORE LOCK</small><b>${Math.max(0, position.realizedProceedsUsd ?? 0).toFixed(2)}</b></span>
              </div>
              <p>{position.unsellableReason ?? position.lastReason}</p>
              <small className="active-trade-meta">{position.chain} · CA {shortCa(position.tokenAddress)} · {ago(position.unsellableAt ?? position.updatedAt)}</small>
            </article>;
          }) : <div className="empty-row">No unsellable PAPER trades in this run.</div>}
        </div>
        {unsellablePositions.length > 24 && <small className="active-trades-more">Showing 24 of {unsellablePositions.length} unsellable trades. Wallet totals include every locked-capital loss.</small>}
      </section>

      <section id="detailed-trade-log" className="detailed-log-panel page-panel">
        <div className="wide-panel-head">
          <div><h2>☷ Detailed Trade Ledger</h2><p>Exact entry, scale, trim and exit fills with verified post-trade portfolio accounting.</p></div>
          <span className="quiet-chip">{detailedTradeTotal} fills · {detailedTradeLogActive ? "LIVE" : "OPEN TAB TO LOAD"}</span>
        </div>
        {!detailedTradeLogActive ? (
          <button type="button" className="open-ledger-button" onClick={openDetailedTradeLog}>OPEN DETAILED TRADE LOG</button>
        ) : (
          <div className="detailed-log-scroll">
            <div className="detailed-log-table">
              <div className="detailed-log-row detailed-log-head">
                <span>Time / Action</span><span>Token / CA</span><span>Chain</span><span>USD Filled</span><span>Coins Bought / Sold</span><span>Entry Price</span><span>Fill Price</span><span>Coins Remaining</span><span>Next Profit Target</span><span>Realized P/L</span><span>Cash After</span><span>Portfolio After</span><span>Fee / Slippage</span>
              </div>
              {detailedTradeRows.length ? detailedTradeRows.map((fill) => {
                const isSell = fill.side === "SELL";
                const realized = fill.realizedPnlAfterUsd;
                return <div className="detailed-log-row" key={fill.id}>
                  <span className="detailed-time"><b className={`ledger-action action-${fill.action.toLowerCase()}`}>{fill.action}</b><small>{new Date(fill.createdAt).toLocaleString()}</small></span>
                  <div className="trade-token-cell"><TokenAvatar imageUrl={fill.imageUrl} symbol={fill.symbol} compact /><div className="trade-token-copy"><b>${fill.symbol}</b><span className="ca-line"><code title={fill.tokenAddress}>CA {shortCa(fill.tokenAddress)}</code><button type="button" onClick={() => void copyContract(fill.tokenAddress)}>{copiedCa === fill.tokenAddress ? "COPIED" : "COPY"}</button></span></div></div>
                  <span>{fill.chain}</span>
                  <strong>{isSell ? `+$${fill.filledUsd.toFixed(2)}` : `-$${fill.requestedUsd.toFixed(2)}`}</strong>
                  <span><b>{tokenAmount(fill.quantity ?? 0)}</b><small>{isSell ? "sold" : "received"}</small></span>
                  <span>{fill.entryPrice ? price(fill.entryPrice) : "—"}</span>
                  <span>{price(fill.fillPrice)}</span>
                  <span><b>{tokenAmount(fill.remainingQuantityAfter ?? 0)}</b><small>{isSell && (fill.remainingQuantityAfter ?? 0) > 0 ? "active remainder" : (fill.remainingQuantityAfter ?? 0) === 0 ? "fully closed" : "held"}</small></span>
                  <span>{fill.nextTargetPrice ? price(fill.nextTargetPrice) : "—"}</span>
                  <strong className={typeof realized === "number" ? realized >= 0 ? "positive" : "negative" : ""}>{typeof realized === "number" ? `${realized >= 0 ? "+" : "-"}$${Math.abs(realized).toFixed(2)}` : "—"}</strong>
                  <span>{typeof fill.cashAfterUsd === "number" ? `$${fill.cashAfterUsd.toFixed(2)}` : "—"}</span>
                  <span>{typeof fill.portfolioEquityAfterUsd === "number" ? `$${fill.portfolioEquityAfterUsd.toFixed(2)}` : "—"}</span>
                  <span><b>${fill.feeUsd.toFixed(4)}</b><small>{fill.slippageBps} bps</small></span>
                </div>;
              }) : <div className="empty-row">No PAPER fills in this verified run yet.</div>}
            </div>
          </div>
        )}
      </section>

      <section id="trades" className="log-panel page-panel">
        <div className="wide-panel-head"><div><h2>↗ Buys & Closes Log</h2><p>Quick position summary. Use the Detailed Trade Log tab for every exact fill and post-trade balance.</p></div><span className="quiet-chip">Guardian owned</span></div>
        <div className="trades-table enriched-trades-table">
          <div className="trade-row trade-head"><span>Token / CA</span><span>Chain</span><span>Buy Size</span><span>Entry</span><span>Mark / Exit</span><span>Status</span><span>P/L</span><span>Time</span></div>
          {positions.length ? positions.slice(0, 16).map((position) => {
            const pnlUsd = positionPnlUsd(position);
            const grossBuyUsd = recentFills
              .filter((fill) => fill.positionId === position.id && fill.side === "BUY")
              .reduce((sum, fill) => sum + fill.requestedUsd, 0);
            return <div className="trade-row" key={position.id}>
              <div className="trade-token-cell">
                <TokenAvatar imageUrl={position.imageUrl} symbol={position.symbol} compact />
                <div className="trade-token-copy">
                  <b>${position.symbol}</b>
                  <span className="ca-line">
                    <code title={position.tokenAddress}>CA {shortCa(position.tokenAddress)}</code>
                    <button type="button" onClick={() => void copyContract(position.tokenAddress)} title={`Copy full CA: ${position.tokenAddress}`} aria-label={`Copy ${position.symbol} contract address`}>
                      {copiedCa === position.tokenAddress ? "COPIED" : "COPY"}
                    </button>
                  </span>
                </div>
              </div>
              <span>{position.chain}</span>
              <strong className="trade-buy-size">${(grossBuyUsd || position.entryNotionalUsd || 0).toFixed(2)}</strong>
              <span>{price(position.entryPrice)}</span>
              <span>{price(position.markPrice)}</span>
              <span><em className={`status-${position.status}`}>{position.status === "closed" ? "Closed" : position.status === "unsellable" ? "Unsellable" : position.status === "exit_pending" ? "Exit Pending" : "Open"}</em></span>
              <strong className={pnlUsd >= 0 ? "positive trade-pnl" : "negative trade-pnl"}>
                <span>{position.pnlPct >= 0 ? "+" : ""}{position.pnlPct.toFixed(1)}%</span>
                <small>{pnlUsd >= 0 ? "+" : "-"}${Math.abs(pnlUsd).toFixed(2)}</small>
              </strong>
              <span>{ago(position.openedAt)}</span>
            </div>;
          }) : <div className="empty-row">No autonomous paper positions yet. Executor is waiting for a Council-approved BUY.</div>}
        </div>
      </section>

      <section id="roster" className="roster-panel page-panel">
        <div className="wide-panel-head"><div><h2>♧ Bot Roster</h2><p>Eight autonomous entities. Seven work privately first; Runner CIO receives their locked opinions only afterward.</p></div><span>Executor is infrastructure, not a Council seat.</span></div>
        <div className="roster-grid">{roster.map((id) => { const bot = botDescriptions[id]; return <article className="roster-card" key={id}><span className="roster-icon">{bot.icon}</span><div><h3>{bot.label}</h3><p>{bot.text}</p><small>{bot.tag}</small></div></article>; })}</div>
      </section>

      <section id="system" className="system-strip page-panel">
        <div><b>Autonomous paper execution</b><span>There is intentionally no Scan button and no Execute Paper button. Approved paper orders are created server-side from real market observations; placeholder/demo candidates are disabled. Decisions and fills are journaled for later analysis.</span></div>
        <div><b>Guardian 24/7</b><span>Scaling, trims, stops, re-entry rules and complete exits remain server-owned.</span></div>
        <div><b>Entities cannot vote around hard safety</b><span>The eight entities decide independently, but deterministic Executor/Guardian infrastructure still enforces explicit sellability, honeypot, authority and accounting constraints.</span></div>
      </section>
    </main>
  );
}
