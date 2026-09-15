import { createClient } from "redis";
import type { ManagedPosition, MarketSnapshot, WarRoomResult } from "./types";

const CASES_KEY = "bot-war-room:runner-research:v214:cases";
const META_KEY = "bot-war-room:runner-research:v214:meta";
const MAX_CASES = 12_000;
const MAX_OBSERVATIONS_PER_CASE = 180;
const MAX_BOT_NOTES_PER_CASE = 96;
const REVIEW_INTERVAL_MS = 2 * 60_000;
const CASE_HORIZON_MS = 24 * 60 * 60_000;

let redisPromise: Promise<any | null> | null = null;
const memoryCases = new Map<string, CoinCaseFile>();
let memoryMeta: ResearchMeta | null = null;

export type ResearchOutcome = "open" | "runner" | "dumper" | "neutral";
export type BotRole = "launch" | "social" | "wallet" | "quant" | "contract" | "bear" | "cio" | "executor";

export type ResearchObservation = {
  at: string;
  price: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  ageMinutes: number;
  buySellRatio: number;
  volume5m: number;
  volume24h: number;
  volumeToMc: number;
  liquidityToMc: number;
  volumeAccelerationPct: number;
  holderVelocity: number;
  uniqueBuyerVelocity: number;
  top10Pct: number;
  bundledPct: number;
  socialVelocityPct: number;
  councilDecision?: string;
  councilConviction?: number;
  alphaScore?: number;
  launchVelocityScore?: number;
  researchSupport?: number;
  riskScore?: number;
};

export type BotResearchNote = {
  at: string;
  agentId: BotRole;
  message: string;
};

export type CoinCaseFile = {
  id: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  nextReviewAt: string;
  firstMarketCap: number;
  peakMarketCap: number;
  troughMarketCap: number;
  peakReturnPct: number;
  maxDrawdownPct: number;
  outcome: ResearchOutcome;
  outcomeAt?: string;
  observations: ResearchObservation[];
  botNotes: BotResearchNote[];
  paperTradeOpened?: boolean;
  paperEntryAt?: string;
  paperEntryMarketCap?: number;
  paperEntryAgeMinutes?: number;
  paperExploration?: boolean;
  paperRequestedUsd?: number;
  paperClosed?: boolean;
  paperPnlUsd?: number;
  paperReturnPct?: number;
  freshWinRecorded?: boolean;
  milestone100k?: string;
  milestone300k?: string;
  milestone1m?: string;
};

type ResearchMeta = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  observations: number;
  casesCreated: number;
  freshWinTokens: string[];
  closedTradeTokens: string[];
};

type SignalKey = "volumeToMc" | "liquidityToMc" | "buySellRatio" | "volumeAccelerationPct" | "holderVelocity" | "uniqueBuyerVelocity" | "top10Pct" | "bundledPct" | "launchVelocityScore";

type SignalFinding = {
  key: SignalKey;
  label: string;
  effect: number;
  direction: "higher" | "lower";
  status: "active" | "confirmed" | "invalidated";
  message: string;
};

export type CodeRequirement = {
  id: string;
  label: string;
  current: string;
  target: string;
  passed: boolean;
};

export type RunnerResearchSnapshot = {
  mission: string;
  casesStudied: number;
  labeledCases: number;
  runnerCases: number;
  dumperCases: number;
  neutralCases: number;
  openCases: number;
  observations: number;
  paperTrades: number;
  paperWins: number;
  freshCoinWins: number;
  targetFreshCoinWins: number;
  runnerCaptures: number;
  activeHypotheses: number;
  confirmedTells: number;
  invalidatedTells: number;
  topRunnerTells: string[];
  topDumpTells: string[];
  recentBotLessons: Array<{ agentId: BotRole; message: string; at: string }>;
  recentCases: Array<{
    symbol: string;
    chain: string;
    outcome: ResearchOutcome;
    firstMarketCap: number;
    peakMarketCap: number;
    peakReturnPct: number;
    paperReturnPct?: number;
    lastSeenAt: string;
  }>;
  oosAccuracyPct: number;
  paperProfitFactor: number;
  paperExpectancyPct: number;
  maxObservedDrawdownPct: number;
  providerCoveragePct: number;
  codeProgressPct: number;
  codeDeciphered: boolean;
  liveTradingEligible: boolean;
  liveAutoEnableRequested: boolean;
  liveExecutorConfigured: boolean;
  liveTradingArmed: boolean;
  requirements: CodeRequirement[];
  dailyAutopsy: string[];
  generatedAt: string;
};

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[runner-research] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[runner-research] redis unavailable; using memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

function freshMeta(): ResearchMeta {
  const now = new Date().toISOString();
  return { version: 1, createdAt: now, updatedAt: now, observations: 0, casesCreated: 0, freshWinTokens: [], closedTradeTokens: [] };
}

async function readMeta(): Promise<ResearchMeta> {
  const redis = await getRedis();
  if (!redis) return memoryMeta ??= freshMeta();
  const raw = await redis.get(META_KEY);
  if (!raw) {
    const meta = freshMeta();
    await redis.set(META_KEY, JSON.stringify(meta));
    return meta;
  }
  try { return JSON.parse(raw) as ResearchMeta; }
  catch {
    const meta = freshMeta();
    await redis.set(META_KEY, JSON.stringify(meta));
    return meta;
  }
}

async function writeMeta(meta: ResearchMeta) {
  memoryMeta = meta;
  const redis = await getRedis();
  if (redis) await redis.set(META_KEY, JSON.stringify(meta));
}

async function readCase(id: string): Promise<CoinCaseFile | null> {
  const redis = await getRedis();
  if (!redis) return memoryCases.get(id) ?? null;
  const raw = await redis.hGet(CASES_KEY, id);
  if (!raw) return null;
  try { return JSON.parse(raw) as CoinCaseFile; } catch { return null; }
}

async function writeCase(row: CoinCaseFile) {
  memoryCases.set(row.id, row);
  const redis = await getRedis();
  if (!redis) return;
  await redis.hSet(CASES_KEY, row.id, JSON.stringify(row));
  const count = await redis.hLen(CASES_KEY);
  if (count > MAX_CASES) {
    const all = await redis.hGetAll(CASES_KEY) as Record<string, string>;
    const ordered = Object.entries(all)
      .map(([id, raw]) => ({ id, row: JSON.parse(raw) as CoinCaseFile }))
      .sort((a, b) => a.row.firstSeenAt.localeCompare(b.row.firstSeenAt));
    for (const old of ordered.slice(0, count - MAX_CASES)) await redis.hDel(CASES_KEY, old.id);
  }
}

async function allCases(): Promise<CoinCaseFile[]> {
  const redis = await getRedis();
  if (!redis) return [...memoryCases.values()];
  const rows = await redis.hGetAll(CASES_KEY) as Record<string, string>;
  return Object.values(rows).map((raw) => JSON.parse(raw) as CoinCaseFile);
}

function caseId(snapshot: MarketSnapshot) {
  return `${snapshot.chain}:${snapshot.tokenAddress.toLowerCase()}`;
}

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function observationFromSnapshot(snapshot: MarketSnapshot, result?: WarRoomResult): ResearchObservation {
  const mc = Math.max(0, snapshot.marketCap);
  const launch = snapshot.launchMetrics ?? {};
  return {
    at: new Date().toISOString(),
    price: finite(snapshot.price),
    marketCap: mc,
    liquidity: finite(snapshot.liquidity),
    holders: finite(snapshot.holders),
    ageMinutes: finite(snapshot.ageMinutes),
    buySellRatio: finite(snapshot.buySellRatio, 1),
    volume5m: finite(snapshot.volume5m),
    volume24h: finite(snapshot.volume24h),
    volumeToMc: mc > 0 ? finite(snapshot.volume24h) / mc : 0,
    liquidityToMc: mc > 0 ? finite(snapshot.liquidity) / mc : 0,
    volumeAccelerationPct: finite(snapshot.volumeAccelerationPct ?? launch.volumeAccelerationPct),
    holderVelocity: finite(launch.holdersPerMinute),
    uniqueBuyerVelocity: finite(launch.uniqueBuyersPerMinute),
    top10Pct: finite(snapshot.top10Pct),
    bundledPct: finite(snapshot.bundledPct),
    socialVelocityPct: finite(snapshot.socialVelocityPct),
    councilDecision: result?.decision,
    councilConviction: result?.conviction,
    alphaScore: result?.alpha.score,
    launchVelocityScore: result?.memeRegime?.launchVelocityScore,
    researchSupport: result?.councilProcess?.researchSupport,
    riskScore: result?.risk?.riskScore,
  };
}

function noteFromResult(result: WarRoomResult): BotResearchNote[] {
  const now = new Date().toISOString();
  return result.agents.slice(0, 8).map((agent) => ({
    at: now,
    agentId: agent.id as BotRole,
    message: `$${result.snapshot.symbol} @ $${Math.round(result.snapshot.marketCap).toLocaleString()} MC — ${agent.summary}${agent.evidence?.[0] ? ` Evidence: ${agent.evidence[0]}.` : ""}`,
  }));
}


function outcomeResearchNotes(row: CoinCaseFile): BotResearchNote[] {
  if (row.outcome === "open") return [];
  const at = row.outcomeAt ?? row.lastSeenAt;
  const outcome = row.outcome.toUpperCase();
  const peak = `$${Math.round(row.peakMarketCap).toLocaleString()} MC`;
  const draw = `${row.maxDrawdownPct.toFixed(0)}% max drawdown`;
  const first = row.observations[0];
  const notes: Array<[BotRole, string]> = [
    ["launch", `${outcome} autopsy for $${row.symbol}: first seen at $${Math.round(row.firstMarketCap).toLocaleString()} MC, peak ${peak}, ${draw}. Compare launch velocity and timing against other fresh cases.`],
    ["social", `${outcome} autopsy for $${row.symbol}: compare early social velocity (${(first?.socialVelocityPct ?? 0).toFixed(0)}%) with price timing so attention is not mistaken for a leading signal.`],
    ["wallet", `${outcome} autopsy for $${row.symbol}: early holders ${Math.round(first?.holders ?? 0).toLocaleString()}, holder velocity ${(first?.holderVelocity ?? 0).toFixed(2)}/min, unique-buyer velocity ${(first?.uniqueBuyerVelocity ?? 0).toFixed(2)}/min.`],
    ["quant", `${outcome} autopsy for $${row.symbol}: early volume/MC ${(first?.volumeToMc ?? 0).toFixed(2)}x, buy/sell ${(first?.buySellRatio ?? 0).toFixed(2)}x, acceleration ${(first?.volumeAccelerationPct ?? 0).toFixed(0)}%.`],
    ["contract", `${outcome} autopsy for $${row.symbol}: early top-10 ${(first?.top10Pct ?? 0).toFixed(1)}% and bundled ${(first?.bundledPct ?? 0).toFixed(1)}%; file whether concentration distinguished this outcome.`],
    ["bear", `${outcome} autopsy for $${row.symbol}: study what warned against the move before the outcome was obvious; peak-to-trough behavior reached ${draw}.`],
    ["cio", `${outcome} autopsy for $${row.symbol}: preserve the sequence of early signals and compare it with matched ${row.outcome === "runner" ? "dumpers" : "runners"}, not just the final snapshot.`],
    ["executor", `${outcome} autopsy for $${row.symbol}: ${row.paperTradeOpened ? `paper entry was opened near $${Math.round(row.paperEntryMarketCap ?? 0).toLocaleString()} MC` : "no paper position was opened"}; use this case to evaluate capture quality and missed opportunity.`],
  ];
  return notes.map(([agentId, message]) => ({ at, agentId, message }));
}

function classifyCase(row: CoinCaseFile): CoinCaseFile {
  const targetRunnerMc = Math.max(100_000, Number(process.env.RESEARCH_RUNNER_TARGET_MC ?? 300_000));
  const dumperDropPct = Math.max(35, Math.min(95, Number(process.env.RESEARCH_DUMPER_DROP_PCT ?? 60)));
  const first = Math.max(row.firstMarketCap, 1);
  row.peakReturnPct = (row.peakMarketCap / first - 1) * 100;
  let runningPeak = first;
  let worstPeakDrawdown = 0;
  for (const observation of row.observations) {
    const mc = Math.max(0, observation.marketCap);
    runningPeak = Math.max(runningPeak, mc);
    if (runningPeak > 0) worstPeakDrawdown = Math.min(worstPeakDrawdown, (mc / runningPeak - 1) * 100);
  }
  const firstDrawdown = Math.min(0, (row.troughMarketCap / first - 1) * 100);
  row.maxDrawdownPct = Math.min(firstDrawdown, worstPeakDrawdown);
  if (!row.milestone100k && row.peakMarketCap >= 100_000) row.milestone100k = row.lastSeenAt;
  if (!row.milestone300k && row.peakMarketCap >= 300_000) row.milestone300k = row.lastSeenAt;
  if (!row.milestone1m && row.peakMarketCap >= 1_000_000) row.milestone1m = row.lastSeenAt;
  if (row.peakMarketCap >= targetRunnerMc) {
    row.outcome = "runner";
    row.outcomeAt ??= row.lastSeenAt;
    return row;
  }
  const ageMs = Date.now() - new Date(row.firstSeenAt).getTime();
  const drawdown = row.maxDrawdownPct;
  if (ageMs >= 30 * 60_000 && drawdown <= -dumperDropPct) {
    row.outcome = "dumper";
    row.outcomeAt ??= row.lastSeenAt;
    return row;
  }
  if (ageMs >= CASE_HORIZON_MS) {
    row.outcome = row.peakReturnPct >= 100 ? "neutral" : drawdown <= -35 ? "dumper" : "neutral";
    row.outcomeAt ??= row.lastSeenAt;
  }
  return row;
}

async function upsertObservation(snapshot: MarketSnapshot, result?: WarRoomResult) {
  const id = caseId(snapshot);
  const now = new Date().toISOString();
  const obs = observationFromSnapshot(snapshot, result);
  let row = await readCase(id);
  const isNew = !row;
  if (!row) {
    row = {
      id,
      chain: snapshot.chain,
      tokenAddress: snapshot.tokenAddress,
      symbol: snapshot.symbol,
      name: snapshot.name,
      firstSeenAt: now,
      lastSeenAt: now,
      nextReviewAt: new Date(Date.now() + REVIEW_INTERVAL_MS).toISOString(),
      firstMarketCap: Math.max(0, snapshot.marketCap),
      peakMarketCap: Math.max(0, snapshot.marketCap),
      troughMarketCap: Math.max(0, snapshot.marketCap),
      peakReturnPct: 0,
      maxDrawdownPct: 0,
      outcome: "open",
      observations: [],
      botNotes: [],
    };
  }
  row.symbol = snapshot.symbol || row.symbol;
  row.name = snapshot.name || row.name;
  row.lastSeenAt = now;
  row.nextReviewAt = new Date(Date.now() + REVIEW_INTERVAL_MS).toISOString();
  row.peakMarketCap = Math.max(row.peakMarketCap, Math.max(0, snapshot.marketCap));
  row.troughMarketCap = row.troughMarketCap > 0 ? Math.min(row.troughMarketCap, Math.max(0, snapshot.marketCap)) : Math.max(0, snapshot.marketCap);
  row.observations = [...row.observations, obs].slice(-MAX_OBSERVATIONS_PER_CASE);
  if (result) row.botNotes = [...row.botNotes, ...noteFromResult(result)].slice(-MAX_BOT_NOTES_PER_CASE);
  const priorOutcome = row.outcome;
  classifyCase(row);
  if (priorOutcome !== row.outcome && row.outcome !== "open") {
    row.botNotes = [...row.botNotes, ...outcomeResearchNotes(row)].slice(-MAX_BOT_NOTES_PER_CASE);
  }
  await writeCase(row);

  const meta = await readMeta();
  meta.updatedAt = now;
  meta.observations += 1;
  if (isNew) meta.casesCreated += 1;
  await writeMeta(meta);
  return row;
}

export async function observeCouncilResult(result: WarRoomResult) {
  return upsertObservation(result.snapshot, result);
}

export async function observeResearchSnapshot(snapshot: MarketSnapshot) {
  return upsertObservation(snapshot);
}

export async function markResearchTradeOpened(result: WarRoomResult, requestedUsd: number, exploration: boolean) {
  const row = await upsertObservation(result.snapshot, result);
  row.paperTradeOpened = true;
  row.paperEntryAt = new Date().toISOString();
  row.paperEntryMarketCap = result.snapshot.marketCap;
  row.paperEntryAgeMinutes = result.snapshot.ageMinutes;
  row.paperExploration = exploration;
  row.paperRequestedUsd = requestedUsd;
  await writeCase(row);
}

export async function refreshOneResearchCase(fetcher: (chain: any, tokenAddress: string) => Promise<MarketSnapshot | null>) {
  const cases = await allCases();
  const now = Date.now();
  const due = cases
    .filter((row) => row.outcome === "open" && new Date(row.nextReviewAt).getTime() <= now)
    .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt))[0];
  if (!due) return null;
  const snapshot = await fetcher(due.chain as any, due.tokenAddress);
  if (!snapshot) {
    due.nextReviewAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await writeCase(due);
    return null;
  }
  return observeResearchSnapshot(snapshot);
}

function distinctTokenKey(position: ManagedPosition) {
  return `${position.chain}:${position.tokenAddress.toLowerCase()}`;
}

export async function ingestClosedPositions(positions: ManagedPosition[]) {
  const meta = await readMeta();
  const closed = positions.filter((position) => position.status === "closed");
  const seenClosed = new Set(meta.closedTradeTokens);
  const freshWinTokens = new Set(meta.freshWinTokens);
  const maxFreshMc = Math.max(10_000, Number(process.env.RESEARCH_FRESH_ENTRY_MAX_MC ?? 50_000));
  const maxFreshAge = Math.max(30, Number(process.env.RESEARCH_FRESH_ENTRY_MAX_AGE_MINUTES ?? 1_440));
  const minWinReturnPct = Number(process.env.RESEARCH_FRESH_WIN_MIN_RETURN_PCT ?? 10);

  for (const position of closed) {
    const tokenKey = distinctTokenKey(position);
    const row = await readCase(tokenKey);
    if (row) {
      row.paperClosed = true;
      row.paperPnlUsd = position.realizedPnlUsd;
      row.paperReturnPct = position.pnlPct;
      classifyCase(row);
      if (!row.freshWinRecorded &&
          (row.paperEntryMarketCap ?? row.firstMarketCap) <= maxFreshMc &&
          (row.paperEntryAgeMinutes ?? row.observations[0]?.ageMinutes ?? Infinity) <= maxFreshAge &&
          position.pnlPct >= minWinReturnPct && position.realizedPnlUsd > 0) {
        row.freshWinRecorded = true;
        freshWinTokens.add(tokenKey);
      }
      await writeCase(row);
    }
    seenClosed.add(tokenKey);
  }
  meta.closedTradeTokens = [...seenClosed].slice(-5_000);
  meta.freshWinTokens = [...freshWinTokens].slice(-5_000);
  meta.updatedAt = new Date().toISOString();
  await writeMeta(meta);
}

function avg(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function std(values: number[], mean = avg(values)) {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function firstFeature(row: CoinCaseFile, key: SignalKey) {
  const first = row.observations[0];
  return first ? finite(first[key]) : 0;
}

const SIGNAL_LABELS: Record<SignalKey, string> = {
  volumeToMc: "early volume / market-cap intensity",
  liquidityToMc: "liquidity depth relative to market cap",
  buySellRatio: "buy/sell pressure",
  volumeAccelerationPct: "volume acceleration",
  holderVelocity: "holder growth per minute",
  uniqueBuyerVelocity: "unique-buyer growth per minute",
  top10Pct: "top-10 holder concentration",
  bundledPct: "bundled-supply concentration",
  launchVelocityScore: "launch-velocity score",
};

function signalFindings(cases: CoinCaseFile[], oosAccuracyPct: number): SignalFinding[] {
  const runners = cases.filter((row) => row.outcome === "runner");
  const dumpers = cases.filter((row) => row.outcome === "dumper");
  const labeled = runners.length + dumpers.length;
  if (!runners.length || !dumpers.length) return [];
  const keys: SignalKey[] = ["volumeToMc", "liquidityToMc", "buySellRatio", "volumeAccelerationPct", "holderVelocity", "uniqueBuyerVelocity", "top10Pct", "bundledPct", "launchVelocityScore"];
  return keys.map((key) => {
    const r = runners.map((row) => firstFeature(row, key));
    const d = dumpers.map((row) => firstFeature(row, key));
    const rm = avg(r), dm = avg(d);
    const pooled = Math.max(1e-9, (std(r, rm) + std(d, dm)) / 2);
    const effect = (rm - dm) / pooled;
    const abs = Math.abs(effect);
    const direction: SignalFinding["direction"] = effect >= 0 ? "higher" : "lower";
    let status: SignalFinding["status"] = "active";
    if (labeled >= 100 && abs < 0.15) status = "invalidated";
    else if (labeled >= 80 && abs >= 0.7 && oosAccuracyPct >= 60) status = "confirmed";
    const message = effect >= 0
      ? `Runners show ${SIGNAL_LABELS[key]} materially higher than dumpers in the early window.`
      : `Runners show ${SIGNAL_LABELS[key]} materially lower than dumpers in the early window.`;
    return { key, label: SIGNAL_LABELS[key], effect, direction, status, message };
  }).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

function normalizedFeatures(row: CoinCaseFile): number[] {
  const first = row.observations[0];
  if (!first) return [0,0,0,0,0,0,0,0,0];
  return [
    Math.log10(Math.max(1e-6, first.volumeToMc) + 1),
    Math.log10(Math.max(1e-6, first.liquidityToMc) + 1),
    Math.min(8, first.buySellRatio),
    Math.max(-100, Math.min(1000, first.volumeAccelerationPct)) / 100,
    Math.min(10, first.holderVelocity),
    Math.min(10, first.uniqueBuyerVelocity),
    first.top10Pct / 100,
    first.bundledPct / 100,
    (first.launchVelocityScore ?? 0) / 100,
  ];
}

function oosAccuracy(cases: CoinCaseFile[]) {
  const labeled = cases.filter((row) => row.outcome === "runner" || row.outcome === "dumper").sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  if (labeled.length < 30) return 0;
  const split = Math.max(20, Math.floor(labeled.length * 0.8));
  const train = labeled.slice(0, split);
  const test = labeled.slice(split);
  const runners = train.filter((row) => row.outcome === "runner");
  const dumpers = train.filter((row) => row.outcome === "dumper");
  if (!runners.length || !dumpers.length || !test.length) return 0;
  const dims = normalizedFeatures(train[0]).length;
  const centroid = (rows: CoinCaseFile[]) => Array.from({ length: dims }, (_, index) => avg(rows.map((row) => normalizedFeatures(row)[index])));
  const rc = centroid(runners), dc = centroid(dumpers);
  let correct = 0;
  for (const row of test) {
    const f = normalizedFeatures(row);
    const rd = Math.sqrt(f.reduce((sum, x, i) => sum + (x - rc[i]) ** 2, 0));
    const dd = Math.sqrt(f.reduce((sum, x, i) => sum + (x - dc[i]) ** 2, 0));
    const predicted: ResearchOutcome = rd <= dd ? "runner" : "dumper";
    if (predicted === row.outcome) correct += 1;
  }
  return Number((correct / test.length * 100).toFixed(1));
}

function providerCoverage(providers: Array<{ configured: boolean; ok: boolean }>) {
  const configured = providers.filter((provider) => provider.configured);
  if (!configured.length) return 0;
  return Math.round(configured.filter((provider) => provider.ok).length / configured.length * 100);
}

function tradingStats(positions: ManagedPosition[]) {
  const closed = positions.filter((position) => position.status === "closed");
  const returns = closed.map((position) => finite(position.pnlPct));
  const profits = closed.filter((position) => position.realizedPnlUsd > 0).reduce((sum, position) => sum + position.realizedPnlUsd, 0);
  const losses = Math.abs(closed.filter((position) => position.realizedPnlUsd < 0).reduce((sum, position) => sum + position.realizedPnlUsd, 0));
  return {
    paperTrades: closed.length,
    paperWins: closed.filter((position) => position.realizedPnlUsd > 0).length,
    profitFactor: losses > 0 ? profits / losses : profits > 0 ? 99 : 0,
    expectancyPct: avg(returns),
    maxDrawdownPct: closed.length ? Math.abs(Math.min(0, ...closed.map((position) => finite(position.maxAdverseExcursionPct)))) : 0,
  };
}

function dailyAutopsy(cases: CoinCaseFile[]) {
  const since = Date.now() - 24 * 60 * 60_000;
  const recent = cases.filter((row) => new Date(row.firstSeenAt).getTime() >= since);
  const runners = recent.filter((row) => row.outcome === "runner");
  const dumpers = recent.filter((row) => row.outcome === "dumper");
  const best = [...recent].sort((a, b) => b.peakReturnPct - a.peakReturnPct)[0];
  const worst = [...recent].sort((a, b) => a.maxDrawdownPct - b.maxDrawdownPct)[0];
  const lines = [
    `${recent.length} fresh launches studied in the last 24h · ${runners.length} runner label(s) · ${dumpers.length} dumper label(s).`,
  ];
  if (best) lines.push(`Best observed runner: $${best.symbol} peaked at $${Math.round(best.peakMarketCap).toLocaleString()} MC (${best.peakReturnPct >= 0 ? "+" : ""}${best.peakReturnPct.toFixed(0)}% from first observation).`);
  if (worst) lines.push(`Hardest failure: $${worst.symbol} reached ${worst.maxDrawdownPct.toFixed(0)}% versus its first observed market cap.`);
  return lines;
}

export async function getRunnerResearchSnapshot(args: {
  positions: ManagedPosition[];
  providers: Array<{ configured: boolean; ok: boolean }>;
  walletResetCount?: number;
}): Promise<RunnerResearchSnapshot> {
  const cases = await allCases();
  const meta = await readMeta();
  const stats = tradingStats(args.positions);
  const oosAccuracyPct = oosAccuracy(cases);
  const findings = signalFindings(cases, oosAccuracyPct);
  const providerCoveragePct = providerCoverage(args.providers);
  const freshCoinWins = new Set(meta.freshWinTokens).size;
  const targetFreshCoinWins = Math.max(1, Number(process.env.RESEARCH_REQUIRED_FRESH_WINS ?? 100));
  const runnerCases = cases.filter((row) => row.outcome === "runner").length;
  const dumperCases = cases.filter((row) => row.outcome === "dumper").length;
  const neutralCases = cases.filter((row) => row.outcome === "neutral").length;
  const openCases = cases.filter((row) => row.outcome === "open").length;
  const labeledCases = runnerCases + dumperCases;
  const confirmedTells = findings.filter((row) => row.status === "confirmed").length;
  const invalidatedTells = findings.filter((row) => row.status === "invalidated").length;
  const activeHypotheses = findings.filter((row) => row.status === "active").length;
  const runnerCaptures = cases.filter((row) => row.outcome === "runner" && row.paperTradeOpened).length;

  const requiredCases = Math.max(100, Number(process.env.RESEARCH_REQUIRED_CASES ?? 2_000));
  const requiredLabeled = Math.max(30, Number(process.env.RESEARCH_REQUIRED_LABELED_CASES ?? 300));
  const requiredAccuracy = Math.max(50, Number(process.env.RESEARCH_REQUIRED_OOS_ACCURACY_PCT ?? 65));
  const requiredProfitFactor = Math.max(1, Number(process.env.RESEARCH_REQUIRED_PROFIT_FACTOR ?? 1.3));
  const maxAllowedDrawdown = Math.max(5, Number(process.env.RESEARCH_MAX_ALLOWED_DRAWDOWN_PCT ?? 35));
  const requiredCoverage = Math.max(50, Number(process.env.RESEARCH_REQUIRED_PROVIDER_COVERAGE_PCT ?? 75));
  const requiredConfirmed = Math.max(1, Number(process.env.RESEARCH_REQUIRED_CONFIRMED_TELLS ?? 3));

  const requirements: CodeRequirement[] = [
    { id: "cases", label: "Fresh launch case files", current: cases.length.toLocaleString(), target: requiredCases.toLocaleString(), passed: cases.length >= requiredCases },
    { id: "labeled", label: "Runner/dumper labeled cases", current: labeledCases.toLocaleString(), target: requiredLabeled.toLocaleString(), passed: labeledCases >= requiredLabeled },
    { id: "wins", label: "Successful fresh-coin paper wins", current: freshCoinWins.toLocaleString(), target: targetFreshCoinWins.toLocaleString(), passed: freshCoinWins >= targetFreshCoinWins },
    { id: "accuracy", label: "Out-of-sample Runner Genome accuracy", current: `${oosAccuracyPct.toFixed(1)}%`, target: `${requiredAccuracy}%`, passed: oosAccuracyPct >= requiredAccuracy },
    { id: "pf", label: "Paper profit factor", current: stats.profitFactor.toFixed(2), target: requiredProfitFactor.toFixed(2), passed: stats.profitFactor >= requiredProfitFactor && stats.paperTrades >= 30 },
    { id: "expectancy", label: "Paper expectancy", current: `${stats.expectancyPct.toFixed(2)}%`, target: "> 0%", passed: stats.expectancyPct > 0 && stats.paperTrades >= 30 },
    { id: "drawdown", label: "Observed max adverse excursion", current: `${stats.maxDrawdownPct.toFixed(1)}%`, target: `≤ ${maxAllowedDrawdown}%`, passed: stats.paperTrades >= 30 && stats.maxDrawdownPct <= maxAllowedDrawdown },
    { id: "coverage", label: "Live provider coverage", current: `${providerCoveragePct}%`, target: `≥ ${requiredCoverage}%`, passed: providerCoveragePct >= requiredCoverage },
    { id: "tells", label: "Confirmed runner/dumper tells", current: confirmedTells.toLocaleString(), target: requiredConfirmed.toLocaleString(), passed: confirmedTells >= requiredConfirmed },
  ];

  const knowledgeComponent = 25 * Math.min(1, (cases.length / requiredCases) * 0.45 + (labeledCases / requiredLabeled) * 0.55);
  const winsComponent = 25 * Math.min(1, freshCoinWins / targetFreshCoinWins);
  const accuracyComponent = 20 * Math.max(0, Math.min(1, (oosAccuracyPct - 50) / Math.max(1, requiredAccuracy - 50)));
  const profitabilityComponent = 15 * Math.min(1, Math.max(0, stats.profitFactor / requiredProfitFactor) * 0.6 + Math.max(0, Math.min(1, stats.expectancyPct / 5)) * 0.4);
  const riskComponent = 10 * (stats.paperTrades >= 30 ? Math.max(0, Math.min(1, (maxAllowedDrawdown - stats.maxDrawdownPct + 10) / Math.max(10, maxAllowedDrawdown))) : 0);
  const dataComponent = 5 * Math.min(1, providerCoveragePct / requiredCoverage);
  const rawProgress = Math.floor(Math.max(0, Math.min(100, knowledgeComponent + winsComponent + accuracyComponent + profitabilityComponent + riskComponent + dataComponent)));
  const codeDeciphered = requirements.every((requirement) => requirement.passed);
  const codeProgressPct = codeDeciphered ? 100 : Math.min(99, rawProgress);
  const liveAutoEnableRequested = process.env.AUTO_ENABLE_LIVE_ON_CODE_DECIPHERED !== "false";
  const liveExecutorConfigured = Boolean(process.env.LIVE_EXECUTOR_URL && process.env.LIVE_EXECUTOR_TOKEN);
  const liveTradingEligible = codeDeciphered;
  const liveTradingArmed = liveTradingEligible && liveAutoEnableRequested && liveExecutorConfigured;

  const topRunnerFindings = findings.filter((row) => row.status !== "invalidated").slice(0, 4);
  const topDumpFindings = [...findings].filter((row) => row.status !== "invalidated").sort((a, b) => a.effect - b.effect).slice(0, 4);
  const recentNotes = cases.flatMap((row) => row.botNotes).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const recentCases = [...cases].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 10).map((row) => ({
    symbol: row.symbol,
    chain: row.chain,
    outcome: row.outcome,
    firstMarketCap: row.firstMarketCap,
    peakMarketCap: row.peakMarketCap,
    peakReturnPct: row.peakReturnPct,
    paperReturnPct: row.paperReturnPct,
    lastSeenAt: row.lastSeenAt,
  }));

  return {
    mission: "Observe → study → hypothesize → paper trade → autopsy → file knowledge → validate → trade proven runner patterns.",
    casesStudied: cases.length,
    labeledCases,
    runnerCases,
    dumperCases,
    neutralCases,
    openCases,
    observations: meta.observations,
    paperTrades: stats.paperTrades,
    paperWins: stats.paperWins,
    freshCoinWins,
    targetFreshCoinWins,
    runnerCaptures,
    activeHypotheses,
    confirmedTells,
    invalidatedTells,
    topRunnerTells: topRunnerFindings.map((row) => `${row.status === "confirmed" ? "Confirmed" : "Testing"}: ${row.message}`),
    topDumpTells: topDumpFindings.map((row) => `Dump contrast: ${row.message}`),
    recentBotLessons: recentNotes,
    recentCases,
    oosAccuracyPct,
    paperProfitFactor: Number(stats.profitFactor.toFixed(2)),
    paperExpectancyPct: Number(stats.expectancyPct.toFixed(2)),
    maxObservedDrawdownPct: Number(stats.maxDrawdownPct.toFixed(2)),
    providerCoveragePct,
    codeProgressPct,
    codeDeciphered,
    liveTradingEligible,
    liveAutoEnableRequested,
    liveExecutorConfigured,
    liveTradingArmed,
    requirements,
    dailyAutopsy: dailyAutopsy(cases),
    generatedAt: new Date().toISOString(),
  };
}
