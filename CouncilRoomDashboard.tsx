"use client";

/**
 * CouncilRoomDashboard.tsx
 *
 * Main Bot War Room council dashboard — LIGHT theme edition. The council is
 * rendered as eight individual live bot cards (portrait, name, role, per-bot
 * text chat) in a responsive grid; the round-table stage is gone.
 *
 * This component fetches NOTHING — the data layer supplies everything through
 * props:
 *
 *   { data: CouncilRoomData | null; loading: boolean; error?: string | null }
 *
 * Sections:
 *  - now reviewing: the coin the latest decision is about
 *  - live council session: 8 bot cards, each streaming that bot's own chat
 *    bubbles in real time (single rAF loop, typewriter feed, LIVE badge —
 *    no playback controls anywhere)
 *  - portfolio: cash, equity, open positions + allocation
 *  - trade log: recent paper fills
 *  - P&L: Realized vs Unrealized (honest labels; null renders as "—")
 *  - equity chart: drawn from data.equitySeries, hidden when empty
 *  - stats strip: data.stats only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fetchCouncilRoomData } from "@/lib/council-room-data";
import type {
  CouncilBotVM,
  CouncilRoomData,
  MeetingTurn,
  PositionRow,
  TradeRow,
} from "@/lib/council-room-types";

export type CouncilRoomDashboardProps = {
  data: CouncilRoomData | null;
  loading: boolean;
  error?: string | null;
};

/** Build a style object carrying CSS custom properties. */
function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

/* Light-theme vote/kind colors: dark enough for body text on white. */
const VOTE_COLORS: Record<string, string> = {
  BUY: "#147a4d",
  WATCH: "#96690f",
  SKIP: "#5d6d78",
  EXIT: "#b54a12",
  BLOCK: "#cf3542",
  READY: "#0a7d6d",
  REDUCE: "#b54a12",
};

const KIND_COLORS: Record<string, string> = {
  challenge: "#96690f",
  vote: "#0a7d6d",
  verdict: "#0a7d6d",
  veto: "#cf3542",
  system: "#8d9997",
};

function formatMoney(v: number, decimals = 2): string {
  return `${v < 0 ? "−$" : "+$"}${Math.abs(v).toFixed(decimals)}`;
}

/* ------------------------------------------------------------------ */
/* CountUp — one-shot count-up when the figure scrolls into view.      */
/* ------------------------------------------------------------------ */

function CountUp({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(() => formatMoney(0, decimals));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(formatMoney(value, decimals));
      return;
    }
    let raf = 0;
    let started = false;
    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1150);
        const e = 1 - Math.pow(1 - p, 4);
        setText(formatMoney(value * e, decimals));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) {
            started = true;
            run();
            io.disconnect();
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [value, decimals]);

  return <span ref={hostRef}>{text}</span>;
}

/* ------------------------------------------------------------------ */
/* EquityChart — canvas area chart drawn from data.equitySeries.       */
/* Hidden entirely when the series is empty (dashboard handles that).  */
/* ------------------------------------------------------------------ */

function EquityChart({
  series,
  equityUsd,
  cashUsd,
}: {
  series: number[];
  equityUsd: number | null;
  cashUsd: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  const stats = useMemo(() => {
    if (series.length === 0) return null;
    const start = series[0];
    let high = start;
    let low = start;
    let hiIdx = 0;
    let loIdx = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i] > high) {
        high = series[i];
        hiIdx = i;
      }
      if (series[i] < low) {
        low = series[i];
        loIdx = i;
      }
    }
    const end = series[series.length - 1];
    const change = end - start;
    const changePct = start !== 0 ? (change / Math.abs(start)) * 100 : null;
    return { start, end, high, low, hiIdx, loIdx, change, changePct };
  }, [series]);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (p: number) => {
      const data = seriesRef.current;
      const st = statsRef.current;
      const r = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, r.width);
      const H = Math.max(1, r.height);
      const pw = Math.max(1, Math.round(W * ratio));
      const ph = Math.max(1, Math.round(H * ratio));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const pad = { l: 12, r: 58, t: 20, b: 26 };
      const w = W - pad.l - pad.r;
      const h = H - pad.t - pad.b;
      if (data.length === 0 || w <= 0 || h <= 0 || !st) return;
      let min = st.low;
      let max = st.high;
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const span = max - min;
      min -= span * 0.08;
      max += span * 0.08;
      const n = data.length;
      const xAt = (i: number) => pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const yAt = (v: number) => pad.t + h * (1 - (v - min) / (max - min));
      const upto = Math.max(1, Math.min(n, Math.floor(n * p)));

      // Gridlines with value labels.
      ctx.strokeStyle = "rgba(18,44,40,.08)";
      ctx.fillStyle = "rgba(120,134,131,.95)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.lineWidth = 1;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const ticks = 4;
      for (let t = 0; t <= ticks; t++) {
        const v = min + ((max - min) * t) / ticks;
        const y = yAt(v);
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(W - pad.r + 6, y);
        ctx.stroke();
        ctx.fillText(formatMoney(v), W - pad.r + 10, y);
      }

      // Dashed session-start reference line.
      const sy = yAt(st.start);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(18,44,40,.28)";
      ctx.beginPath();
      ctx.moveTo(pad.l, sy);
      ctx.lineTo(W - pad.r + 6, sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Area fill.
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
      grad.addColorStop(0, "rgba(13,157,136,.28)");
      grad.addColorStop(1, "rgba(13,157,136,0)");
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(data[0]));
      for (let i = 1; i < upto; i++) ctx.lineTo(xAt(i), yAt(data[i]));
      ctx.lineTo(xAt(upto - 1), pad.t + h);
      ctx.lineTo(xAt(0), pad.t + h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line.
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(data[0]));
      for (let i = 1; i < upto; i++) ctx.lineTo(xAt(i), yAt(data[i]));
      ctx.strokeStyle = "#0d9d88";
      ctx.lineWidth = 2.25;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      if (p > 0.97) {
        const mark = (idx: number, v: number, color: string) => {
          const x = xAt(idx);
          const y = yAt(v);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(90,104,101,.95)";
          const leftSide = idx <= n * 0.7;
          ctx.textAlign = leftSide ? "left" : "right";
          ctx.fillText(formatMoney(v), leftSide ? x + 8 : x - 8, y - 9);
        };
        if (st.hiIdx !== st.loIdx) {
          mark(st.hiIdx, st.high, "#0d9d88");
          mark(st.loIdx, st.low, "#cf3542");
        }
        // Live end dot.
        const ex = xAt(n - 1);
        const ey = yAt(data[n - 1]);
        ctx.fillStyle = "#0d9d88";
        ctx.shadowColor = "#0d9d88";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    let raf = 0;
    let started = false;
    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const pr = reduce ? 1 : Math.min(1, (now - t0) / 1350);
        draw(1 - Math.pow(1 - pr, 3));
        if (pr < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) {
            started = true;
            run();
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(canvas);
    const onResize = () => draw(1);
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!stats) return null;
  const up = stats.change >= 0;

  return (
    <section className="section" aria-labelledby="chartTitle">
      <div className="panel chart-panel">
        <div className="chart-head">
          <div>
            <h2 className="section-title" id="chartTitle">
              Paper equity
            </h2>
            <p className="section-note">
              Live equity path · {series.length} point
              {series.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="eq-head-right">
            <span className="eq-equity">
              {equityUsd == null ? "—" : formatMoney(equityUsd)}
            </span>
            <span className={`eq-change${up ? " pos" : " neg"}`}>
              {up ? "\u25B2" : "\u25BC"} {formatMoney(stats.change)}
              {stats.changePct != null
                ? ` (${up ? "+" : ""}${stats.changePct.toFixed(2)}%)`
                : ""}
            </span>
          </div>
        </div>
        <div className="eq-stats">
          <div className="eq-stat">
            <span>Session start</span>
            <b>{formatMoney(stats.start)}</b>
          </div>
          <div className="eq-stat">
            <span>Session high</span>
            <b className="pos">{formatMoney(stats.high)}</b>
          </div>
          <div className="eq-stat">
            <span>Session low</span>
            <b className="neg">{formatMoney(stats.low)}</b>
          </div>
          <div className="eq-stat">
            <span>Cash</span>
            <b>{cashUsd == null ? "—" : formatMoney(cashUsd)}</b>
          </div>
        </div>
        <div className="chart-wrap chart-wrap-tall">
          <canvas
            ref={canvasRef}
            aria-label={`Paper equity path, ${series.length} points`}
          />
        </div>
        <p className="chart-caption">
          Dashed line marks the session start · dots mark the session high and
          low
        </p>
      </div>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* LiveCouncilGrid — eight individual bot cards, each streaming that   */
/* bot's own live chat at the bottom. Active speaker gets a glowing    */
/* ring + talking animation; reactions pop over portraits; veto/      */
/* approval shakes and hops read live from the same turn stream.      */
/* No playback controls — the feed starts on load and runs live.       */
/* ------------------------------------------------------------------ */

type BotReaction = {
  emoji: string | null;
  kind: "hop" | "nod" | "shake" | null;
  stamp: number;
};

const REACTION_CLEAR_MS = 1700;
const TYPE_CHARS_PER_SECOND = 36;
const TURN_HOLD_SECONDS = 1.05;

/* ------------------------------------------------------------------ */
/* WalletStrip — live paper-wallet figures pinned to the top of the    */
/* council panel. Updates whenever fresh data arrives.                 */
/* ------------------------------------------------------------------ */

function WalletStrip({
  wallet,
  openPositions,
}: {
  wallet: CouncilRoomData["wallet"];
  openPositions: number;
}) {
  if (!wallet) return null;
  const items: {
    label: string;
    text: string;
    tone?: "pos" | "neg";
  }[] = [
    { label: "Cash", text: formatUsd(wallet.cashUsd) },
    { label: "Equity", text: formatUsd(wallet.equityUsd) },
    {
      label: "Unrealized",
      text:
        wallet.unrealizedPnlUsd == null
          ? "—"
          : formatMoney(wallet.unrealizedPnlUsd),
      tone:
        wallet.unrealizedPnlUsd == null
          ? undefined
          : wallet.unrealizedPnlUsd >= 0
            ? "pos"
            : "neg",
    },
    {
      label: "Realized",
      text:
        wallet.realizedPnlUsd == null ? "—" : formatMoney(wallet.realizedPnlUsd),
      tone:
        wallet.realizedPnlUsd == null
          ? undefined
          : wallet.realizedPnlUsd >= 0
            ? "pos"
            : "neg",
    },
    { label: "Open", text: String(openPositions) },
  ];
  return (
    <div className="council-wallet-strip" aria-label="Live paper wallet">
      {items.map((it) => (
        <span className="cws-item" key={it.label}>
          <em>{it.label}</em>
          <strong className={it.tone ? `cws-${it.tone}` : undefined}>
            {it.text}
          </strong>
        </span>
      ))}
      <span className="cws-live" aria-hidden="true">
        <i />
        updates live
      </span>
    </div>
  );
}

function LiveCouncilGrid({
  meeting,
  bots,
  wallet,
  openPositions,
}: {
  meeting: CouncilRoomData["meeting"];
  bots: CouncilBotVM[];
  wallet: CouncilRoomData["wallet"];
  openPositions: number;
}) {
  // Defensive: a turn without a real message string crashes the typewriter
  // (t.message.length on undefined). Drop those turns before animating.
  const turns = useMemo(
    () =>
      (meeting?.turns ?? []).filter(
        (t) => t && typeof t.message === "string" && t.message.length > 0,
      ),
    [meeting],
  );
  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  const [visible, setVisible] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [doneSet, setDoneSet] = useState<ReadonlySet<number>>(new Set());
  const [reactions, setReactions] = useState<ReadonlyMap<string, BotReaction>>(new Map());
  const [status, setStatus] = useState("Council idle — awaiting session");

  const reduceRef = useRef(false);
  const lastKeyRef = useRef("");
  const textRefs = useRef(new Map<number, HTMLSpanElement>());
  const chatRefs = useRef(new Map<string, HTMLDivElement>());
  const cursorRefs = useRef(new Map<number, HTMLSpanElement>());
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressWrapRef = useRef<HTMLDivElement>(null);
  const reactionTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const meetingKey = meeting
    ? `${meeting.at}|${meeting.symbol}|${meeting.decision}|${turns.length}`
    : "";
  const symbol = meeting?.symbol;

  const visibleByBot = useMemo(() => {
    const byBot = new Map<string, number[]>();
    for (const i of visible) {
      const t = turns[i];
      if (!t) continue;
      const arr = byBot.get(t.botId) ?? [];
      arr.push(i);
      byBot.set(t.botId, arr);
    }
    return byBot;
  }, [visible, turns]);

  const clearReaction = (botId: string, stamp: number) => {
    setReactions((prev) => {
      const cur = prev.get(botId);
      if (!cur || cur.stamp !== stamp) return prev;
      const next = new Map(prev);
      next.delete(botId);
      return next;
    });
  };

  const react = (botId: string, emoji: string | null, kind: BotReaction["kind"]) => {
    const stamp = Date.now() + Math.random();
    setReactions((prev) => new Map(prev).set(botId, { emoji, kind, stamp }));
    const timer = setTimeout(() => clearReaction(botId, stamp), REACTION_CLEAR_MS);
    reactionTimers.current.push(timer);
  };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceRef.current = reduce;
    reactionTimers.current.forEach(clearTimeout);
    reactionTimers.current = [];

    const speakerLabel = (t: MeetingTurn) =>
      t.shortName || botById.get(t.botId)?.shortName || t.botName;

    if (!turns.length) {
      setStatus("Council idle — awaiting session");
      setVisible([]);
      setActiveIndex(-1);
      setDoneSet(new Set());
      if (progressFillRef.current) progressFillRef.current.style.width = "0%";
      if (progressWrapRef.current) progressWrapRef.current.setAttribute("aria-valuenow", "0");
      return;
    }

    if (reduce) {
      setVisible(turns.map((_, i) => i));
      setDoneSet(new Set(turns.map((_, i) => i)));
      setActiveIndex(-1);
      setStatus(
        `Session record — ${turns.length} turns` +
          (meeting?.decision ? ` · ${meeting.decision}` : ""),
      );
      if (progressFillRef.current) progressFillRef.current.style.width = "100%";
      if (progressWrapRef.current) progressWrapRef.current.setAttribute("aria-valuenow", "100");
      return;
    }

    let turnIndex = -1;
    let typed = 0;
    let charCarry = 0;
    let hold = 0;
    let turnDone = false;
    let playing = false;
    let finished = false;
    let cancelled = false;
    let lastFrame = performance.now();
    let raf = 0;

    const updateProgress = () => {
      const fill = progressFillRef.current;
      const wrap = progressWrapRef.current;
      if (!fill || turnIndex < 0 || turnIndex >= turns.length) return;
      const perTurn = 1 / turns.length;
      const t = turns[turnIndex];
      const frac = t.message.length ? typed / t.message.length : 1;
      const pct = Math.min(100, (turnIndex + frac) * perTurn * 100);
      fill.style.width = `${pct.toFixed(2)}%`;
      wrap?.setAttribute("aria-valuenow", String(Math.round(pct)));
    };

    const scrollChat = (botId: string) => {
      const el = chatRefs.current.get(botId);
      if (el) el.scrollTop = el.scrollHeight;
    };

    const renderTyped = () => {
      if (turnIndex < 0 || turnIndex >= turns.length) return;
      const el = textRefs.current.get(turnIndex);
      const len = Math.floor(typed);
      if (el && el.dataset.len !== String(len)) {
        el.dataset.len = String(len);
        el.textContent = turns[turnIndex].message.slice(0, len);
      }
      scrollChat(turns[turnIndex].botId);
      updateProgress();
    };

    const completeTurn = () => {
      turnDone = true;
      // Do NOT manually .remove() the cursor node: React still owns it and
      // will remove it on the re-render below. Manually removing it first
      // makes React's own removeChild throw NotFoundError and unmount the
      // whole page (the "crash when chat bubbles start coming up").
      cursorRefs.current.delete(turnIndex);
      const done = turnIndex;
      setDoneSet((prev) => new Set(prev).add(done));
    };

    const queueReactions = (t: MeetingTurn) => {
      const emo = t.emoji ?? null;
      if (t.kind === "veto") {
        // Executor veto: speaker pops ⛔ and hops; every bot shakes in protest.
        react(t.botId, emo ?? "⛔", "hop");
        for (const b of bots) if (b.id !== t.botId) react(b.id, null, "shake");
      } else if (t.kind === "verdict") {
        if (t.vote === "BUY") {
          // Approval: speaker hops with ✅; the room nods/hops along.
          react(t.botId, emo ?? "✅", "hop");
          bots.forEach((b, i) => {
            if (b.id !== t.botId) react(b.id, null, i % 2 ? "nod" : "hop");
          });
        } else {
          react(t.botId, emo, "hop");
        }
      } else if (t.kind === "challenge") {
        react(t.botId, emo ?? "💬", null);
      } else if (emo) {
        react(t.botId, emo, null);
      }
    };

    const activateTurn = (index: number) => {
      turnIndex = index;
      typed = 0;
      charCarry = 0;
      hold = 0;
      turnDone = false;
      const t = turns[index];
      setVisible((prev) => (prev.includes(index) ? prev : [...prev, index]));
      setActiveIndex(index);
      queueReactions(t);
      setStatus(
        `Council in session — ${speakerLabel(t)} speaking${symbol ? ` on ${symbol}` : ""}`,
      );
      renderTyped();
      updateProgress();
    };

    const closeSession = () => {
      playing = false;
      finished = true;
      setActiveIndex(-1);
      setStatus(
        "Session closed" +
          (meeting?.decision ? ` — ${symbol ?? "session"}: ${meeting.decision}` : ""),
      );
      updateProgress();
    };

    const resetAndStart = () => {
      textRefs.current.clear();
      cursorRefs.current.clear();
      setVisible([]);
      setDoneSet(new Set());
      setReactions(new Map());
      turnIndex = -1;
      typed = 0;
      charCarry = 0;
      hold = 0;
      turnDone = false;
      finished = false;
      playing = true;
      activateTurn(0);
    };

    if (meetingKey !== lastKeyRef.current) {
      lastKeyRef.current = meetingKey;
      resetAndStart();
    }

    const loop = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if (playing && turnIndex >= 0 && !finished) {
        const t = turns[turnIndex];
        if (typed < t.message.length) {
          charCarry += dt * TYPE_CHARS_PER_SECOND;
          if (charCarry >= 1) {
            typed = Math.min(t.message.length, typed + Math.floor(charCarry));
            charCarry %= 1;
          }
          renderTyped();
        } else {
          if (!turnDone) completeTurn();
          hold += dt;
          if (hold >= TURN_HOLD_SECONDS) {
            if (turnIndex < turns.length - 1) activateTurn(turnIndex + 1);
            else closeSession();
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      reactionTimers.current.forEach(clearTimeout);
      reactionTimers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, bots]);

  const activeBotId =
    activeIndex >= 0 && turns[activeIndex] ? turns[activeIndex].botId : null;

  return (
    <section className="section" aria-labelledby="liveSessionTitle">
      <div className="panel council-live">
        <div className="panel-head">
          <div>
            <h2 className="section-title" id="liveSessionTitle">
              Live council session
            </h2>
            <p className="section-note">{status}</p>
            {meeting && turns.length > 0 && (
              <span className="decision-pill">
                {meeting.decision} · conviction {Math.round(meeting.conviction)}%
              </span>
            )}
          </div>
          <div
            className="live-badge"
            role="status"
            aria-label="Live council feed — messages stream in automatically"
          >
            <span className="live-dot" aria-hidden="true" />
            LIVE
          </div>
        </div>
        <WalletStrip wallet={wallet} openPositions={openPositions} />
        <div
          className="progress-track"
          ref={progressWrapRef}
          role="progressbar"
          aria-label="Live session progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
        >
          <div className="progress-fill" ref={progressFillRef} />
        </div>
        {turns.length === 0 && (
          <p className="council-idle-note">
            Council idle — the bots are watching the market. New sessions
            appear here live.
          </p>
        )}
        {
          <div className="council-grid" aria-live="polite">
            {bots.map((b) => {
              const speaking = b.id === activeBotId;
              const r = reactions.get(b.id);
              const botTurns = (visibleByBot.get(b.id) ?? []).slice(-40);
              const voteLine = b.latestVote
                ? `${b.latestVote}${
                    b.latestConfidence != null ? ` · ${b.latestConfidence}%` : ""
                  }`
                : "—";
              const animClass =
                r?.kind === "shake"
                  ? " council-shake"
                  : r?.kind === "hop"
                    ? " council-hop"
                    : r?.kind === "nod"
                      ? " council-nod"
                      : "";
              return (
                <article
                  key={b.id}
                  className={`council-card${speaking ? " speaking" : ""}`}
                  style={cssVars({ "--bot-color": b.color || "#94a3b8" })}
                  aria-label={`${b.name}, ${b.role}${speaking ? " — speaking now" : ""}`}
                >
                  <div className="council-card-head">
                    <div
                      className={`council-portrait${speaking ? " talking" : ""}${animClass}`}
                      key={r ? `${b.id}-${r.stamp}` : b.id}
                    >
                      {r?.emoji ? (
                        <span className="reaction-pop" aria-hidden="true">
                          {r.emoji}
                        </span>
                      ) : null}
                      {b.portrait ? (
                        <img
                          src={b.portrait}
                          alt={`${b.name}, ${b.role}`}
                          draggable={false}
                        />
                      ) : null}
                    </div>
                    <div className="council-card-id">
                      <strong>{b.name}</strong>
                      <span>{b.role}</span>
                    </div>
                    <span className={`mini-live${b.status === "LIVE" ? "" : " idle"}`}>
                      <i aria-hidden="true" />
                      {b.status}
                    </span>
                  </div>
                  <div className={`council-card-stat${b.latestVote ? "" : " dim"}`}>
                    {voteLine}
                    {speaking && (
                      <span className="speaking-tag" aria-hidden="true">
                        speaking…
                      </span>
                    )}
                  </div>
                  <div
                    className="council-card-chat"
                    ref={(el) => {
                      if (el) chatRefs.current.set(b.id, el);
                      else chatRefs.current.delete(b.id);
                    }}
                  >
                    {botTurns.length === 0 ? (
                      <p className="council-card-idle">
                        Waiting for this bot&apos;s analysis.
                      </p>
                    ) : (
                      botTurns.map((i) => {
                        const t = turns[i];
                        const done = doneSet.has(i) || reduceRef.current;
                        const isActive = i === activeIndex;
                        const voteColor = t.vote
                          ? (VOTE_COLORS[t.vote] ?? "#5d6d78")
                          : null;
                        const kindColor =
                          t.kind !== "score"
                            ? (KIND_COLORS[t.kind] ?? "#8d9997")
                            : null;
                        return (
                          <div
                            key={`${meeting?.at ?? "m"}-${i}`}
                            className={`mini-bubble${
                              isActive ? " active" : ""
                            }${t.kind !== "score" ? " system" : ""}`}
                          >
                            <div className="mini-bubble-meta">
                              {t.vote && (
                                <span
                                  className="vote-badge"
                                  style={cssVars({
                                    "--vote-color": voteColor ?? "#5d6d78",
                                  })}
                                >
                                  {t.vote}
                                </span>
                              )}
                              {t.confidence != null && (
                                <span className="score-chip">{t.confidence}%</span>
                              )}
                              {t.kind !== "score" && (
                                <span
                                  className="kind-chip"
                                  style={cssVars({
                                    "--kind-color": kindColor ?? "#8d9997",
                                  })}
                                >
                                  {t.kind}
                                </span>
                              )}
                            </div>
                            <p>
                              <span
                                className="typed-text"
                                ref={(el) => {
                                  if (el) textRefs.current.set(i, el);
                                  else textRefs.current.delete(i);
                                }}
                              >
                                {done ? t.message : ""}
                              </span>
                              {isActive && !done && (
                                <span
                                  className="cursor"
                                  aria-hidden="true"
                                  ref={(el) => {
                                    if (el) cursorRefs.current.set(i, el);
                                    else cursorRefs.current.delete(i);
                                  }}
                                />
                              )}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        }
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Now reviewing — the coin the latest decision is about.              */
/* ------------------------------------------------------------------ */

function formatUsd(v: number | null, decimals = 2): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: decimals })}`;
}

function formatCompactUsd(v: number | null): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function formatAge(ageMinutes: number | null): string {
  if (ageMinutes == null) return "—";
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  const h = Math.floor(ageMinutes / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NowReviewingCard({ now }: { now: CouncilRoomData["nowReviewing"] }) {
  if (!now) {
    return (
      <section className="section" aria-labelledby="nowTitle">
        <div className="panel now-reviewing">
          <div className="now-kicker">
            <span className="live-dot" aria-hidden="true" />
            Now reviewing
          </div>
          <p className="now-empty-note">
            No coin under review — the council has not issued a decision yet.
          </p>
        </div>
      </section>
    );
  }
  const chg = now.priceChange24h ?? null;
  return (
    <section className="section" aria-labelledby="nowTitle">
      <div className="panel now-reviewing">
        <div className="now-kicker">
          <span className="live-dot" aria-hidden="true" />
          Now reviewing
        </div>
        <div className="now-top">
          <span className="now-chain">{now.chain ?? "—"}</span>
          {now.at ? <span className="now-time">{formatTime(now.at)}</span> : null}
        </div>
        <div className="now-main">
          <div className="now-symbol-block">
            <span className="now-symbol">{now.symbol}</span>
            <span className="now-decision">{now.decision}</span>
          </div>
          <div className="now-fields">
            <div>
              <span>Price</span>
              <strong>{formatUsd(now.price, 6)}</strong>
            </div>
            <div>
              <span>24h</span>
              <strong className={chg == null ? "" : chg >= 0 ? "pos" : "neg"}>
                {chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>Mkt cap</span>
              <strong>{formatCompactUsd(now.marketCap)}</strong>
            </div>
            <div>
              <span>Liquidity</span>
              <strong>{formatCompactUsd(now.liquidity)}</strong>
            </div>
            <div>
              <span>Age</span>
              <strong>{formatAge(now.ageMinutes)}</strong>
            </div>
            <div>
              <span>Conviction</span>
              <strong>{now.conviction != null ? `${Math.round(now.conviction)}%` : "—"}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Adaptive price formatting for tiny meme-coin prices. */
function formatPrice(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const d = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: d })}`;
}

/* ------------------------------------------------------------------ */
/* HoldingsSection — live coin cards for every open position, directly */
/* below the portfolio table. Updates whenever fresh data arrives.     */
/* ------------------------------------------------------------------ */

function HoldingsSection({ positions }: { positions: PositionRow[] }) {
  const list = (positions ?? []).filter(
    (p) => p.sizeUsd == null || p.sizeUsd > 0
  );
  return (
    <section className="section" aria-labelledby="holdingsTitle">
      <div className="panel holdings-panel">
        <div className="panel-head">
          <div>
            <h2 className="section-title" id="holdingsTitle">
              Live holdings
            </h2>
            <p className="section-note">
              {list.length === 0
                ? "No coins held right now."
                : `${list.length} coin${list.length === 1 ? "" : "s"} held · prices update live`}
            </p>
          </div>
          <div
            className="live-badge"
            role="status"
            aria-label="Holdings update live"
          >
            <span className="live-dot" aria-hidden="true" />
            LIVE
          </div>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">
            The council isn&apos;t holding any coins right now.
          </div>
        ) : (
          <div className="holdings-grid">
            {list.map((p) => {
              const pnl = p.pnlUsd;
              const pnlPct = p.pnlPct;
              const tone = pnl == null ? "" : pnl >= 0 ? " pos" : " neg";
              return (
                <article key={p.id} className="holding-card">
                  <div className="holding-top">
                    <div className="holding-id">
                      <strong className="holding-symbol">{p.symbol}</strong>
                      <span className="holding-chain">{p.chain ?? "—"}</span>
                    </div>
                    <span className={`holding-pnl${tone}`}>
                      {pnl == null ? "—" : formatMoney(pnl)}
                    </span>
                  </div>
                  <div className="holding-mark">
                    {formatPrice(p.markPrice)}
                    {pnlPct != null && (
                      <span
                        className={`holding-pct${pnlPct >= 0 ? " pos" : " neg"}`}
                      >
                        {pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="holding-meta">
                    <span>
                      Size <b>{formatUsd(p.sizeUsd)}</b>
                    </span>
                    <span>
                      Entry <b>{formatPrice(p.entryPrice)}</b>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trade log — recent paper fills, newest first.                       */
/* ------------------------------------------------------------------ */

function TradeLogSection({
  trades,
  tradesTotal,
}: {
  trades: TradeRow[];
  tradesTotal: number | null;
}) {
  return (
    <section className="section" aria-labelledby="logTitle">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="section-title" id="logTitle">
              Trade log
            </h2>
            <p className="section-note">
              {tradesTotal != null
                ? `${tradesTotal} recorded fill${tradesTotal === 1 ? "" : "s"}`
                : "Recent paper fills"}
            </p>
          </div>
        </div>
        {trades.length === 0 ? (
          <div className="empty-panel">
            <p className="folio-empty-note">No trades recorded yet.</p>
          </div>
        ) : (
          <div className="folio-table-wrap">
            <table className="log-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Side</th>
                  <th scope="col">Action</th>
                  <th scope="col">Size</th>
                  <th scope="col">Price</th>
                  <th scope="col">PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td className="dim">{t.at ? formatTime(t.at) : "—"}</td>
                    <td>
                      <strong>{t.symbol}</strong>
                      {t.chain ? <span className="dim"> · {t.chain}</span> : null}
                    </td>
                    <td className={t.side === "BUY" ? "pos" : "neg"}>{t.side}</td>
                    <td className="dim">{t.action}</td>
                    <td>{formatUsd(t.sizeUsd)}</td>
                    <td className="dim">{formatUsd(t.price, 6)}</td>
                    <td className={t.pnlUsd == null ? "dim" : t.pnlUsd >= 0 ? "pos" : "neg"}>
                      {t.pnlUsd == null ? "—" : formatMoney(t.pnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* P&L — Realized vs Unrealized, explicitly labeled.                   */
/* ------------------------------------------------------------------ */

function PnlSection({ wallet }: { wallet: CouncilRoomData["wallet"] }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const doReset = async () => {
    setBusy(true);
    setResetError(null);
    try {
      const res = await fetch("/api/paper-wallet/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Reset failed (HTTP ${res.status})`);
      }
      window.location.reload();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed.");
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section className="section" aria-labelledby="pnlTitle">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="section-title" id="pnlTitle">
              Paper P&amp;L
            </h2>
            <p className="section-note">Realized = closed trades · Unrealized = open marks</p>
          </div>
          <div className="pnl-actions">
            {!confirming ? (
              <button
                type="button"
                className="reset-btn"
                onClick={() => {
                  setResetError(null);
                  setConfirming(true);
                }}
              >
                Reset paper wallet
              </button>
            ) : (
              <div className="reset-confirm">
                <span className="reset-q">
                  Clear all paper positions &amp; history?
                </span>
                <button
                  type="button"
                  className="reset-btn danger"
                  disabled={busy}
                  onClick={doReset}
                >
                  {busy ? "Resetting…" : "Yes, reset"}
                </button>
                <button
                  type="button"
                  className="reset-btn ghost"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
        {resetError && (
          <p className="reset-error" role="alert">
            {resetError}
          </p>
        )}
        <div className="pnl-grid">
          <div className="pnl-figure">
            <span className="figure-label">Realized</span>
            <span className="figure-number">
              {wallet.realizedPnlUsd == null ? "—" : <CountUp value={wallet.realizedPnlUsd} />}
            </span>
            <span className="figure-sub">Paper trading</span>
          </div>
          <hr className="pnl-rule" />
          <div className="pnl-figure unrealized">
            <span className="figure-label">Unrealized</span>
            <span className="figure-number">
              {wallet.unrealizedPnlUsd == null ? "—" : <CountUp value={wallet.unrealizedPnlUsd} />}
            </span>
            <span className="figure-sub">Open marks</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats strip.                                                        */
/* ------------------------------------------------------------------ */

function StatsSection({ stats }: { stats: CouncilRoomData["stats"] }) {
  if (stats.length === 0) return null;
  return (
    <section className="section" aria-labelledby="statsTitle">
      <h2 className="section-title sr-only" id="statsTitle">
        Council statistics
      </h2>
      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Loading / error states.                                             */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="shell" aria-busy="true" aria-label="Loading council room">
      <header className="topbar">
        <div className="identity">
          <span className="live-label">
            <span className="dot" aria-hidden="true" />
            LIVE
          </span>
          <div>
            <h1>Bot War Room</h1>
            <p className="status-note">Warming up the council…</p>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="skel" style={{ height: 120 }} />
        <div className="skel" style={{ height: 420 }} />
        <div className="skel" style={{ height: 260 }} />
      </main>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="identity">
          <div>
            <h1>Bot War Room</h1>
            <p className="status-note">Council session companion · paper trading</p>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="panel error-panel" role="alert">
          <h2 className="section-title">Couldn&apos;t reach the council</h2>
          <p className="section-note">{message}</p>
          <button type="button" className="retry" onClick={onRetry}>
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main view + self-loading default export.                            */
/* ------------------------------------------------------------------ */

function CouncilRoomDashboardView({
  data,
  loading,
  error,
  onRetry,
}: CouncilRoomDashboardProps & { onRetry: () => void }) {
  if (loading) return <LoadingSkeleton />;
  if (error || !data) {
    return <ErrorState message={error ?? "Unknown error"} onRetry={onRetry} />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="identity">
          <div>
            <h1>Bot War Room</h1>
            <p className="status-note">Council session companion · paper trading</p>
          </div>
          <span className="pill">PAPER ONLY</span>
        </div>
        <div className="statuses">
          <span className="live-label">
            <span className="dot" aria-hidden="true" />
            LIVE
          </span>
        </div>
      </header>

      <main className="main">
        <NowReviewingCard now={data.nowReviewing} />
        <LiveCouncilGrid
          meeting={data.meeting}
          bots={data.bots}
          wallet={data.wallet}
          openPositions={data.portfolio.positions.filter(
            (p) => p.sizeUsd == null || p.sizeUsd > 0
          ).length}
        />
        {data.equitySeries.length > 0 && (
          <EquityChart
            series={data.equitySeries}
            equityUsd={data.wallet.equityUsd}
            cashUsd={data.wallet.cashUsd}
          />
        )}
        <HoldingsSection positions={data.portfolio.positions} />
        <PnlSection wallet={data.wallet} />
        <TradeLogSection trades={data.trades} tradesTotal={data.tradesTotal} />
        <StatsSection stats={data.stats} />
        <footer>
          <p className="section-note">
            Council Room · {data.statusNote}
            <br />
            Frontend only — it never sends orders. Paper trading only.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default function CouncilRoomDashboard() {
  const [data, setData] = useState<CouncilRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await fetchCouncilRoomData();
        if (!cancelled) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      } finally {
        inFlight = false;
      }
      if (!cancelled) timer = setTimeout(load, 60_000);
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryKey]);

  return (
    <div className="council-room">
      <CouncilRoomDashboardView
        data={data}
        loading={loading}
        error={error}
        onRetry={() => setRetryKey((k) => k + 1)}
      />
    </div>
  );
}
