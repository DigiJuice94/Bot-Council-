"use client";

/**
 * CouncilRoomDashboard.tsx
 *
 * Main Bot War Room council dashboard. This component fetches NOTHING —
 * the data layer supplies everything through props:
 *
 *   { data: CouncilRoomData | null; loading: boolean; error?: string | null }
 *
 * Sections:
 *  - hero: animated council stage (council-room-table.tsx)
 *  - meeting replay: transcript driven ENTIRELY by data.meeting.turns
 *  - P&L: Realized vs Unrealized (honest labels; null renders as "—")
 *  - equity chart: drawn from data.equitySeries, hidden when empty
 *  - roster: cards from data.bots
 *  - stats strip: data.stats only
 *
 * The single continuous rAF loop lives in CouncilTranscript: it advances the
 * typing replay AND calls the stage's imperative tick() every frame, so all
 * ambient animation (idle bob, talk wiggle, veto shakes, emoji pops, dust
 * particles, speech tail) runs on one loop with delta-time lerped easing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import CouncilStage, { cssVars } from "./council-room-table";
import type { CouncilStageHandle } from "./council-room-table";
import { createReplaySync, EMPTY_DATA } from "@/lib/council-room-types";
import { fetchCouncilRoomData } from "@/lib/council-room-data";
import type {
  CouncilBotVM,
  CouncilRoomData,
  MeetingTurn,
  ReplaySync,
  StageReactionKind,
} from "@/lib/council-room-types";

export type CouncilRoomDashboardProps = {
  data: CouncilRoomData | null;
  loading: boolean;
  error?: string | null;
};

const VOTE_COLORS: Record<string, string> = {
  BUY: "#4ade80",
  WATCH: "#f5c451",
  SKIP: "#94a3b8",
  EXIT: "#fb923c",
  BLOCK: "#ff626e",
  READY: "#5eead4",
  REDUCE: "#fb923c",
};

const KIND_COLORS: Record<string, string> = {
  challenge: "#f5c451",
  vote: "#62dccd",
  verdict: "#62dccd",
  veto: "#ff7d87",
  system: "#778582",
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (p: number) => {
      const data = seriesRef.current;
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
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const pad = { l: 20, r: 20, t: 18, b: 28 };
      const w = W - pad.l - pad.r;
      const h = H - pad.t - pad.b;
      ctx.strokeStyle = dark ? "rgba(221,242,238,.08)" : "rgba(18,44,40,.1)";
      ctx.lineWidth = 1;
      for (const v of [0, 0.5, 1]) {
        const y = pad.t + h * v;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(W - pad.r, y);
        ctx.stroke();
      }
      if (data.length === 0 || w <= 0 || h <= 0) return;
      let min = Math.min(...data);
      let max = Math.max(...data);
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const n = data.length;
      const xAt = (i: number) => pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const yAt = (v: number) => pad.t + h * (1 - (v - min) / (max - min));
      const upto = Math.max(1, Math.min(n, Math.floor(n * p)));

      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
      grad.addColorStop(0, "rgba(70,207,190,.28)");
      grad.addColorStop(1, "rgba(70,207,190,0)");
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(data[0]));
      for (let i = 1; i < upto; i++) ctx.lineTo(xAt(i), yAt(data[i]));
      ctx.lineTo(xAt(upto - 1), pad.t + h);
      ctx.lineTo(xAt(0), pad.t + h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(data[0]));
      for (let i = 1; i < upto; i++) ctx.lineTo(xAt(i), yAt(data[i]));
      ctx.strokeStyle = "#46cfbe";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      if (p > 0.98) {
        const ex = xAt(n - 1);
        const ey = yAt(data[n - 1]);
        ctx.fillStyle = "#46cfbe";
        ctx.shadowColor = "#46cfbe";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = dark ? "rgba(163,176,174,.68)" : "rgba(82,98,96,.78)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(formatMoney(data[0]), pad.l, pad.t + h - 4);
      if (p > 0.92) {
        ctx.textAlign = "right";
        ctx.fillText(formatMoney(data[n - 1]), W - pad.r, yAt(data[n - 1]) - 8);
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

  return (
    <section className="section" aria-labelledby="chartTitle">
      <div className="panel chart-panel">
        <div className="chart-head">
          <strong id="chartTitle">Paper equity</strong>
          <span>{equityUsd == null ? "—" : formatMoney(equityUsd)}</span>
        </div>
        <div className="chart-wrap">
          <canvas
            ref={canvasRef}
            aria-label={`Paper equity path, ${series.length} points`}
          />
        </div>
        <p className="chart-caption">
          {`Paper equity path · ${series.length} point${series.length === 1 ? "" : "s"}`}
          {cashUsd != null ? ` · cash ${formatMoney(cashUsd)}` : ""}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* CouncilTranscript — meeting replay driven ENTIRELY by               */
/* data.meeting.turns. Owns the single rAF loop: it advances the       */
/* typewriter replay and calls the stage tick() every frame.           */
/* ------------------------------------------------------------------ */

type EngineControls = {
  play: () => void;
  pause: () => void;
  replay: () => void;
};

function CouncilTranscript({
  meeting,
  bots,
  sync,
  stageHandle,
}: {
  meeting: CouncilRoomData["meeting"];
  bots: CouncilBotVM[];
  sync: { current: ReplaySync };
  stageHandle: { current: CouncilStageHandle | null };
}) {
  const turns = meeting?.turns ?? [];
  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  const [visible, setVisible] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [doneSet, setDoneSet] = useState<ReadonlySet<number>>(new Set());
  const [ui, setUi] = useState({ playing: false, finished: false, started: false });
  const [live, setLive] = useState(false);
  const [speed, setSpeed] = useState(1);

  const engineRef = useRef<EngineControls | null>(null);
  const speedRef = useRef(1);
  const reduceRef = useRef(false);
  const textRefs = useRef(new Map<number, HTMLSpanElement>());
  const bubbleRefs = useRef(new Map<number, HTMLDivElement>());
  const cursorRefs = useRef(new Map<number, HTMLSpanElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);

  const colorFor = (t: MeetingTurn) => t.color || botById.get(t.botId)?.color || "#94a3b8";
  const portraitFor = (t: MeetingTurn) => t.portrait || botById.get(t.botId)?.portrait || "";

  useEffect(() => {
    const s = sync.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceRef.current = reduce;
    s.reduceMotion = reduce;

    const totalChars = turns.reduce((n, t) => n + t.message.length, 0);
    const symbol = meeting?.symbol;
    const speakerLabel = (t: MeetingTurn) =>
      t.shortName || botById.get(t.botId)?.shortName || t.botName;

    const idle = () => {
      s.status = "Council idle — awaiting session";
      s.turnIndex = -1;
      s.playing = false;
      s.finished = false;
      s.activeBotId = null;
      s.currentBubble = null;
      s.reactions.length = 0;
      setVisible([]);
      setActiveIndex(-1);
      setDoneSet(new Set());
      setUi({ playing: false, finished: false, started: false });
      setLive(false);
      if (progressFillRef.current) progressFillRef.current.style.width = "0%";
      if (progressTrackRef.current) {
        progressTrackRef.current.setAttribute("aria-valuenow", "0");
      }
      stageHandle.current?.tick(performance.now(), 0);
    };

    if (!turns.length) {
      idle();
      return;
    }

    s.status = `Council ready — reviewing ${symbol ?? meeting?.title ?? "session"}`;

    if (reduce) {
      // Reduced motion: render the full record at once, no animation.
      setVisible(turns.map((_, i) => i));
      setDoneSet(new Set(turns.map((_, i) => i)));
      setActiveIndex(-1);
      s.turnIndex = turns.length - 1;
      s.finished = true;
      s.playing = false;
      s.activeBotId = null;
      s.status =
        `Session record — ${turns.length} turn${turns.length === 1 ? "" : "s"}` +
        (meeting?.decision ? ` · ${meeting.decision}` : "");
      setUi({ playing: false, finished: true, started: true });
      setLive(false);
      if (progressFillRef.current) progressFillRef.current.style.width = "100%";
      if (progressTrackRef.current) {
        progressTrackRef.current.setAttribute("aria-valuenow", "100");
      }
      requestAnimationFrame(() => stageHandle.current?.tick(performance.now(), 0));
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
      let chars = 0;
      for (let i = 0; i < turnIndex; i++) chars += turns[i].message.length;
      if (turnIndex >= 0 && turnIndex < turns.length) {
        chars += Math.min(typed, turns[turnIndex].message.length);
      }
      const pct = finished ? 100 : totalChars > 0 ? (chars / totalChars) * 100 : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressTrackRef.current) {
        progressTrackRef.current.setAttribute("aria-valuenow", String(Math.round(pct)));
      }
    };

    // Reaction vocabulary is derived from the turn's kind/vote/emoji —
    // never from hardcoded demo text.
    const queueReactions = (t: MeetingTurn) => {
      const emo = t.emoji ?? null;
      const push = (botId: string, emoji: string | null, type?: StageReactionKind) => {
        s.reactions.push({ botId, emoji, type });
      };
      if (t.kind === "veto") {
        push(t.botId, emo ?? "⛔", "hop");
        for (const b of bots) if (b.id !== t.botId) push(b.id, null, "shake");
      } else if (t.kind === "verdict") {
        if (t.vote === "BUY") {
          push(t.botId, emo ?? "✅", "hop");
          bots.forEach((b, i) => {
            if (b.id !== t.botId) push(b.id, null, i % 2 ? "nod" : "hop");
          });
        } else {
          push(t.botId, emo, "hop");
        }
      } else if (t.kind === "challenge") {
        push(t.botId, emo ?? "⚠️");
      } else if (emo) {
        push(t.botId, emo);
      }
    };

    const renderTyped = () => {
      if (turnIndex < 0 || turnIndex >= turns.length) return;
      const el = textRefs.current.get(turnIndex);
      const len = Math.floor(typed);
      if (el && el.dataset.len !== String(len)) {
        el.dataset.len = String(len);
        el.textContent = turns[turnIndex].message.slice(0, len);
      }
      const bub = bubbleRefs.current.get(turnIndex) ?? null;
      if (bub && s.currentBubble !== bub) s.currentBubble = bub;
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      updateProgress();
    };

    const completeTurn = () => {
      turnDone = true;
      cursorRefs.current.get(turnIndex)?.remove();
      cursorRefs.current.delete(turnIndex);
      const done = turnIndex;
      setDoneSet((prev) => new Set(prev).add(done));
    };

    const activateTurn = (index: number) => {
      turnIndex = index;
      s.turnIndex = index;
      typed = 0;
      charCarry = 0;
      hold = 0;
      turnDone = false;
      const t = turns[index];
      s.activeBotId = t.botId;
      s.currentBubble = null;
      s.playing = playing;
      setVisible((prev) => (prev.includes(index) ? prev : [...prev, index]));
      setActiveIndex(index);
      queueReactions(t);
      s.status =
        `Council in session — ${speakerLabel(t)} speaking` + (symbol ? ` on ${symbol}` : "");
      renderTyped();
      updateProgress();
      setUi({ playing, finished, started: true });
    };

    const closeSession = () => {
      playing = false;
      finished = true;
      s.playing = false;
      s.finished = true;
      s.activeBotId = null;
      s.currentBubble = null;
      setActiveIndex(-1);
      setUi({ playing: false, finished: true, started: true });
      s.status =
        "Session closed" +
        (meeting?.decision ? ` — ${symbol ?? "session"}: ${meeting.decision}` : "");
      updateProgress();
    };

    const resetAndStart = () => {
      textRefs.current.clear();
      bubbleRefs.current.clear();
      cursorRefs.current.clear();
      setVisible([]);
      setDoneSet(new Set());
      turnIndex = -1;
      typed = 0;
      charCarry = 0;
      hold = 0;
      turnDone = false;
      finished = false;
      playing = true;
      s.finished = false;
      s.playing = true;
      s.reactions.length = 0;
      activateTurn(0);
    };

    engineRef.current = {
      play() {
        if (finished) {
          resetAndStart();
          return;
        }
        if (turnIndex < 0) activateTurn(0);
        playing = true;
        s.playing = true;
        setUi({ playing: true, finished, started: true });
      },
      pause() {
        playing = false;
        s.playing = false;
        setUi({ playing: false, finished, started: true });
      },
      replay() {
        resetAndStart();
      },
    };
    setLive(true);

    const loop = (now: number) => {
      if (cancelled) return;
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if (playing && turnIndex >= 0 && !finished) {
        const t = turns[turnIndex];
        const sp = speedRef.current;
        if (typed < t.message.length) {
          charCarry += dt * 36 * sp;
          if (charCarry >= 1) {
            typed = Math.min(t.message.length, typed + Math.floor(charCarry));
            charCarry %= 1;
          }
          renderTyped();
        } else {
          if (!turnDone) completeTurn();
          hold += dt * sp;
          if (hold >= 1.05) {
            if (turnIndex < turns.length - 1) activateTurn(turnIndex + 1);
            else closeSession();
          }
        }
      }
      // The single rAF loop also drives the stage animation.
      stageHandle.current?.tick(now, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, bots]);

  const onSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = parseFloat(e.target.value) || 1;
    setSpeed(v);
    speedRef.current = v;
  };

  return (
    <section className="panel replay" aria-labelledby="replayTitle">
      <div className="panel-head">
        <div>
          <h2 className="section-title" id="replayTitle">Meeting replay</h2>
          <p className="section-note">
            {turns.length > 0
              ? `Recorded council session · ${turns.length} turn${turns.length === 1 ? "" : "s"}` +
                (meeting?.chain ? ` · ${meeting.chain}` : "")
              : "No session recorded"}
          </p>
          {meeting && turns.length > 0 && (
            <span className="decision-pill">
              {meeting.decision} · conviction {Math.round(meeting.conviction)}%
            </span>
          )}
        </div>
        <div className="controls" aria-label="Replay controls">
          <button
            type="button"
            className="control"
            aria-pressed={ui.playing}
            disabled={!live}
            onClick={() => engineRef.current?.play()}
          >
            Play
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={!ui.playing && ui.started && !ui.finished}
            disabled={!live}
            onClick={() => engineRef.current?.pause()}
          >
            Pause
          </button>
          <button
            type="button"
            className="control"
            disabled={!live}
            onClick={() => engineRef.current?.replay()}
          >
            Replay
          </button>
          <label>
            <span className="sr-only">Playback speed</span>
            <select
              className="control"
              aria-label="Playback speed"
              value={speed}
              disabled={!live}
              onChange={onSpeedChange}
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </label>
        </div>
      </div>
      <div
        className="progress-track"
        ref={progressTrackRef}
        role="progressbar"
        aria-label="Meeting replay progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <div className="progress-fill" ref={progressFillRef} />
      </div>
      <div className="transcript" ref={scrollerRef} aria-live="polite">
        {turns.length === 0 ? (
          <div className="empty-state">
            No council decisions yet — the bots are watching the market.
          </div>
        ) : (
          visible.map((i) => {
            const t = turns[i];
            if (!t) return null;
            const color = colorFor(t);
            const done = doneSet.has(i) || reduceRef.current;
            const isActive = i === activeIndex;
            const portrait = portraitFor(t);
            return (
              <article
                key={`${meeting?.at ?? "meeting"}-${i}-${t.botId}`}
                className={
                  `bubble-row${isActive ? " active entering" : ""}` +
                  (t.kind !== "score" ? " system" : "")
                }
                style={cssVars({ "--bot-color": color })}
              >
                <div className="avatar" aria-hidden="true">
                  {portrait ? <img src={portrait} alt="" draggable={false} /> : null}
                </div>
                <div
                  className="bubble"
                  ref={(el) => {
                    if (el) bubbleRefs.current.set(i, el);
                    else bubbleRefs.current.delete(i);
                  }}
                >
                  <div className="bubble-meta">
                    <span className="name-chip">{t.botName}</span>
                    {t.vote && (
                      <span
                        className="vote-badge"
                        style={{
                          color: VOTE_COLORS[t.vote] ?? "#94a3b8",
                          borderColor: `color-mix(in srgb, ${VOTE_COLORS[t.vote] ?? "#94a3b8"} 45%, transparent)`,
                          background: `color-mix(in srgb, ${VOTE_COLORS[t.vote] ?? "#94a3b8"} 10%, transparent)`,
                        }}
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
                        style={{ color: KIND_COLORS[t.kind] ?? "#778582" }}
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
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* P&L — Realized vs Unrealized. Null renders as "—", never invented.  */
/* ------------------------------------------------------------------ */

function PnlSection({ wallet }: { wallet: CouncilRoomData["wallet"] }) {
  const { realizedPnlUsd, unrealizedPnlUsd } = wallet;
  return (
    <section className="section" aria-labelledby="pnlTitle">
      <div className="section-heading">
        <div>
          <h2 id="pnlTitle">Realized vs unrealized P&amp;L</h2>
        </div>
        <p>Only settled fills count as profit.</p>
      </div>
      <div className="panel" style={{ borderRadius: 14, overflow: "hidden" }}>
        <div className="pnl-grid">
          <div className="pnl-figure">
            <span className="figure-label">REALIZED</span>
            <strong className="figure-number">
              {realizedPnlUsd == null ? "—" : <CountUp value={realizedPnlUsd} />}
            </strong>
            <span className="figure-sub">settled paper fills · counted</span>
          </div>
          <div className="pnl-figure unrealized">
            <span className="figure-label">UNREALIZED</span>
            <strong className="figure-number">
              {unrealizedPnlUsd == null ? "—" : <CountUp value={unrealizedPnlUsd} />}
            </strong>
            <span className="figure-sub">open exposure · moves with the market</span>
          </div>
        </div>
        <p className="pnl-rule">Unrealized P&amp;L is tracked, never banked.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Roster — one card per bot from data.bots.                           */
/* ------------------------------------------------------------------ */

function RosterSection({ bots }: { bots: CouncilBotVM[] }) {
  return (
    <section className="section" aria-labelledby="rosterTitle">
      <div className="section-heading">
        <div>
          <h2 id="rosterTitle">Council roster</h2>
        </div>
        <p>
          {bots.length} specialist{bots.length === 1 ? "" : "s"}, one fail-closed decision.
        </p>
      </div>
      <div className="roster">
        {bots.map((b) => {
          const live = b.status === "LIVE";
          const vote = b.latestVote
            ? `${b.latestVote}${b.latestConfidence != null ? ` · ${b.latestConfidence}%` : ""}`
            : "—";
          return (
            <article
              key={b.id}
              className="bot-card"
              style={cssVars({ "--bot-color": b.color || "#94a3b8" })}
              title={b.mission || undefined}
            >
              <div className="bot-card-top">
                <div className="bot-name">
                  {b.portrait ? (
                    <img className="bot-thumb" src={b.portrait} alt="" draggable={false} />
                  ) : null}
                  <span>{b.name}</span>
                </div>
                <span className={`mini-live${live ? "" : " idle"}`}>
                  <i aria-hidden="true" />
                  {b.status}
                </span>
              </div>
              <div className="bot-role">{b.role}</div>
              <div className={`bot-score${b.latestVote ? "" : " dim"}`}>{vote}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats strip — data.stats only, no invented figures.                 */
/* ------------------------------------------------------------------ */

function StatsSection({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <section className="section" aria-labelledby="statsTitle">
      <div className="section-heading">
        <div>
          <h2 id="statsTitle">Evidence base</h2>
        </div>
        <p>What the current record actually supports.</p>
      </div>
      <div className="panel stats">
        {stats.map((s, i) => (
          <div key={i} className="stat">
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Loading + error states                                              */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className="council-room" aria-busy="true" aria-label="Loading council room">
      <header className="shell topbar">
        <div className="identity">
          <h1>Bot War Room</h1>
          <p>Council session companion · paper trading</p>
        </div>
        <div className="statuses" aria-label="Environment status">
          <span className="pill">PAPER ONLY</span>
        </div>
      </header>
      <main className="shell">
        <div className="skel" style={{ height: 560, borderRadius: 20 }} aria-hidden="true" />
        <div className="skel" style={{ height: 320, borderRadius: 12, marginTop: 12 }} aria-hidden="true" />
        <div className="skel" style={{ height: 240, borderRadius: 14, marginTop: 54 }} aria-hidden="true" />
        <div className="skel" style={{ height: 200, borderRadius: 14, marginTop: 54 }} aria-hidden="true" />
      </main>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="council-room">
      <header className="shell topbar">
        <div className="identity">
          <h1>Bot War Room</h1>
          <p>Council session companion · paper trading</p>
        </div>
      </header>
      <main className="shell">
        <div className="panel error-panel" role="alert">
          <h2>Couldn&apos;t load the council room</h2>
          <p>{message || "Something went wrong while fetching council data."}</p>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function CouncilRoomDashboardView({
  data,
  loading,
  error,
}: CouncilRoomDashboardProps) {
  const sync = useRef<ReplaySync>(createReplaySync());
  const stageHandle = useRef<CouncilStageHandle | null>(null);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} />;

  const d: CouncilRoomData = data ?? EMPTY_DATA;
  const meeting = d.meeting;
  const symbol = meeting?.symbol;
  const sessionMark = `SESSION / ${symbol ?? "—"}`;
  const tableLabel = symbol ? `${symbol} / COUNCIL` : "COUNCIL";

  return (
    <div className="council-room">
      <header className="shell topbar">
        <div className="identity">
          <h1>Bot War Room</h1>
          <p>Council session companion · paper trading</p>
        </div>
        <div className="statuses" aria-label="Environment status">
          <span className="pill">PAPER ONLY</span>
          <span className="live-label">
            <span className="dot" aria-hidden="true" />
            LIVE
          </span>
          {d.statusNote ? <span className="status-note">{d.statusNote}</span> : null}
        </div>
      </header>

      <main className="shell">
        <CouncilStage
          bots={d.bots}
          sync={sync}
          ref={stageHandle}
          sessionMark={sessionMark}
          tableLabel={tableLabel}
        />
        <CouncilTranscript
          meeting={meeting}
          bots={d.bots}
          sync={sync}
          stageHandle={stageHandle}
        />
        <PnlSection wallet={d.wallet} />
        {d.equitySeries.length > 0 && (
          <EquityChart
            series={d.equitySeries}
            equityUsd={d.wallet.equityUsd}
            cashUsd={d.wallet.cashUsd}
          />
        )}
        {d.bots.length > 0 && <RosterSection bots={d.bots} />}
        {d.stats.length > 0 && <StatsSection stats={d.stats} />}
      </main>

      <footer className="shell">
        Bot War Room council companion · Paper trading only — nothing here implies
        profitability.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Self-loading default export (used by app/page.tsx)                   */
/* Fetches live War Room state on mount; the view above stays pure.     */
/* ------------------------------------------------------------------ */

export default function CouncilRoomDashboard() {
  const [data, setData] = useState<CouncilRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchCouncilRoomData();
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load council data.");
          setLoading(false);
        }
      }
    })();
    // Refresh on a gentle interval so the room stays live without hammering APIs.
    const timer = setInterval(async () => {
      try {
        const result = await fetchCouncilRoomData();
        if (!cancelled) setData(result);
      } catch {
        /* keep last good data on refresh failure */
      }
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return <CouncilRoomDashboardView data={data} loading={loading} error={error} />;
}
