import { createClient } from "redis";
import type { ManagedPosition, MarketSnapshot } from "./types";

const CASES_KEY = "bot-war-room:sellability-investigator:v1:cases";
const LEARNED_BLOCKS_KEY = "bot-war-room:sellability-investigator:v1:learned-blocks";
const MAX_CASES = 2_000;
const memoryCases = new Map<string, SellabilityCase>();
const memoryLearnedBlocks = new Map<string, SellabilityLearnedBlock>();
let redisPromise: Promise<any | null> | null = null;

export type SellabilityFingerprint = {
  liquidityUsd: number;
  marketCapUsd: number;
  liquidityToMc: number;
  volumeToLiquidity: number;
  holders: number;
  top10Pct: number;
  bundledPct: number;
  buyTaxPct: number;
  sellTaxPct: number;
  buySellRatio: number;
  liquidityLocked: boolean;
  ownershipRenounced: boolean;
  proxyContract: boolean;
  mintAuthority: boolean;
  freezeAuthority: boolean;
  verifiedSellability: boolean;
  verifiedHoneypot: boolean;
  verifiedLiquidityLock: boolean;
  verifiedAuthorities: boolean;
};

export type SellabilityCase = {
  id: string;
  positionId: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  recordedAt: string;
  reason: string;
  lossUsd: number;
  fingerprint: SellabilityFingerprint;
};

export type SellabilityGuidance = {
  riskScore: number;
  confidence: number;
  sampleSize: number;
  chainSampleSize: number;
  similarCases: number;
  learnedBlock: boolean;
  verifiedBlock: boolean;
  nearestSimilarityPct: number;
  evidence: string[];
};

export type SellabilityLearnedBlock = {
  id: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  blockedAt: string;
  riskScore: number;
  similarCases: number;
};

export type SellabilityLearningSnapshot = {
  casesFiled: number;
  chainCoverage: number;
  totalLockedLossUsd: number;
  learnedCandidatesBlocked: number;
  latestCaseAt?: string;
  latestCaseSymbol?: string;
  latestBlockAt?: string;
  latestBlockSymbol?: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (error: unknown) => console.error("[sellability-investigator] redis", error));
        await client.connect();
        return client;
      } catch (error) {
        console.error("[sellability-investigator] redis unavailable; using memory", error);
        return null;
      }
    })();
  }
  return redisPromise;
}

function fingerprint(snapshot: MarketSnapshot): SellabilityFingerprint {
  const marketCap = Math.max(0, finite(snapshot.marketCap));
  const liquidity = Math.max(0, finite(snapshot.liquidity));
  const quality = snapshot.dataProvenance?.quality;
  return {
    liquidityUsd: liquidity,
    marketCapUsd: marketCap,
    liquidityToMc: marketCap > 0 ? liquidity / marketCap : 0,
    volumeToLiquidity: liquidity > 0 ? Math.max(0, finite(snapshot.volume24h)) / liquidity : 99,
    holders: Math.max(0, finite(snapshot.holders)),
    top10Pct: clamp(finite(snapshot.top10Pct)),
    bundledPct: clamp(finite(snapshot.bundledPct)),
    buyTaxPct: clamp(finite(snapshot.buyTaxPct)),
    sellTaxPct: clamp(finite(snapshot.sellTaxPct)),
    buySellRatio: Math.max(0, finite(snapshot.buySellRatio, 1)),
    liquidityLocked: Boolean(snapshot.liquidityLocked),
    ownershipRenounced: Boolean(snapshot.ownershipRenounced),
    proxyContract: Boolean(snapshot.proxyContract),
    mintAuthority: Boolean(snapshot.mintAuthority),
    freezeAuthority: Boolean(snapshot.freezeAuthority),
    verifiedSellability: Boolean(quality?.sellability),
    verifiedHoneypot: Boolean(quality?.honeypot),
    verifiedLiquidityLock: Boolean(quality?.liquidityLock),
    verifiedAuthorities: Boolean(quality?.authorities),
  };
}

function logDistance(a: number, b: number, scale = 3) {
  return Math.min(1, Math.abs(Math.log10(Math.max(a, 1)) - Math.log10(Math.max(b, 1))) / scale);
}

function linearDistance(a: number, b: number, scale: number) {
  return Math.min(1, Math.abs(a - b) / Math.max(scale, 1e-9));
}

function similarity(a: SellabilityFingerprint, b: SellabilityFingerprint) {
  const distances = [
    logDistance(a.liquidityUsd, b.liquidityUsd, 2.5) * 1.8,
    logDistance(a.marketCapUsd, b.marketCapUsd, 3) * 0.7,
    linearDistance(a.liquidityToMc, b.liquidityToMc, 0.8) * 1.4,
    linearDistance(a.volumeToLiquidity, b.volumeToLiquidity, 10) * 0.7,
    logDistance(a.holders, b.holders, 2.5) * 0.7,
    linearDistance(a.top10Pct, b.top10Pct, 55) * 1.2,
    linearDistance(a.bundledPct, b.bundledPct, 30) * 1.1,
    linearDistance(a.sellTaxPct, b.sellTaxPct, 18) * 1.2,
    linearDistance(a.buySellRatio, b.buySellRatio, 4) * 0.5,
    (a.liquidityLocked === b.liquidityLocked ? 0 : 1) * 0.8,
    (a.ownershipRenounced === b.ownershipRenounced ? 0 : 1) * 0.5,
    (a.proxyContract === b.proxyContract ? 0 : 1) * 0.4,
    (a.mintAuthority === b.mintAuthority ? 0 : 1) * 0.8,
    (a.freezeAuthority === b.freezeAuthority ? 0 : 1) * 1.1,
    (a.verifiedSellability === b.verifiedSellability ? 0 : 1) * 0.9,
    (a.verifiedHoneypot === b.verifiedHoneypot ? 0 : 1) * 0.9,
  ];
  const totalWeight = 14.7;
  return clamp(100 * (1 - distances.reduce((sum, value) => sum + value, 0) / totalWeight));
}

async function allCases(): Promise<SellabilityCase[]> {
  const redis = await getRedis();
  if (!redis) return [...memoryCases.values()];
  const rows = await redis.hGetAll(CASES_KEY) as Record<string, string>;
  return Object.values(rows).flatMap((raw) => {
    try { return [JSON.parse(raw) as SellabilityCase]; } catch { return []; }
  });
}

export async function recordUnsellableCase(position: ManagedPosition, finalSnapshot?: MarketSnapshot) {
  if (position.status !== "unsellable") return;
  const entrySnapshot = position.entryContext?.snapshot ?? finalSnapshot;
  if (!entrySnapshot) return;
  const row: SellabilityCase = {
    id: `${position.chain}:${position.tokenAddress.toLowerCase()}:${position.id}`,
    positionId: position.id,
    chain: position.chain,
    tokenAddress: position.tokenAddress,
    symbol: position.symbol,
    recordedAt: position.unsellableAt ?? position.closedAt ?? position.updatedAt,
    reason: position.unsellableReason ?? position.lastReason,
    lossUsd: Math.max(0, position.lockedCapitalLossUsd ?? -position.realizedPnlUsd),
    fingerprint: fingerprint(entrySnapshot),
  };
  memoryCases.set(row.id, row);
  const redis = await getRedis();
  if (!redis) return;
  await redis.hSet(CASES_KEY, row.id, JSON.stringify(row));
  const count = await redis.hLen(CASES_KEY);
  if (count <= MAX_CASES) return;
  const rows = await redis.hGetAll(CASES_KEY) as Record<string, string>;
  const oldest = Object.entries(rows)
    .flatMap(([id, raw]) => { try { return [{ id, row: JSON.parse(raw) as SellabilityCase }]; } catch { return []; } })
    .sort((a, b) => a.row.recordedAt.localeCompare(b.row.recordedAt))
    .slice(0, count - MAX_CASES);
  if (oldest.length) await redis.hDel(CASES_KEY, oldest.map((item) => item.id));
}

export async function recordLearnedSellabilityBlock(snapshot: MarketSnapshot, guidance: SellabilityGuidance) {
  if (!guidance.learnedBlock) return;
  const id = `${snapshot.chain}:${snapshot.tokenAddress.toLowerCase()}`;
  const row: SellabilityLearnedBlock = {
    id,
    chain: snapshot.chain,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    blockedAt: new Date().toISOString(),
    riskScore: guidance.riskScore,
    similarCases: guidance.similarCases,
  };
  memoryLearnedBlocks.set(id, row);
  const redis = await getRedis();
  if (redis) await redis.hSet(LEARNED_BLOCKS_KEY, id, JSON.stringify(row));
}

export async function getSellabilityLearningSnapshot(): Promise<SellabilityLearningSnapshot> {
  const cases = await allCases();
  const redis = await getRedis();
  let blocks = [...memoryLearnedBlocks.values()];
  if (redis) {
    const rows = await redis.hGetAll(LEARNED_BLOCKS_KEY) as Record<string, string>;
    blocks = Object.values(rows).flatMap((raw) => {
      try { return [JSON.parse(raw) as SellabilityLearnedBlock]; } catch { return []; }
    });
  }
  const latestCase = [...cases].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const latestBlock = [...blocks].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt))[0];
  return {
    casesFiled: cases.length,
    chainCoverage: new Set(cases.map((row) => row.chain)).size,
    totalLockedLossUsd: Number(cases.reduce((sum, row) => sum + Math.max(0, row.lossUsd), 0).toFixed(2)),
    learnedCandidatesBlocked: blocks.length,
    latestCaseAt: latestCase?.recordedAt,
    latestCaseSymbol: latestCase?.symbol,
    latestBlockAt: latestBlock?.blockedAt,
    latestBlockSymbol: latestBlock?.symbol,
  };
}

export async function assessSellabilityRisk(snapshot: MarketSnapshot): Promise<SellabilityGuidance> {
  const current = fingerprint(snapshot);
  const verifiedBlock = !Number.isFinite(snapshot.liquidity) || snapshot.liquidity <= 0 ||
    snapshot.sellable === false || snapshot.honeypot === true ||
    (snapshot.chainFamily === "solana" && snapshot.freezeAuthority === true) ||
    Boolean(snapshot.launchpad?.detected && snapshot.launchpad.status !== "graduated");
  const cases = await allCases();
  const chainCases = cases.filter((row) => row.chain === snapshot.chain);
  const ranked = cases
    .map((row) => ({ row, similarity: similarity(current, row.fingerprint) * (row.chain === snapshot.chain ? 1 : 0.9) }))
    .sort((a, b) => b.similarity - a.similarity);
  const nearest = ranked[0]?.similarity ?? 0;
  const similar = ranked.filter((item) => item.similarity >= 78);
  const chainSimilar = similar.filter((item) => item.row.chain === snapshot.chain);
  const sampleConfidence = clamp(cases.length * 4 + chainCases.length * 3, 0, 92);
  const similarityPressure = similar.reduce((sum, item) => sum + Math.max(0, item.similarity - 72) * (item.row.chain === snapshot.chain ? 1.15 : 0.8), 0);
  const missingVerificationPressure = [current.verifiedSellability, current.verifiedHoneypot, current.verifiedLiquidityLock].filter((value) => !value).length * 6;
  const structuralPressure = (!current.liquidityLocked ? 5 : 0) + (current.freezeAuthority ? 30 : 0) + Math.max(0, current.top10Pct - 70) * 0.6 + Math.max(0, current.bundledPct - 20) * 0.8;
  const riskScore = verifiedBlock ? 100 : clamp(nearest * 0.42 + similarityPressure * 0.55 + missingVerificationPressure + structuralPressure);
  // Learned blocking requires repeated evidence. One odd loss can inform the vote,
  // but cannot single-handedly outlaw a legitimate early runner.
  const learnedBlock = !verifiedBlock && cases.length >= 3 && similar.length >= 2 && chainSimilar.length >= 1 && riskScore >= 85;
  const evidence = verifiedBlock
    ? [snapshot.liquidity <= 0 ? "Fresh market snapshot reports $0 executable liquidity." : snapshot.launchpad?.detected && snapshot.launchpad.status !== "graduated" ? `${snapshot.launchpad.platform} token is still bonding or lacks verified post-graduation DEX trading.` : !snapshot.sellable ? "Fresh security evidence reports the token is not sellable." : snapshot.honeypot ? "Fresh security evidence reports honeypot behavior." : "Fresh security evidence reports transfers can be frozen."]
    : cases.length === 0
      ? ["No unsellable outcomes have been filed yet; verified live safety evidence remains authoritative."]
      : [
          `Compared with ${cases.length} filed unsellable outcome${cases.length === 1 ? "" : "s"} (${chainCases.length} on ${snapshot.chain}).`,
          `${similar.length} close fingerprint match${similar.length === 1 ? "" : "es"}; nearest similarity ${nearest.toFixed(0)}%.`,
          learnedBlock ? "Repeated high-confidence unsellable pattern: entry must be blocked." : "Pattern evidence informs the Council vote but has not reached the repeated-case block standard.",
        ];
  return {
    riskScore: Math.round(riskScore),
    confidence: verifiedBlock ? 100 : Math.round(sampleConfidence),
    sampleSize: cases.length,
    chainSampleSize: chainCases.length,
    similarCases: similar.length,
    learnedBlock,
    verifiedBlock,
    nearestSimilarityPct: Number(nearest.toFixed(1)),
    evidence,
  };
}
