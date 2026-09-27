"use client";

/**
 * council-room-table.tsx
 *
 * The animated council stage: portrait medallions around a round table,
 * nameplates, ambient dust particles, mobile bot cards, and the curved
 * speech tail that connects the active chat bubble to its speaker.
 *
 * The static structure is rendered declaratively; every per-frame animation
 * runs through the imperative `tick(now, dt)` handle (single rAF loop owned
 * by the transcript replay engine). No React state updates per frame — the
 * loop mutates the DOM directly via refs, with delta-time lerped easing.
 *
 * Animation vocabulary (ported from the concept artifact):
 *  - idle bob with per-bot phase + breathing scale
 *  - talk squash-and-stretch + ±3° wiggle while a bot's turn is active
 *  - head-shake on veto turns, nod/hop on verdict-BUY turns
 *  - idle glances at a random neighbor every 4–9s
 *  - emoji pops (from turn.emoji) with spring-in / fade-out
 *  - ~25 ambient dust particles on canvas
 *  - speaker scale 1.12 + spotlight, others dimmed to 0.85
 */

import { useEffect, useImperativeHandle, useRef } from "react";
import type { CSSProperties, Ref } from "react";
import type { CouncilBotVM, ReplaySync, StageReactionKind } from "@/lib/council-room-types";

export type CouncilStageHandle = {
  /** Advance all stage animation by one frame. Called from the single rAF loop. */
  tick: (now: number, dt: number) => void;
};

/** Build a style object carrying CSS custom properties. */
export function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

type Props = {
  bots: CouncilBotVM[];
  sync: { current: ReplaySync };
  /** Right-hand hero mark, e.g. "SESSION / RUGME". */
  sessionMark: string;
  /** Table center mark, e.g. "RUGME / COUNCIL". */
  tableLabel: string;
  ref?: Ref<CouncilStageHandle>;
};

/* Canonical 8 seats, ported from the concept artifact. NOTE: the artifact
   placed the two front-row portraits (Trader/Referee) at y:36, overlapping
   the back row — their nameplates sat at py:73/77 below the table, so the
   y values were almost certainly a typo for the front row. They are seated
   in front of the table here (y 66/70), matching their nameplates. */
const TABLE_SLOTS = [
  { x: 18, y: 37, px: 17, py: 29 },
  { x: 35, y: 30, px: 36, py: 17 },
  { x: 56, y: 30, px: 60, py: 17 },
  { x: 76, y: 37, px: 81, py: 29 },
  { x: 84, y: 49, px: 88, py: 52 },
  { x: 67, y: 66, px: 70, py: 73 },
  { x: 34, y: 70, px: 43, py: 77 },
  { x: 14, y: 49, px: 13, py: 53 },
];

function slotFor(i: number, n: number) {
  if (n <= TABLE_SLOTS.length) return TABLE_SLOTS[i % TABLE_SLOTS.length];
  // More bots than canonical seats: spread along an ellipse arc.
  const t = n <= 1 ? 0.5 : i / (n - 1);
  const ang = Math.PI * (0.06 + 0.88 * t);
  const x = 50 - 40 * Math.cos(ang);
  const y = 46 - 17 * Math.sin(ang);
  return { x, y, px: 50 - 46 * Math.cos(ang), py: y - 9 };
}

type ElKey =
  | "el" | "shell" | "spot" | "ripple" | "emoji"
  | "plate" | "mobileCard" | "mobilePortrait" | "mobileEmoji";
type ElBundle = Record<ElKey, HTMLElement | null>;

type CharState = ElBundle & {
  botId: string;
  color: string;
  slotX: number;
  active: number;
  focus: number;
  scaleX: number;
  scaleY: number;
  lookStart: number;
  lookDuration: number;
  lookAngle: number;
  nextLook: number;
  reactionType: "" | StageReactionKind;
  reactionStart: number;
  reactionDuration: number;
  emojiStart: number;
  emojiDuration: number;
};

type Mote = {
  x: number; y: number; speed: number; drift: number;
  size: number; alpha: number; phase: number; warm: boolean;
};

type TailState = {
  sx: number; sy: number; ex: number; ey: number;
  tsx: number; tsy: number; tex: number; tey: number;
  opacity: number; ready: boolean; color: string;
};

type AnimBundle = {
  states: CharState[];
  byId: Map<string, CharState>;
  motes: Mote[];
  aw: number;
  ah: number;
  ambient: HTMLCanvasElement | null;
  ambientCtx: CanvasRenderingContext2D | null;
  tail: TailState;
  tailPath: SVGPathElement | null;
  tailDot: SVGCircleElement | null;
  statusEl: HTMLElement | null;
  lastStatus: string;
  mobileQuery: MediaQueryList | null;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function CouncilStage({ bots, sync, sessionMark, tableLabel, ref }: Props) {
  const elsRef = useRef(new Map<string, ElBundle>());
  const animRef = useRef<AnimBundle | null>(null);
  const ambientRef = useRef<HTMLCanvasElement | null>(null);
  const tailPathRef = useRef<SVGPathElement | null>(null);
  const tailDotRef = useRef<SVGCircleElement | null>(null);
  const statusElRef = useRef<HTMLSpanElement | null>(null);
  const botsRef = useRef(bots);
  botsRef.current = bots;

  const setRef = (id: string, key: ElKey) => (el: HTMLElement | null) => {
    const map = elsRef.current;
    let b = map.get(id);
    if (!b) {
      b = {
        el: null, shell: null, spot: null, ripple: null, emoji: null,
        plate: null, mobileCard: null, mobilePortrait: null, mobileEmoji: null,
      };
      map.set(id, b);
    }
    b[key] = el;
    if (!el && (Object.keys(b) as ElKey[]).every((k) => b![k] === null)) map.delete(id);
  };

  /* Build per-bot animation state once the DOM is committed. */
  useEffect(() => {
    const states: CharState[] = [];
    const byId = new Map<string, CharState>();
    botsRef.current.forEach((bot, i) => {
      const bundle = elsRef.current.get(bot.id);
      if (!bundle || !bundle.el) return;
      const slot = slotFor(i, botsRef.current.length);
      states.push({
        ...bundle,
        botId: bot.id,
        color: bot.color || "#94a3b8",
        slotX: slot.x,
        active: 0, focus: 1, scaleX: 1, scaleY: 1,
        lookStart: 0, lookDuration: 0, lookAngle: 0,
        nextLook: performance.now() * 0.001 + 4 + Math.random() * 5,
        reactionType: "", reactionStart: 0, reactionDuration: 0,
        emojiStart: 0, emojiDuration: 0,
      });
      byId.set(bot.id, states[states.length - 1]);
    });

    const motes: Mote[] = Array.from({ length: 25 }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      speed: 6 + Math.random() * 11, drift: 5 + Math.random() * 8,
      size: 0.7 + Math.random() * 1.45, alpha: 0.12 + Math.random() * 0.24,
      phase: Math.random() * Math.PI * 2, warm: i % 4 === 0,
    }));

    const ambient = ambientRef.current;
    animRef.current = {
      states, byId, motes, aw: 0, ah: 0,
      ambient,
      ambientCtx: ambient ? ambient.getContext("2d") : null,
      tail: {
        sx: 0, sy: 0, ex: 0, ey: 0, tsx: 0, tsy: 0, tex: 0, tey: 0,
        opacity: 0, ready: false, color: "#5eead4",
      },
      tailPath: tailPathRef.current,
      tailDot: tailDotRef.current,
      statusEl: statusElRef.current,
      lastStatus: "",
      mobileQuery:
        typeof window !== "undefined" ? window.matchMedia("(max-width: 720px)") : null,
    };
    resizeAmbient();
    window.addEventListener("resize", resizeAmbient, { passive: true });
    return () => {
      window.removeEventListener("resize", resizeAmbient);
      animRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots]);

  function resizeAmbient() {
    const A = animRef.current;
    if (!A || !A.ambient || !A.ambientCtx) return;
    const r = A.ambient.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    A.aw = r.width;
    A.ah = r.height;
    A.ambient.width = Math.max(1, Math.round(r.width * ratio));
    A.ambient.height = Math.max(1, Math.round(r.height * ratio));
    A.ambientCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawAmbient(A: AnimBundle, now: number, dt: number, reduce: boolean) {
    const ctx = A.ambientCtx;
    if (!ctx || !A.aw || !A.ah) return;
    if (reduce) {
      ctx.clearRect(0, 0, A.aw, A.ah);
      return;
    }
    ctx.clearRect(0, 0, A.aw, A.ah);
    ctx.globalCompositeOperation = "lighter";
    for (const m of A.motes) {
      m.y -= (m.speed * dt) / A.ah;
      if (m.y < -0.04) {
        m.y = 1.04;
        m.x = Math.random();
      }
      const x = m.x * A.aw + Math.sin(now * 0.00055 + m.phase) * m.drift;
      const y = m.y * A.ah;
      const twinkle = 0.62 + 0.38 * Math.sin(now * 0.0011 + m.phase * 1.7);
      ctx.beginPath();
      ctx.arc(x, y, m.size, 0, Math.PI * 2);
      ctx.fillStyle = m.warm
        ? `rgba(255,213,145,${(m.alpha * twinkle).toFixed(3)})`
        : `rgba(102,225,210,${(m.alpha * twinkle).toFixed(3)})`;
      ctx.shadowColor = m.warm ? "rgba(255,205,125,.55)" : "rgba(70,207,190,.5)";
      ctx.shadowBlur = 7;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }

  function animateChars(
    A: AnimBundle, now: number, nowSec: number, dt: number,
    s: ReplaySync, reduce: boolean,
  ) {
    const n = A.states.length;
    const speakerId = s.playing && !s.finished ? s.activeBotId : null;
    const ease = 1 - Math.exp(-dt * 13);
    const focusEase = 1 - Math.exp(-dt * 7.5);

    A.states.forEach((st, i) => {
      const isSpeaker = speakerId != null && st.botId === speakerId;
      const activeTarget = s.playing && !s.finished && isSpeaker ? 1 : 0;
      const focusTarget = s.playing && !s.finished ? (isSpeaker ? 1 : 0.85) : 1;
      st.active += (activeTarget - st.active) * ease;
      st.focus += (focusTarget - st.focus) * focusEase;

      // Idle glances at a random neighbor every 4–9s.
      let look = 0;
      if (!reduce && n > 1) {
        if (nowSec >= st.nextLook && st.lookDuration === 0) {
          const neighbor = (i + (Math.random() < 0.5 ? -1 : 1) + n) % n;
          st.lookStart = nowSec;
          st.lookDuration = 1.25 + Math.random() * 0.65;
          st.lookAngle =
            (A.states[neighbor].slotX > st.slotX ? 1 : -1) * (1.8 + Math.random() * 1.7);
        }
        if (st.lookDuration > 0) {
          const lp = (nowSec - st.lookStart) / st.lookDuration;
          if (lp >= 1) {
            st.lookDuration = 0;
            st.nextLook = nowSec + 4 + Math.random() * 5;
          } else {
            look = Math.sin(Math.PI * clamp(lp, 0, 1)) * st.lookAngle;
          }
        }
      }

      // One-shot reactions: shake (veto), nod / hop (verdict BUY).
      let reactionRot = 0;
      let reactionY = 0;
      let reactionScale = 0;
      if (st.reactionType && !reduce) {
        const rp = (nowSec - st.reactionStart) / st.reactionDuration;
        if (rp >= 1) {
          st.reactionType = "";
        } else if (rp >= 0) {
          if (st.reactionType === "shake") {
            reactionRot = Math.sin(rp * Math.PI * 4) * 8 * (1 - rp * 0.28);
          }
          if (st.reactionType === "nod") {
            reactionY = Math.pow(Math.max(0, Math.sin(rp * Math.PI * 4)), 1.15) * 7;
          }
          if (st.reactionType === "hop") {
            reactionScale = Math.sin(rp * Math.PI) * 0.15;
            reactionY = -Math.sin(rp * Math.PI) * 7;
          }
        }
      }

      const idleBob = reduce ? 0 : Math.sin(now * 0.00116 + i * 0.83) * 2.45;
      const breathe = reduce ? 0 : Math.sin(now * 0.00096 + i * 1.17) * 0.012;
      const talkPhase =
        now * 0.001 * Math.PI * 2 * (3.45 + (Math.max(0, s.turnIndex) % 3) * 0.28) + i * 0.6;
      const beat = reduce ? 0 : Math.pow(Math.max(0, Math.sin(talkPhase)), 1.6) * st.active;
      const bounce = -beat * 13 + reactionY;
      const base = 1 + st.active * 0.12 + reactionScale;
      const targetX = base + breathe + beat * 0.105;
      const targetY = base + breathe - beat * 0.075;
      st.scaleX += (targetX - st.scaleX) * ease;
      st.scaleY += (targetY - st.scaleY) * ease;
      const totalRotation = look + reactionRot + Math.sin(talkPhase) * st.active * 3;

      if (st.el) {
        st.el.style.transform =
          `translate(-50%,-50%) translateY(${(idleBob + bounce).toFixed(2)}px) ` +
          `scale(${st.scaleX.toFixed(4)},${st.scaleY.toFixed(4)})`;
        st.el.style.opacity = st.focus.toFixed(3);
        st.el.style.setProperty("--active", st.active.toFixed(3));
      }
      if (st.shell) st.shell.style.transform = `rotate(${totalRotation.toFixed(2)}deg)`;
      if (st.plate) st.plate.style.setProperty("--active", st.active.toFixed(3));
      if (st.mobilePortrait) {
        st.mobilePortrait.style.transform =
          `translateY(${(idleBob * 0.42 + bounce * 0.78).toFixed(2)}px) ` +
          `rotate(${totalRotation.toFixed(2)}deg) ` +
          `scale(${st.scaleX.toFixed(4)},${st.scaleY.toFixed(4)})`;
      }
      if (st.mobileCard) {
        st.mobileCard.style.opacity = st.focus.toFixed(3);
        st.mobileCard.style.setProperty("--active", st.active.toFixed(3));
      }
      if (st.spot) {
        st.spot.style.opacity = (st.active * 0.98).toFixed(3);
        st.spot.style.transform = `scale(${(0.92 + st.active * 0.22 + beat * 0.09).toFixed(3)})`;
      }
      if (st.ripple) {
        const ripplePhase = (now * 0.00092 + i * 0.11) % 1;
        st.ripple.style.opacity = (st.active * (1 - ripplePhase) * 0.82).toFixed(3);
        st.ripple.style.transform = `scale(${(0.84 + ripplePhase * 0.64).toFixed(3)})`;
      }

      // Emoji pops: spring-in, hold, fade-out.
      if (st.emojiDuration && st.emoji && st.mobileEmoji) {
        const pp = (nowSec - st.emojiStart) / st.emojiDuration;
        if (pp >= 1) {
          st.emojiDuration = 0;
          st.emoji.style.opacity = "0";
          st.mobileEmoji.style.opacity = "0";
        } else if (pp >= 0) {
          const q = Math.min(1, pp / 0.28);
          const u = q - 1;
          const spring = 1 + 2.70158 * u * u * u + 1.70158 * u * u;
          const fade = pp < 0.72 ? 1 : Math.max(0, 1 - (pp - 0.72) / 0.28);
          const lift = -10 * pp;
          const tf =
            `translate(-50%,${(7 + lift).toFixed(2)}px) ` +
            `scale(${Math.max(0, spring).toFixed(3)})`;
          for (const elm of [st.emoji, st.mobileEmoji]) {
            elm.style.opacity = fade.toFixed(3);
            elm.style.transform = tf;
          }
        }
      }
    });
  }

  function updateTailTarget(A: AnimBundle, s: ReplaySync) {
    const t = A.tail;
    if (!s.currentBubble || s.finished || s.reduceMotion) return;
    const st = A.byId.get(s.activeBotId ?? "");
    if (!st || !st.el) return;
    const mobile = A.mobileQuery ? A.mobileQuery.matches : false;
    const target = mobile && st.mobilePortrait ? st.mobilePortrait : st.el;
    const b = s.currentBubble.getBoundingClientRect();
    const c = target.getBoundingClientRect();
    t.tsx = Math.min(b.right - 18, b.left + 42);
    t.tsy = b.top + 4;
    t.tex = c.left + c.width * 0.5;
    t.tey = c.top + c.height * 0.45;
    t.color = st.color;
    if (!t.ready) {
      t.sx = t.tsx; t.sy = t.tsy; t.ex = t.tex; t.ey = t.tey;
      t.ready = true;
    }
  }

  function animateTail(A: AnimBundle, dt: number, s: ReplaySync, reduce: boolean) {
    const t = A.tail;
    const wants = s.playing && !s.finished && s.currentBubble && !reduce ? 1 : 0;
    if (wants) updateTailTarget(A, s);
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    const visible =
      wants && t.tey > -40 && t.tey < vh + 40 && t.tsy > -40 && t.tsy < vh + 40 ? 1 : 0;
    const k = 1 - Math.exp(-dt * 10);
    t.opacity += (visible - t.opacity) * k;
    if (!t.ready) return;
    t.sx += (t.tsx - t.sx) * k;
    t.sy += (t.tsy - t.sy) * k;
    t.ex += (t.tex - t.ex) * k;
    t.ey += (t.tey - t.ey) * k;
    const bend = Math.max(34, Math.abs(t.sy - t.ey) * 0.34);
    const c1y = t.sy - bend;
    const c2y = t.ey + bend * 0.45;
    if (A.tailPath) {
      A.tailPath.setAttribute(
        "d",
        `M ${t.sx.toFixed(1)} ${t.sy.toFixed(1)} C ${t.sx.toFixed(1)} ${c1y.toFixed(1)}, ` +
          `${t.ex.toFixed(1)} ${c2y.toFixed(1)}, ${t.ex.toFixed(1)} ${t.ey.toFixed(1)}`,
      );
      A.tailPath.setAttribute("stroke", t.color);
      A.tailPath.setAttribute("opacity", (t.opacity * 0.72).toFixed(3));
    }
    if (A.tailDot) {
      A.tailDot.setAttribute("cx", t.ex.toFixed(1));
      A.tailDot.setAttribute("cy", t.ey.toFixed(1));
      A.tailDot.setAttribute("fill", t.color);
      A.tailDot.setAttribute("opacity", (t.opacity * 0.8).toFixed(3));
    }
  }

  const tick = (now: number, dt: number) => {
    const A = animRef.current;
    if (!A) return;
    const s = sync.current;

    if (A.statusEl && s.status !== A.lastStatus) {
      A.lastStatus = s.status;
      A.statusEl.textContent = s.status;
    }

    // Drain one-shot reactions queued by the replay engine.
    if (s.reactions.length > 0) {
      const nowSec = now * 0.001;
      const queued = s.reactions.splice(0, s.reactions.length);
      for (const q of queued) {
        const st = A.byId.get(q.botId);
        if (!st) continue;
        if (q.emoji) {
          if (st.emoji) st.emoji.textContent = q.emoji;
          if (st.mobileEmoji) st.mobileEmoji.textContent = q.emoji;
          st.emojiStart = nowSec;
          st.emojiDuration = 1.5;
        }
        if (q.type) {
          st.reactionType = q.type;
          st.reactionStart = nowSec;
          st.reactionDuration = q.type === "shake" ? 0.78 : q.type === "nod" ? 0.82 : 0.6;
        }
      }
    }

    const reduce = s.reduceMotion;
    drawAmbient(A, now, dt, reduce);
    animateChars(A, now, now * 0.001, dt, s, reduce);
    animateTail(A, dt, s, reduce);
  };

  useImperativeHandle(ref, () => ({ tick }));

  return (
    <section className="panel hero" aria-labelledby="councilSessionStatus">
      <div className="hero-head">
        <div className="session-label">
          <span className="pulse" aria-hidden="true" />
          <span className="session-status" id="councilSessionStatus" ref={statusElRef} />
        </div>
        <span className="token-mark">{sessionMark}</span>
      </div>
      <div className="canvas-wrap">
        <div
          className="council-stage"
          role="img"
          aria-label="Animated council member portraits seated around a round table"
        >
          <canvas className="ambient-particles" aria-hidden="true" ref={ambientRef} />
          <div className="nib-layer">
            {bots.map((bot, i) => {
              const slot = slotFor(i, bots.length);
              return (
                <div
                  key={bot.id}
                  className="nib"
                  data-bot={bot.id}
                  ref={setRef(bot.id, "el")}
                  style={cssVars({
                    "--x": `${slot.x}%`,
                    "--y": `${slot.y}%`,
                    "--bot-color": bot.color || "#94a3b8",
                  })}
                >
                  <div className="portrait-shell" ref={setRef(bot.id, "shell")}>
                    <span className="portrait-spotlight" ref={setRef(bot.id, "spot")} />
                    <span className="portrait-ripple" ref={setRef(bot.id, "ripple")} />
                    <span className="reaction-pop" aria-hidden="true" ref={setRef(bot.id, "emoji")} />
                    <div className="portrait-frame">
                      <img src={bot.portrait} alt={`${bot.name}, ${bot.role}`} draggable={false} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="round-table">
            <span className="table-center">{tableLabel}</span>
            {bots.map((bot, i) => {
              const slot = slotFor(i, bots.length);
              return (
                <span
                  key={bot.id}
                  className="nameplate"
                  data-bot={bot.id}
                  ref={setRef(bot.id, "plate")}
                  style={cssVars({
                    "--px": `${slot.px}%`,
                    "--py": `${slot.py}%`,
                    "--bot-color": bot.color || "#94a3b8",
                  })}
                >
                  {bot.name}
                  <small>{bot.role}</small>
                </span>
              );
            })}
          </div>
        </div>
        <div className="mobile-council" aria-label="Council members">
          {bots.map((bot) => {
            const live = bot.status === "LIVE";
            const voteLabel = bot.latestVote
              ? `${bot.latestVote}${bot.latestConfidence != null ? ` ${bot.latestConfidence}%` : ""}`
              : "—";
            return (
              <article
                key={bot.id}
                className="mobile-bot"
                data-bot={bot.id}
                ref={setRef(bot.id, "mobileCard")}
                style={cssVars({ "--bot-color": bot.color || "#94a3b8" })}
              >
                <div className="mobile-portrait" ref={setRef(bot.id, "mobilePortrait")}>
                  <span className="reaction-pop" aria-hidden="true" ref={setRef(bot.id, "mobileEmoji")} />
                  <img src={bot.portrait} alt="" draggable={false} />
                </div>
                <div className="mobile-bot-name">{bot.name}</div>
                <div className="mobile-bot-role">{bot.role}</div>
                <div className="mobile-bot-foot">
                  <span className={`mobile-live${live ? "" : " idle"}`}>
                    <i aria-hidden="true" />
                    {bot.status}
                  </span>
                  <span>{voteLabel}</span>
                </div>
                <div className="speaking-indicator">speaking</div>
              </article>
            );
          })}
        </div>
      </div>
      <svg className="speech-tail" aria-hidden="true">
        <path ref={tailPathRef} fill="none" strokeLinecap="round" strokeWidth={2} />
        <circle ref={tailDotRef} r={3} stroke="none" />
      </svg>
    </section>
  );
}
