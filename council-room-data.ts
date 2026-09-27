// Council Room data layer.
//
// Mapped by prepare-structure.mjs to lib/council-room-data.ts.
// Frontend-only: reads the existing War Room API endpoints and reshapes them
// into the Council Room dashboard view-models. No env vars, no trading logic.
//
// The UI types below are DUPLICATED from the sibling-owned
// lib/council-room-types.ts and must stay structurally identical to it.
// Repo domain types (WarRoomResult, etc.) are imported from @/lib/types.
import type {
  AgentOpinion,
  IndependentEntityOpinion,
  MarketSnapshot,
  PaperWalletSnapshot,
  WarRoomResult,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// UI types — imported from the sibling-owned lib/council-room-types.ts so the
// dashboard components and this data layer can never drift apart.
// ---------------------------------------------------------------------------
import type {
  CouncilBotVM,
  CouncilRoomData,
  MeetingTurn,
} from "@/lib/council-room-types";

// ---------------------------------------------------------------------------
// Cabinet-export decision shape (the /api/cabinet/main fallback source)
// ---------------------------------------------------------------------------

export type CabinetCouncilSummary = {
  lane: string;
  alignedBots: number;
  totalBots: number;
  reasons: string[];
  cioVote?: string;
  executorVote?: "READY" | "REDUCE" | "BLOCK";
};

export type CabinetDecision = {
  decisionId: string;
  at: string;
  chain: string;
  symbol: string;
  decision: string;
  conviction: number;
  council?: CabinetCouncilSummary | null;
};

// ---------------------------------------------------------------------------
// ENTITY_DIRECTORY — the 8 real council entities with portrait affinity.
// Portraits map to public/bots/*.jpg (copied from flat bot-*.jpg files).
// ---------------------------------------------------------------------------

export type CouncilEntity = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  portrait: string;
  role: string;
  mission: string;
};

const DEFAULT_PORTRAIT = "/bots/referee.jpg"; // the chair; neutral fallback when no affinity matches

export const ENTITY_DIRECTORY: CouncilEntity[] = [
  // Affinity: an explorer/outdoorsman hunts down early runners in the field.
  { id: "launch", name: "Early Runner Scout", shortName: "ERS", color: "#ffb13b", portrait: "/bots/scout.jpg",
    role: "Scout",
    mission: "Hunt the earliest credible stage of a real runner, especially $10K-$50K market cap." },
  // Affinity: big ears listen for the first ignition of narrative and attention.
  { id: "social", name: "Narrative Ignition Scout", shortName: "NIS", color: "#b05cff", portrait: "/bots/ears.jpg",
    role: "Scout",
    mission: "Judge whether narrative and attention are igniting early enough to help a run." },
  // Affinity: a coach reads the whole team's flow — accumulation vs distribution.
  { id: "wallet", name: "Early Flow Analyst", shortName: "EFA", color: "#29e693", portrait: "/bots/coach.jpg",
    role: "Analyst",
    mission: "Judge early buyer, holder and wallet flow for accumulation versus distribution." },
  // Affinity: a trendspotter reads charts and pattern structure.
  { id: "quant", name: "Runner Pattern Quant", shortName: "RPQ", color: "#28c9ff", portrait: "/bots/trendspotter.jpg",
    role: "Quant",
    mission: "Measure runner structure, acceleration and similarity to the Runner Genome." },
  // Affinity: a bouncer is the safety gate at the door — lets safe tokens in, keeps honeypots out.
  { id: "contract", name: "Fast Safety Gate", shortName: "FSG", color: "#ffd34f", portrait: "/bots/bouncer.jpg",
    role: "Safety",
    mission: "Judge explicit token-level safety evidence without punishing a token merely for being early." },
  // Affinity: a lifeguard rescues the book from dumps — Bear Bot attacks the bullish thesis.
  { id: "bear", name: "Dumper Pattern Specialist", shortName: "DPS", color: "#ff5f6d", portrait: "/bots/lifeguard.jpg",
    role: "Red team",
    mission: "Look for the specific fingerprints that historically preceded failed launches and dumps." },
  // Affinity: a trader holds the money — sizing and portfolio strategy.
  { id: "portfolio", name: "Portfolio Strategist", shortName: "PS", color: "#70a8ff", portrait: "/bots/trader.jpg",
    role: "Strategy",
    mission: "Independently decide whether the setup deserves $50, $75, $100, $125 or $150 in PAPER." },
  // Affinity: a referee is the final judge of the room — the CIO combines the council's reads.
  // NOTE: the CIO entity color in lib/agent-entity-runtime.ts is #111111, which is
  // invisible on the dark dashboard theme, so the display color below is #e8e8e8.
  { id: "cio", name: "Runner CIO", shortName: "CIO", color: "#e8e8e8", portrait: "/bots/referee.jpg",
    role: "Chair",
    mission: "Combine independent research outputs using explicit weighting. Cannot override a deterministic veto." },
];

const ENTITY_BY_ID = new Map(ENTITY_DIRECTORY.map((entity) => [entity.id, entity]));

function portraitForAgentName(name: string, shortName?: string): string {
  const haystack = `${name ?? ""} ${shortName ?? ""}`.toLowerCase();
  // 1) Direct entity match: agent names come from the same ENTITY_SPECS names.
  for (const entity of ENTITY_DIRECTORY) {
    if (entity.name.toLowerCase() === (name ?? "").toLowerCase()) return entity.portrait;
  }
  // 2) First-letter match: any entity whose name starts with the agent's first letter.
  const firstLetter = (name ?? "").trim().charAt(0).toLowerCase();
  if (firstLetter) {
    const candidate = ENTITY_DIRECTORY.find((entity) => entity.name.toLowerCase().startsWith(firstLetter));
    if (candidate) return candidate.portrait;
  }
  void haystack;
  // 3) Neutral default: the chair.
  return DEFAULT_PORTRAIT;
}

// ---------------------------------------------------------------------------
// Meeting construction from a WarRoomResult
// ---------------------------------------------------------------------------

function stanceToVote(stance: AgentOpinion["stance"]): MeetingTurn["vote"] {
  switch (stance) {
    case "bullish": return "BUY";
    case "neutral": return "WATCH";
    case "bearish": return "SKIP";
    case "ready": return "READY";
    default: return undefined;
  }
}

function asFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function scoreTurn(agent: AgentOpinion): MeetingTurn {
  const portrait = portraitForAgentName(agent.name, agent.shortName);
  return {
    botId: agent.id,
    botName: agent.name,
    shortName: agent.shortName,
    color: agent.color,
    portrait,
    message: `Score ${Math.round(agent.score)} — ${agent.summary}`,
    vote: stanceToVote(agent.stance),
    confidence: asFiniteNumber(agent.score) ?? undefined,
    kind: "score",
  };
}

function challengeTurn(opinion: IndependentEntityOpinion): MeetingTurn | null {
  if (!opinion.changedVote && !opinion.rebuttal) return null;
  const entity = ENTITY_BY_ID.get(opinion.agentId);
  const name = entity?.name ?? opinion.agentName ?? opinion.agentId;
  return {
    botId: opinion.agentId,
    botName: name,
    shortName: entity?.shortName ?? opinion.agentId.slice(0, 3).toUpperCase(),
    color: entity?.color ?? "#e8e8e8",
    portrait: entity?.portrait ?? DEFAULT_PORTRAIT,
    message: opinion.rebuttal ?? opinion.thesis,
    vote: opinion.vote === "BUY" || opinion.vote === "WATCH" || opinion.vote === "SKIP" ? opinion.vote : undefined,
    confidence: asFiniteNumber(opinion.confidence) ?? undefined,
    kind: "challenge",
    emoji: "💬",
  };
}

function verdictTurn(opinion: IndependentEntityOpinion | undefined): MeetingTurn | null {
  if (!opinion) return null;
  const cio = ENTITY_BY_ID.get("cio")!;
  return {
    botId: "cio",
    botName: opinion.agentName || cio.name,
    shortName: cio.shortName,
    color: cio.color,
    portrait: cio.portrait,
    message: opinion.thesis,
    vote: opinion.vote === "BUY" || opinion.vote === "WATCH" || opinion.vote === "SKIP" ? opinion.vote : undefined,
    confidence: asFiniteNumber(opinion.confidence) ?? undefined,
    kind: "verdict",
  };
}

function vetoTurn(): MeetingTurn {
  return {
    botId: "executor",
    botName: "Executor",
    shortName: "EX",
    color: "#ff5f6d",
    portrait: "/bots/bouncer.jpg", // the gate at the door — execution stops here
    message: "Executor veto: BLOCK. Deterministic guardrails stop execution regardless of council consensus.",
    vote: "BLOCK",
    kind: "veto",
    emoji: "⛔",
  };
}

function systemBlocksTurn(hardBlocks: string[] | undefined): MeetingTurn | null {
  if (!hardBlocks?.length) return null;
  return {
    botId: "council",
    botName: "Council",
    shortName: "CR",
    color: "#e8e8e8",
    portrait: DEFAULT_PORTRAIT,
    message: `Hard risk blocks: ${hardBlocks.join(" · ")}`,
    kind: "system",
    emoji: "⚠️",
  };
}

export function buildMeetingFromWarRoomResult(result: WarRoomResult): CouncilRoomData["meeting"] {
  if (!result) return null;
  const snapshot: MarketSnapshot | undefined = result.snapshot;
  const symbol = snapshot?.symbol;
  const chain = snapshot?.chain;

  const turns: MeetingTurn[] = [];
  for (const agent of result.agents ?? []) turns.push(scoreTurn(agent));

  const meetingOpinions = result.independentCouncil?.meetingOpinions ?? [];
  for (const opinion of meetingOpinions) {
    const turn = challengeTurn(opinion);
    if (turn) turns.push(turn);
  }

  const verdict = verdictTurn(result.independentCouncil?.cioOpinion);
  if (verdict) turns.push(verdict);

  if (result.councilProcess?.executorVote === "BLOCK") turns.push(vetoTurn());

  const blocks = systemBlocksTurn(result.risk?.hardBlocks);
  if (blocks) turns.push(blocks);

  return {
    title: `${symbol ?? "Unknown token"} council session`,
    symbol,
    chain,
    at: result.generatedAt,
    decision: result.decision,
    conviction: result.conviction,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Fallback: meeting construction from a cabinet-export journal decision
// ---------------------------------------------------------------------------

function cabinetDecisionToVote(decision: string): MeetingTurn["vote"] {
  switch ((decision ?? "").toUpperCase()) {
    case "BUY": return "BUY";
    case "WATCH": return "WATCH";
    case "SKIP": return "SKIP";
    case "EXIT": return "EXIT";
    case "BLOCK": return "BLOCK";
    case "READY": return "READY";
    case "REDUCE": return "REDUCE";
    default: return undefined;
  }
}

export function buildMeetingFromCabinetDecision(d: CabinetDecision): CouncilRoomData["meeting"] {
  if (!d) return null;
  const council = d.council ?? null;
  const reasons = council?.reasons ?? [];
  const turns: MeetingTurn[] = reasons.map((reason, index) => ({
    botId: "council",
    botName: "Council",
    shortName: "CR",
    color: "#e8e8e8",
    portrait: DEFAULT_PORTRAIT,
    message: `Reason ${index + 1}/${reasons.length} — ${reason}`,
    kind: "system" as const,
  }));

  if (council?.executorVote === "BLOCK") turns.push(vetoTurn());

  const cio = ENTITY_BY_ID.get("cio")!;
  const upbeat = ["BUY", "WATCH", "READY"].includes((d.decision ?? "").toUpperCase());
  turns.push({
    botId: "cio",
    botName: cio.name,
    shortName: cio.shortName,
    color: cio.color,
    portrait: cio.portrait,
    message: council
      ? `Council ${d.decision}: ${council.alignedBots}/${council.totalBots} bots aligned via the ${council.lane} lane.`
      : `Council ${d.decision}.`,
    vote: cabinetDecisionToVote(d.decision),
    confidence: asFiniteNumber(d.conviction) ?? undefined,
    kind: "verdict",
    emoji: upbeat ? "✅" : "⛔",
  });

  return {
    title: `${d.symbol ?? "Unknown token"} council session`,
    symbol: d.symbol,
    chain: d.chain,
    at: d.at,
    decision: d.decision,
    conviction: d.conviction,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Defensive fetching (client-side). NEVER throws; returns best-effort data.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 12_000;

async function getJson<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type AutopilotPayload = {
  recentDecisions?: WarRoomResult[];
  paperWallet?: Record<string, unknown>;
  positions?: Array<Record<string, unknown>>;
  research?: Record<string, unknown>;
  councilDecisionsCompleted?: number;
  buyCount?: number;
  scanCount?: number;
};

type CabinetPayload = {
  decisions?: CabinetDecision[];
  accumulatedKnowledge?: Record<string, unknown>;
  summary?: Record<string, unknown>;
};

type JournalPayload = {
  rows?: Array<{ createdAt?: string; portfolioEquityAfterUsd?: number | null }>;
};

function num(value: unknown): number | null {
  return asFiniteNumber(value);
}

function fmtUsd(value: number | null): string {
  return value == null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export async function fetchCouncilRoomData(): Promise<CouncilRoomData> {
  const empty: CouncilRoomData = {
    meeting: null,
    bots: [],
    wallet: { equityUsd: null, cashUsd: null, realizedPnlUsd: null, unrealizedPnlUsd: null },
    stats: [],
    equitySeries: [],
    statusNote: "All endpoints unavailable — showing empty state.",
  };

  try {
    // (a) Autopilot status — richest source: recent decisions, wallet, positions, research.
    const autopilot = await getJson<AutopilotPayload>("/api/autopilot");
    // (b) Cabinet main — decision history + accumulated research (fallback for the meeting).
    // The deployed route is /api/cabinets/main (plural); /api/cabinet/main is the
    // flat-tree alias kept for local prepare-structure checkouts.
    const cabinet =
      (await getJson<CabinetPayload>("/api/cabinets/main")) ??
      (await getJson<CabinetPayload>("/api/cabinet/main"));
    // (c) Journal fills — equity series from portfolioEquityAfterUsd.
    const journal = await getJson<JournalPayload>("/api/journal?limit=500");
    // (d) Positions light — fallback position list.
    const positionsRoute = await getJson<Array<Record<string, unknown>> | { positions?: Array<Record<string, unknown>> }>("/api/positions?light=1");

    const walletRaw: Record<string, unknown> | undefined =
      (autopilot?.paperWallet as Record<string, unknown> | undefined) ?? undefined;

    // Positions: prefer autopilot, then the positions endpoint. The endpoint may
    // return an array or an object wrapping one.
    const positions: Array<Record<string, unknown>> =
      (Array.isArray(autopilot?.positions) ? autopilot.positions : []) as Array<Record<string, unknown>>;
    if (!positions.length) {
      const pr = positionsRoute as Array<Record<string, unknown>> | { positions?: Array<Record<string, unknown>> } | null;
      if (Array.isArray(pr)) positions.push(...pr);
      else if (pr && Array.isArray(pr.positions)) positions.push(...pr.positions);
    }

    // ---- Meeting: (a) recentDecisions[0] preferred, else (b) cabinet decisions[0].
    let meeting = empty.meeting;
    let meetingSource = "";
    const latestDecision: WarRoomResult | undefined = autopilot?.recentDecisions?.[0];
    if (latestDecision) {
      meeting = buildMeetingFromWarRoomResult(latestDecision);
      meetingSource = "live council";
    } else {
      const cabinetDecision = cabinet?.decisions?.[0];
      if (cabinetDecision) {
        meeting = buildMeetingFromCabinetDecision(cabinetDecision);
        meetingSource = "cabinet history";
      }
    }

    // ---- Wallet P&L. PaperWalletSnapshot fields: cashUsd, equityUsd,
    // realizedPnlUsd, unrealizedPnlUsd (verified in lib/paper-wallet.ts).
    // Defensive alternates (cash/equity) in case an endpoint reshapes the wallet.
    const equityUsd = num(walletRaw?.equityUsd ?? walletRaw?.equity);
    const cashUsd = num(walletRaw?.cashUsd ?? walletRaw?.cash);
    let realizedPnlUsd = num(walletRaw?.realizedPnlUsd);
    let unrealizedPnlUsd = num(walletRaw?.unrealizedPnlUsd);
    if (unrealizedPnlUsd == null && positions.length) {
      // Fallback: sum mark value minus remaining cost across open positions.
      let sum = 0;
      let found = false;
      for (const position of positions) {
        const qty = num(position.remainingQuantity);
        const mark = num(position.markPrice);
        const cost = num(position.remainingNotionalUsd);
        if (qty != null && mark != null && cost != null) {
          sum += Math.max(0, qty) * Math.max(0, mark) - cost;
          found = true;
        }
      }
      if (found) unrealizedPnlUsd = Number(sum.toFixed(2));
    }

    // ---- Bots: the 8 entities, status from latest-meeting participation,
    // latest vote/confidence from the meeting turns.
    const voteByBot = new Map<string, { vote?: string; confidence?: number; active: boolean }>();
    if (meeting) {
      for (const turn of meeting.turns) {
        const entry = voteByBot.get(turn.botId) ?? { active: false };
        entry.active = true;
        // Later turns are fresher (challenges after scores, verdict last).
        if (turn.vote) entry.vote = turn.vote;
        if (turn.confidence != null) entry.confidence = turn.confidence;
        voteByBot.set(turn.botId, entry);
      }
    }
    const bots: CouncilBotVM[] = ENTITY_DIRECTORY.map((entity) => {
      const latest = voteByBot.get(entity.id);
      return {
        id: entity.id,
        name: entity.name,
        shortName: entity.shortName,
        color: entity.color,
        portrait: entity.portrait,
        role: entity.role,
        mission: entity.mission,
        status: latest?.active ? "LIVE" : "IDLE",
        latestVote: latest?.vote,
        latestConfidence: latest?.confidence,
      };
    });

    // ---- Stats: ONLY real numbers, never hardcoded.
    const stats: { label: string; value: string }[] = [];
    const pushStat = (label: string, value: number | null, format: (v: number) => string = (v) => v.toLocaleString("en-US")) => {
      if (value != null) stats.push({ label, value: format(value) });
    };
    pushStat("Council decisions", num(autopilot?.councilDecisionsCompleted));
    pushStat("Open positions", positions.length ? positions.length : null);
    pushStat("Wallet equity", equityUsd, fmtUsd);
    pushStat("Paper buys", num(autopilot?.buyCount));
    pushStat("Scans", num(autopilot?.scanCount));
    const research = (autopilot?.research ?? cabinet?.accumulatedKnowledge ?? null) as Record<string, unknown> | null;
    if (research) {
      pushStat("Cases studied", num(research.casesStudied));
      pushStat("Observations", num(research.observations));
      pushStat("Runner cases", num(research.runnerCases));
      pushStat("Dumper cases", num(research.dumperCases));
    }

    // ---- Equity series: journal fills' portfolioEquityAfterUsd, ascending time.
    const equitySeries: number[] = [];
    const rows = journal?.rows ?? [];
    const ordered = [...rows]
      .filter((row) => row && num(row.portfolioEquityAfterUsd) != null)
      .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    for (const row of ordered) {
      const value = num(row.portfolioEquityAfterUsd);
      if (value != null) equitySeries.push(value);
    }

    // ---- Status note.
    const sources: string[] = [];
    if (autopilot) sources.push("autopilot");
    if (cabinet) sources.push("cabinet");
    if (journal) sources.push("journal");
    if (positionsRoute) sources.push("positions");
    const statusNote = sources.length
      ? `Data from ${sources.join(", ")}${meetingSource ? ` · meeting from ${meetingSource}` : ""}.`
      : "All endpoints unavailable — showing empty state.";

    return {
      meeting,
      bots,
      wallet: { equityUsd, cashUsd, realizedPnlUsd, unrealizedPnlUsd },
      stats,
      equitySeries,
      statusNote,
    };
  } catch {
    // Defensive: the contract is to never throw.
    return empty;
  }
}
