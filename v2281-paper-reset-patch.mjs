import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.28.1-paper-reset] ${message}`);
  process.exit(1);
}
function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.28.1-paper-reset] patched ${rel}`);
}
function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find anchor: ${label}`);
  return text.replace(search, replacement);
}

export function applyV2281PaperResetPatch(root = process.cwd()) {
  patchFile(root, "lib/paper-wallet.ts", (input) => {
    let text = input;

    text = text.replace(
      'import { listManagedPositions } from "./position-store";',
      'import { listManagedPositions, removeManagedPosition } from "./position-store";',
    );

    if (!text.includes("export async function resetPaperWalletPreserveLearning(")) {
      const anchor = `export async function getPaperWalletResetMeta(): Promise<PaperWalletResetMeta> {
  return readResetMeta();
}`;
      const addition = `${anchor}

export async function resetPaperWalletPreserveLearning(reason = "Manual dashboard reset"): Promise<{
  wallet: PaperWalletSnapshot;
  resetMeta: PaperWalletResetMeta;
  clearedOpenPositions: number;
}> {
  let wallet!: PaperWalletSnapshot;
  let resetMeta!: PaperWalletResetMeta;
  let clearedOpenPositions = 0;

  const task = mutationLock.then(async () => {
    const { state: current, storage } = await readState();
    const positions = await listManagedPositions();
    const open = positions.filter((position) => position.status !== "closed");
    const openValue = open.reduce(
      (sum, position) => sum + Math.max(0, position.remainingQuantity * position.markPrice),
      0,
    );
    const preResetEquity = Math.max(0, current.cashUsd + openValue);

    // A manual wallet reset abandons current PAPER positions without turning
    // those abandoned marks into fake wins/losses. Historical closed trades,
    // Runner Genome cases, Filing Cabinet data and per-entity memories are untouched.
    for (const position of open) {
      await removeManagedPosition(position.id);
      clearedOpenPositions += 1;
    }

    const startingCashUsd = configuredStartingCash();
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const previousHigh = Math.max(current.allTimeHighEquityUsd ?? current.startingCashUsd, preResetEquity);
    const previousLow = Math.min(current.allTimeLowEquityUsd ?? current.startingCashUsd, preResetEquity);
    const history = current.equityHistory ?? [];
    const beforePoint = {
      at: Math.max(0, nowMs - 1),
      equity: Number(preResetEquity.toFixed(2)),
      cash: Number(current.cashUsd.toFixed(2)),
      openValue: Number(openValue.toFixed(2)),
      event: "mark" as const,
    };
    const resetPoint = {
      at: nowMs,
      equity: Number(startingCashUsd.toFixed(2)),
      cash: Number(startingCashUsd.toFixed(2)),
      openValue: 0,
      event: "reset" as const,
    };

    const next: PaperWalletState = {
      ...current,
      startingCashUsd,
      cashUsd: startingCashUsd,
      dayKey: dayKey(),
      dayStartEquityUsd: startingCashUsd,
      updatedAt: now,
      equityHistory: [...history, beforePoint, resetPoint].slice(-MAX_EQUITY_HISTORY),
      allTimeHighEquityUsd: Number(Math.max(previousHigh, startingCashUsd).toFixed(2)),
      allTimeHighAt: preResetEquity >= previousHigh
        ? new Date(Math.max(0, nowMs - 1)).toISOString()
        : current.allTimeHighAt,
      allTimeLowEquityUsd: Number(Math.min(previousLow, startingCashUsd).toFixed(2)),
      allTimeLowAt: preResetEquity <= previousLow
        ? new Date(Math.max(0, nowMs - 1)).toISOString()
        : current.allTimeLowAt,
      // Keep fills/counters/fees as audit history. This is a bankroll reset,
      // not a learning/history wipe.
      recentFills: current.recentFills,
    };

    await writeState(next);

    resetMeta = await readResetMeta();
    resetMeta = {
      resets: resetMeta.resets + 1,
      totalInjectedUsd: Number((resetMeta.totalInjectedUsd + startingCashUsd).toFixed(2)),
      lastResetAt: now,
      lastReason: \`\${reason}. Restored PAPER bankroll to $\${startingCashUsd.toFixed(2)} and cleared \${clearedOpenPositions} open position(s); learning/history preserved.\`,
    };
    await writeResetMeta(resetMeta);

    wallet = await calculateSnapshot(next, storage);
  });

  mutationLock = task.catch(() => undefined);
  await task;
  return { wallet, resetMeta, clearedOpenPositions };
}`;
      text = replaceRequired(text, anchor, addition, "manual paper reset function");
    }

    if (!text.includes("removeManagedPosition")) fail("Position reset import missing");
    return text;
  });

  patchFile(root, "components/WarRoomDashboard.tsx", (input) => {
    let text = input;

    if (!text.includes("const [resettingPaperWallet, setResettingPaperWallet]")) {
      text = replaceRequired(
        text,
        '  const [copiedCa, setCopiedCa] = useState<string | null>(null);',
        `  const [copiedCa, setCopiedCa] = useState<string | null>(null);
  const [resettingPaperWallet, setResettingPaperWallet] = useState(false);
  const [paperResetMessage, setPaperResetMessage] = useState<string | null>(null);`,
        "paper reset state",
      );
    }

    if (!text.includes("const resetPaperWallet = async () =>")) {
      const anchor = `  const copyContract = async (address: string) => {`;
      const resetFn = `  const resetPaperWallet = async () => {
    const confirmed = window.confirm(
      "Reset PAPER wallet to $1,000 and clear current open PAPER positions?\\n\\nRunner Genome, Filing Cabinet, agent memories, closed trade history and all-time portfolio history will NOT be erased."
    );
    if (!confirmed || resettingPaperWallet) return;

    setResettingPaperWallet(true);
    setPaperResetMessage(null);
    try {
      const response = await fetch("/api/paper-reset", { method: "POST" });
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string; clearedOpenPositions?: number };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? \`Reset failed (\${response.status})\`);

      const refreshed = await fetch("/api/autopilot", { cache: "no-store" });
      if (refreshed.ok) setStatus(await refreshed.json() as AutopilotPayload);
      setMainGraphSelection("portfolio");
      setPaperResetMessage(payload.message ?? "Paper wallet reset. Learning preserved.");
      window.setTimeout(() => setPaperResetMessage(null), 6000);
    } catch (err) {
      setPaperResetMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setResettingPaperWallet(false);
    }
  };

${anchor}`;
      text = replaceRequired(text, anchor, resetFn, "paper reset function");
    }

    const walletClose = `          <span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span>
        </div>`;
    if (!text.includes("RESET PAPER WALLET")) {
      text = replaceRequired(
        text,
        walletClose,
        `          <span><small>Open positions</small><b>{status?.paperWallet?.openPositions ?? 0}</b></span>
          <button className="paper-reset-button" onClick={() => void resetPaperWallet()} disabled={resettingPaperWallet}>
            {resettingPaperWallet ? "RESETTING…" : "RESET PAPER WALLET"}
          </button>
        </div>
        {paperResetMessage && <p className="paper-reset-message">{paperResetMessage}</p>}`,
        "reset button in paper wallet strip",
      );
    }

    text = text.replaceAll("Bot War Room V2.28", "Bot War Room V2.28.1");
    return text;
  });

  patchFile(root, "app/v214.css", (input) => {
    let text = input;
    if (!text.includes(".paper-reset-button{")) {
      text += `
/* V2.28.1 — paper wallet reset */
.paper-reset-button{
  appearance:none;
  border:1px solid #d8dde3;
  background:#fff;
  color:#111;
  border-radius:11px;
  min-height:42px;
  padding:0 14px;
  font-size:9px;
  font-weight:800;
  letter-spacing:.045em;
  cursor:pointer;
  white-space:nowrap;
}
.paper-reset-button:hover{border-color:#111;background:#fafafa}
.paper-reset-button:disabled{opacity:.5;cursor:wait}
.paper-reset-message{
  margin:8px 0 0;
  padding:8px 11px;
  border-radius:10px;
  background:#f4faf7;
  border:1px solid #d9ece2;
  color:#2c6950;
  font-size:10px;
}
@media(max-width:800px){
  .paper-reset-button{width:100%}
}
`;
    }
    return text;
  });

  console.log("[v2.28.1-paper-reset] Manual PAPER wallet reset added. Bankroll/open positions reset; learning and persistent history remain.");
}
