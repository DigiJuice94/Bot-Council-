import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.28-exit-history] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.28-exit-history] patched ${rel}`);
}
function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyV228ExitHistoryPatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;

    if (!text.includes("lastHighWaterAt?: string;")) {
      text = replaceRequired(
        text,
        "  breakEvenArmed?: boolean;\n  pendingScaleLabel?: string;",
        `  breakEvenArmed?: boolean;
  lastHighWaterAt?: string;
  peakPnlPct?: number;
  exitStrategistScore?: number;
  exitStrategistReason?: string;
  pendingScaleLabel?: string;`,
        "ManagedPosition exit strategist fields",
      );
    }

    if (!text.includes("export type PaperEquityHistoryPoint = {")) {
      text = replaceRequired(
        text,
        "export type PaperWalletState = {",
        `export type PaperEquityHistoryPoint = {
  at: number;
  equity: number;
  cash: number;
  openValue: number;
  event?: "mark" | "peak" | "low" | "reset";
};

export type PaperWalletState = {`,
        "Paper equity history type",
      );
    }

    if (!text.includes("equityHistory?: PaperEquityHistoryPoint[];")) {
      text = replaceRequired(
        text,
        "  dayStartEquityUsd: number;\n  recentFills: PaperWalletFillRecord[];",
        `  dayStartEquityUsd: number;
  equityHistory?: PaperEquityHistoryPoint[];
  allTimeHighEquityUsd?: number;
  allTimeHighAt?: string;
  allTimeLowEquityUsd?: number;
  allTimeLowAt?: string;
  recentFills: PaperWalletFillRecord[];`,
        "Paper wallet persistent all-time fields",
      );
    }

    return text;
  });

  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;

    text = text.replace("const MAX_FILL_HISTORY = 250;", `const MAX_FILL_HISTORY = 5_000;
const MAX_EQUITY_HISTORY = 100_000;
const EQUITY_HISTORY_INTERVAL_MS = 10 * 60_000;
const EQUITY_HISTORY_SIGNIFICANT_MOVE_PCT = 0.5;`);

    if (!text.includes("function updatePersistentEquityHistory(")) {
      const anchor = "async function calculateSnapshot(stateInput: PaperWalletState, storage: \"redis\" | \"memory\"): Promise<PaperWalletSnapshot> {";
      if (!text.includes(anchor)) fail("Could not find calculateSnapshot anchor");
      const helper = `function updatePersistentEquityHistory(state: PaperWalletState, equityUsd: number, openExposureUsd: number) {
  const nowMs = Date.now();
  const history = state.equityHistory ?? [];
  const last = history[history.length - 1];
  const previousHigh = state.allTimeHighEquityUsd ?? state.startingCashUsd;
  const previousLow = state.allTimeLowEquityUsd ?? state.startingCashUsd;
  const newHigh = equityUsd > previousHigh + 0.005;
  const newLow = equityUsd < previousLow - 0.005;
  const elapsed = last ? nowMs - last.at : Number.POSITIVE_INFINITY;
  const movePct = last && last.equity > 0 ? Math.abs(equityUsd - last.equity) / last.equity * 100 : 100;
  const shouldRecord = !last || elapsed >= EQUITY_HISTORY_INTERVAL_MS || movePct >= EQUITY_HISTORY_SIGNIFICANT_MOVE_PCT || newHigh || newLow;
  if (!shouldRecord) return { state, changed: false };

  const event = newHigh ? "peak" as const : newLow ? "low" as const : "mark" as const;
  const point = {
    at: nowMs,
    equity: Number(equityUsd.toFixed(2)),
    cash: Number(state.cashUsd.toFixed(2)),
    openValue: Number(openExposureUsd.toFixed(2)),
    event,
  };
  return {
    changed: true,
    state: {
      ...state,
      equityHistory: [...history, point].slice(-MAX_EQUITY_HISTORY),
      allTimeHighEquityUsd: Number(Math.max(previousHigh, equityUsd).toFixed(2)),
      allTimeHighAt: newHigh ? new Date(nowMs).toISOString() : state.allTimeHighAt,
      allTimeLowEquityUsd: Number(Math.min(previousLow, equityUsd).toFixed(2)),
      allTimeLowAt: newLow ? new Date(nowMs).toISOString() : state.allTimeLowAt,
    },
  };
}

`;
      text = text.replace(anchor, helper + anchor);
    }

    if (!text.includes("equityHistory: [{ at: Date.parse(now)")) {
      text = replaceRequired(
        text,
        "    dayStartEquityUsd: startingCashUsd,\n    recentFills: [],",
        `    dayStartEquityUsd: startingCashUsd,
    equityHistory: [{ at: Date.parse(now), equity: startingCashUsd, cash: startingCashUsd, openValue: 0, event: "mark" }],
    allTimeHighEquityUsd: startingCashUsd,
    allTimeHighAt: now,
    allTimeLowEquityUsd: startingCashUsd,
    allTimeLowAt: now,
    recentFills: [],`,
        "fresh wallet persistent history",
      );
    }

    const equityAnchor = "  const equityUsd = Math.max(0, state.cashUsd + openExposureUsd);\n\n  const today = dayKey();";
    if (!text.includes("const historyUpdate = updatePersistentEquityHistory")) {
      text = replaceRequired(
        text,
        equityAnchor,
        `  const equityUsd = Math.max(0, state.cashUsd + openExposureUsd);
  const historyUpdate = updatePersistentEquityHistory(state, equityUsd, openExposureUsd);
  state = historyUpdate.state;

  const today = dayKey();`,
        "record persistent equity history",
      );
    }

    const dayBlock = `  if (state.dayKey !== today) {
    state = { ...state, dayKey: today, dayStartEquityUsd: equityUsd, updatedAt: new Date().toISOString() };
    await writeState(state);
  }`;
    if (text.includes(dayBlock) && !text.includes("else if (historyUpdate.changed)")) {
      text = text.replace(
        dayBlock,
        `  if (state.dayKey !== today) {
    state = { ...state, dayKey: today, dayStartEquityUsd: equityUsd, updatedAt: new Date().toISOString() };
    await writeState(state);
  } else if (historyUpdate.changed) {
    await writeState(state);
  }`,
      );
    }

    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;

    if (!text.includes('from "./exit-strategy-bot"')) {
      const importAnchor = 'import { reflectOnClosedPosition } from "./reflection";';
      text = replaceRequired(
        text,
        importAnchor,
        `${importAnchor}
import { evaluateExitStrategist, profitFirstExitStrategy } from "./exit-strategy-bot";`,
        "Exit Strategist import",
      );
    }

    if (!text.includes("exitStrategy: profitFirstExitStrategy(position.exitStrategy)")) {
      text = replaceRequired(
        text,
        "    breakEvenArmed: Boolean(position.breakEvenArmed),\n  };",
        `    breakEvenArmed: Boolean(position.breakEvenArmed),
    exitStrategy: profitFirstExitStrategy(position.exitStrategy),
    lastHighWaterAt: position.lastHighWaterAt ?? position.openedAt,
    peakPnlPct: safe(position.peakPnlPct, position.maxFavorableExcursionPct),
    exitStrategistScore: safe(position.exitStrategistScore),
    exitStrategistReason: position.exitStrategistReason ?? "",
  };`,
        "normalize all positions into profit-first strategy",
      );
    }

    // Make trims executable enough to model taking profit in thin meme pools.
    text = text.replace(
      /maxSlippageBps:\s*side === "BUY"\s*\?[^,\n]+:\s*suffix === "EXIT"\s*\?[^,\n]+:[^,\n]+,/,
      'maxSlippageBps: side === "BUY" ? Number(process.env.PAPER_EARLY_RUNNER_MAX_SLIPPAGE_BPS ?? 600) : suffix === "EXIT" ? 9000 : Number(process.env.PAPER_PROFIT_TAKE_MAX_SLIPPAGE_BPS ?? 2000),',
    );

    if (!text.includes("lastHighWaterAt: now,")) {
      text = replaceRequired(
        text,
        "    breakEvenArmed: false,\n    exitStrategy,",
        `    breakEvenArmed: false,
    lastHighWaterAt: now,
    peakPnlPct: Math.max(0, ((snapshot.price - fill.fillPrice) / Math.max(fill.fillPrice, 1e-12)) * 100),
    exitStrategistScore: 50,
    exitStrategistReason: "Exit Strategist armed on entry.",
    exitStrategy: profitFirstExitStrategy(exitStrategy),`,
        "arm Exit Strategist on entry",
      );
    }

    if (!text.includes("const exitStrategist = evaluateExitStrategist")) {
      const controlsAnchor = "  const controls = effectiveGuardianControls(position, winnerState);";
      text = replaceRequired(
        text,
        controlsAnchor,
        `${controlsAnchor}
  const exitStrategist = evaluateExitStrategist({ position, snapshot, portfolio, exitGenome });`,
        "Exit Strategist evaluates every Guardian mark",
      );
    }

    if (!text.includes("const activeTrailingStopPct = Math.min(genomeTrailingStopPct, exitStrategist.trailingStopPct);")) {
      const genomeControls = `  const genomeTrailingStopPct = exitGenome ? Math.max(6, Math.min(40, exitGenome.trailingStopPct)) : controls.trailingStopPct;
  const genomeMaxHoldMinutes = exitGenome ? Math.max(15, controls.maxHoldMinutes * exitGenome.maxHoldMultiplier) : controls.maxHoldMinutes;`;
      if (!text.includes(genomeControls)) fail("Could not find Exit Genome control block");
      text = text.replace(
        genomeControls,
        `${genomeControls}
  const activeTrailingStopPct = Math.min(genomeTrailingStopPct, exitStrategist.trailingStopPct);
  const activeMaxHoldMinutes = Math.min(genomeMaxHoldMinutes, exitStrategist.maxHoldMinutes);`,
      );
    }

    text = text.replace(
      "  const trailTriggered = rawMovePct > 0 && drawdownFromHigh >= genomeTrailingStopPct;",
      "  const trailTriggered = rawMovePct > 0 && drawdownFromHigh >= activeTrailingStopPct;",
    );
    text = text.replace(
      "  const timeTriggered = heldMinutes >= genomeMaxHoldMinutes;",
      "  const timeTriggered = heldMinutes >= activeMaxHoldMinutes;",
    );

    if (!text.includes('const strategistExitTriggered = exitStrategist.action === "EXIT";')) {
      const genomeExitDecl = '  const genomeExitTriggered = exitGenome?.action === "EXIT";';
      text = replaceRequired(
        text,
        genomeExitDecl,
        `${genomeExitDecl}
  const strategistExitTriggered = exitStrategist.action === "EXIT";`,
        "Exit Strategist trigger",
      );
    }

    if (!text.includes("Exit Strategist requested capital/profit protection exit.")) {
      const genomeBranch = `  } else if (genomeExitTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = exitGenome?.reason ?? "Exit Genome invalidated runner continuation.";
  } else if (stopTriggered) {`;
      if (!text.includes(genomeBranch)) fail("Could not find Exit Genome branch");
      text = text.replace(
        genomeBranch,
        `  } else if (strategistExitTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = exitStrategist.reason || "Exit Strategist requested capital/profit protection exit.";
  } else if (genomeExitTriggered) {
    lastAction = "EXIT";
    status = "exit_pending";
    lastReason = exitGenome?.reason ?? "Exit Genome invalidated runner continuation.";
  } else if (stopTriggered) {`,
      );
    }

    text = text.replace(
      /`Exit: \$\{winnerState\} trailing stop \$\{genomeTrailingStopPct\.toFixed\(1\)\}% from high-water triggered\.`/,
      '`Exit Strategist: ${winnerState} trailing stop ${activeTrailingStopPct.toFixed(1)}% from high-water triggered.`',
    );
    text = text.replace(
      /`Exit: \$\{winnerState\} max hold \$\{genomeMaxHoldMinutes\} minutes reached\.`/,
      '`Exit Strategist: ${winnerState} max useful hold ${activeMaxHoldMinutes.toFixed(0)} minutes reached.`',
    );

    if (!text.includes("const madeNewHigh = mark > position.highWaterPrice * 1.0005;")) {
      const highAnchor = "  const highWater = Math.max(position.highWaterPrice, mark);\n  const lowWater = Math.min(position.lowWaterPrice, mark);";
      text = replaceRequired(
        text,
        highAnchor,
        `  const highWater = Math.max(position.highWaterPrice, mark);
  const lowWater = Math.min(position.lowWaterPrice, mark);
  const madeNewHigh = mark > position.highWaterPrice * 1.0005;
  const lastHighWaterAt = madeNewHigh ? now : (position.lastHighWaterAt ?? position.openedAt);`,
        "track time since last high",
      );
    }

    if (!text.includes("exitStrategistScore: exitStrategist.score,")) {
      text = replaceRequired(
        text,
        "    breakEvenArmed,\n    pendingScaleLabel,",
        `    breakEvenArmed,
    lastHighWaterAt,
    peakPnlPct: Number(Math.max(position.peakPnlPct ?? 0, rawMovePct).toFixed(3)),
    exitStrategistScore: exitStrategist.score,
    exitStrategistReason: exitStrategist.reason,
    pendingScaleLabel,`,
        "persist Exit Strategist state",
      );
    }

    return text;
  });

  patchFile(root, "components/WarRoomDashboard.tsx", (input) => {
    let text = input;

    const oldHistory = `    setEquityHistory((current) => {
      const next = [...current, { at: now, equity: status.paperWallet.equityUsd, cash: status.paperWallet.cashUsd, openValue }];
      return next.slice(-2880);
    });`;
    const newHistory = `    setEquityHistory((current) => {
      const persisted = status.paperWallet.equityHistory ?? [];
      const live = { at: now, equity: status.paperWallet.equityUsd, cash: status.paperWallet.cashUsd, openValue };
      const merged = [...persisted, ...current, live];
      const byTimestamp = new Map<number, EquityHistoryPoint>();
      for (const point of merged) byTimestamp.set(point.at, point);
      return [...byTimestamp.values()].sort((a, b) => a.at - b.at).slice(-100_000);
    });`;
    if (text.includes(oldHistory)) text = text.replace(oldHistory, newHistory);
    else if (!text.includes("const persisted = status.paperWallet.equityHistory ?? [];")) fail("Could not find dashboard equity history block");

    text = text.replace(
      "  const mainGraphHigh = selectedGraphPosition ? selectedGraphPosition.highWaterPrice : undefined;",
      "  const mainGraphHigh = selectedGraphPosition ? selectedGraphPosition.highWaterPrice : (status?.paperWallet?.allTimeHighEquityUsd ?? (equityHistory.length ? Math.max(...equityHistory.map((point) => point.equity)) : undefined));",
    );

    if (!text.includes("const allTimePortfolioDrawdownPct")) {
      const pnlAnchor = "  const mainGraphPositive = mainGraphPnlPct >= 0;";
      text = replaceRequired(
        text,
        pnlAnchor,
        `${pnlAnchor}
  const allTimePortfolioHigh = status?.paperWallet?.allTimeHighEquityUsd ?? (equityHistory.length ? Math.max(...equityHistory.map((point) => point.equity)) : (status?.paperWallet?.equityUsd ?? 0));
  const allTimePortfolioDrawdownPct = allTimePortfolioHigh > 0 ? ((allTimePortfolioHigh - (status?.paperWallet?.equityUsd ?? 0)) / allTimePortfolioHigh * 100) : 0;`,
        "portfolio all-time high stats",
      );
    }

    text = text.replace(
      '<span><small>{selectedGraphPosition ? "HIGH" : "CASH"}</small><b>{compactGraphValue(selectedGraphPosition ? (mainGraphHigh ?? mainGraphCurrent) : (status?.paperWallet?.cashUsd ?? 0), true)}</b></span>',
      '<span><small>{selectedGraphPosition ? "HIGH" : "ALL-TIME HIGH"}</small><b>{compactGraphValue(selectedGraphPosition ? (mainGraphHigh ?? mainGraphCurrent) : allTimePortfolioHigh, true)}</b></span>{!selectedGraphPosition && <span><small>FROM HIGH</small><b className={allTimePortfolioDrawdownPct <= 0.1 ? "positive" : "negative"}>-{allTimePortfolioDrawdownPct.toFixed(2)}%</b></span>}',
    );

    if (!text.includes("EXIT STRATEGIST · ACTIVE")) {
      const auditClose = `        </div>

        <div className="portfolio-market-layout">`;
      text = replaceRequired(
        text,
        auditClose,
        `        </div>

        <div className="exit-strategist-live">
          <b>EXIT STRATEGIST · ACTIVE</b>
          <span>Checks every open position every Guardian cycle · banks 20% @ +25% · 20% @ +50% · 25% @ +100% · 25% @ +200% · 10% moonbag</span>
          <small>Dead trades and stale capital are recycled so fresh runners can keep getting funded.</small>
        </div>

        <div className="portfolio-market-layout">`,
        "Exit Strategist dashboard banner",
      );
    }

    text = text.replace(
      '<span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span>',
      '<span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span><span><small>All-time high</small><b>${(status?.paperWallet?.allTimeHighEquityUsd ?? status?.paperWallet?.equityUsd ?? 0).toFixed(2)}</b></span>',
    );

    text = text.replaceAll("Bot War Room V2.27", "Bot War Room V2.28");
    text = text.replace(
      "Guardian marks positions to market, scales confirmed winners, trims, exits and returns simulated proceeds to cash.",
      "Guardian marks positions to market while the dedicated Exit Strategist banks profits, kills dead trades, recycles stale capital and returns simulated proceeds to cash.",
    );

    return text;
  });

  patchFile(root, "app/v214.css", (input) => {
    let text = input;
    if (!text.includes(".exit-strategist-live{")) {
      text += `
/* V2.28 — dedicated Exit Strategist */
.exit-strategist-live{
  margin:12px 0 16px;
  display:grid;
  grid-template-columns:auto 1fr auto;
  gap:12px;
  align-items:center;
  padding:11px 14px;
  border:1px solid #dfe8e3;
  border-radius:14px;
  background:#f8fcfa;
}
.exit-strategist-live b{font-size:9px;letter-spacing:.08em;color:#15734f}
.exit-strategist-live span{font-size:10px;color:#30363d}
.exit-strategist-live small{font-size:9px;color:#7a828c;text-align:right}
@media(max-width:800px){
  .exit-strategist-live{grid-template-columns:1fr}
  .exit-strategist-live small{text-align:left}
}
`;
    }
    return text;
  });

  console.log("[v2.28-exit-history] Profit-first Exit Strategist active and portfolio equity history is now persisted server-side.");
}
