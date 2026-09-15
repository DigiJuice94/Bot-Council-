import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.15-chain-patch] ${message}`);
  process.exit(1);
}

function replaceRequired(text, search, replacement, label) {
  if (!text.includes(search)) fail(`Could not find patch anchor: ${label}`);
  return text.replace(search, replacement);
}

function patchFile(root, rel, fn) {
  const path = resolve(root, rel);
  if (!existsSync(path)) fail(`Missing generated file ${rel}`);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) fail(`Patch produced no change for ${rel}`);
  writeFileSync(path, after);
  console.log(`[v2.15-chain-patch] patched ${rel}`);
}

export function applyFreshChainPatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  | "Monad"\n  | "Robinhood Chain";',
      '  | "Monad"\n  | "HyperEVM"\n  | "Robinhood Chain";',
      "Chain union"
    );
    text = replaceRequired(
      text,
      'marketSource: "adapter" | "birdeye" | "dexscreener";',
      'marketSource: "adapter" | "birdeye" | "geckoterminal" | "dexscreener";',
      "DataProvenance marketSource"
    );
    text = replaceRequired(
      text,
      'name: "birdeye" | "dexscreener" | "goplus" | "helius" | "jupiter" | "redis";',
      'name: "birdeye" | "geckoterminal" | "dexscreener" | "goplus" | "helius" | "jupiter" | "redis";',
      "ProviderHealth name union"
    );
    return text;
  });

  patchFile(root, "lib/chains.ts", (input) => {
    const anchor = '{id:"monad",name:"Monad",family:"evm",nativeSymbol:"MON",paperVenue:"EVM Paper Router",executionAdapter:"evm-router",enabled:true},{id:"robinhood"';
    const replacement = '{id:"monad",name:"Monad",family:"evm",nativeSymbol:"MON",paperVenue:"EVM Paper Router",executionAdapter:"evm-router",enabled:true},{id:"hyperevm",name:"HyperEVM",family:"evm",nativeSymbol:"HYPE",paperVenue:"EVM Paper Router",executionAdapter:"evm-router",enabled:true},{id:"robinhood"';
    return replaceRequired(input, anchor, replacement, "HyperEVM chain config");
  });

  patchFile(root, "lib/provider-health.ts", (input) => {
    return replaceRequired(
      input,
      'const names: ProviderName[] = ["birdeye", "dexscreener", "goplus", "helius", "jupiter", "redis"];',
      'const names: ProviderName[] = ["birdeye", "geckoterminal", "dexscreener", "goplus", "helius", "jupiter", "redis"];',
      "provider health list"
    );
  });

  patchFile(root, "lib/market-data.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      'const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";',
      'const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";\nconst GECKO_BASE = "https://api.geckoterminal.com/api/v2";\nconst GECKO_CACHE_MS = 60_000;',
      "GeckoTerminal constants"
    );
    text = replaceRequired(
      text,
      '  Monad: "monad",\n  "Robinhood Chain": "robinhood",',
      '  Monad: "monad",\n  HyperEVM: "hyperevm",\n  "Robinhood Chain": "robinhood",',
      "DEX HyperEVM mapping"
    );
    text = replaceRequired(
      text,
      'const BIRDEYE_CHAIN: Partial<Record<Chain, string>> = {',
      'const GECKO_CHAIN: Partial<Record<Chain, string>> = {\n  Solana: "solana",\n  Ethereum: "eth",\n  Base: "base",\n  "BNB Chain": "bsc",\n  Monad: "monad",\n  HyperEVM: "hyperevm",\n};\n\nconst BIRDEYE_CHAIN: Partial<Record<Chain, string>> = {',
      "GeckoTerminal chain map"
    );
    text = replaceRequired(
      text,
      'source: "birdeye" | "dexscreener";',
      'source: "birdeye" | "geckoterminal" | "dexscreener";',
      "DiscoveryToken source"
    );
    text = replaceRequired(
      text,
      '  __bwrDexDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;',
      '  __bwrDexDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;\n  __bwrGeckoDiscoveryCache?: Map<string, { at: number; tokens: DiscoveryToken[] }>;',
      "Gecko cache type"
    );
    text = replaceRequired(
      text,
      'const dexDiscoveryCache = globalCache.__bwrDexDiscoveryCache ??= new Map();',
      'const dexDiscoveryCache = globalCache.__bwrDexDiscoveryCache ??= new Map();\nconst geckoDiscoveryCache = globalCache.__bwrGeckoDiscoveryCache ??= new Map();',
      "Gecko cache instance"
    );
    text = replaceRequired(
      text,
      'async function fetchJson<T>(url: string, provider: "birdeye" | "dexscreener" | "goplus" | "helius",',
      'async function fetchJson<T>(url: string, provider: "birdeye" | "geckoterminal" | "dexscreener" | "goplus" | "helius",',
      "fetchJson provider union"
    );

    const geckoFunction = `async function geckoNewPools(chain: Chain): Promise<DiscoveryToken[]> {
  const network = GECKO_CHAIN[chain];
  if (!network) return [];
  const cached = geckoDiscoveryCache.get(network);
  if (cached && Date.now() - cached.at < GECKO_CACHE_MS) return cached.tokens;

  const payload = await fetchJson<any>(
    \`\${GECKO_BASE}/networks/\${network}/new_pools?page=1&include=base_token\`,
    "geckoterminal",
    { headers: { Accept: "application/json;version=20230203" } }
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const tokens: DiscoveryToken[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const relId = String(row?.relationships?.base_token?.data?.id ?? "");
    const prefix = \`\${network}_\`;
    const tokenAddress = relId.startsWith(prefix) ? relId.slice(prefix.length) : relId.includes("_") ? relId.slice(relId.indexOf("_") + 1) : relId;
    if (tokenAddress.length < 8) continue;
    const key = tokenAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const attrs = row?.attributes ?? {};
    const created = Date.parse(String(attrs.pool_created_at ?? ""));
    tokens.push({
      chainId: DEX_CHAIN[chain],
      tokenAddress,
      source: "geckoterminal",
      listedAt: Number.isFinite(created) ? created : undefined,
      reportedLiquidity: optionalNum(attrs.reserve_in_usd),
      symbol: undefined,
      name: String(attrs.name ?? "").slice(0, 80) || undefined,
    });
  }

  geckoDiscoveryCache.set(network, { at: Date.now(), tokens: tokens.slice(0, 30) });
  return tokens.slice(0, 30);
}

`;

    text = replaceRequired(
      text,
      'async function birdeyeNewListings(chain: Chain): Promise<DiscoveryToken[]> {',
      geckoFunction + 'async function birdeyeNewListings(chain: Chain): Promise<DiscoveryToken[]> {',
      "insert Gecko new-pools discovery"
    );

    const oldDiscovery = `async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  const fromBirdeye = await birdeyeNewListings(chain);
  if (fromBirdeye.length) return fromBirdeye;
  // Public DEX discovery remains a real-data fallback, especially for Robinhood Chain.
  return dexDiscoveryTokens(chain);
}`;
    const newDiscovery = `async function discoveryTokens(chain: Chain): Promise<DiscoveryToken[]> {
  // Solana keeps Birdeye first because it can surface meme-native listings directly.
  if (chain === "Solana") {
    const fromBirdeye = await birdeyeNewListings(chain);
    if (fromBirdeye.length) return fromBirdeye;
    const fromGecko = await geckoNewPools(chain);
    if (fromGecko.length) return fromGecko;
    return dexDiscoveryTokens(chain);
  }

  // EVM chains prioritize actual newly-created pools instead of waiting for profiles/boosts.
  const fromGecko = await geckoNewPools(chain);
  if (fromGecko.length) return fromGecko;
  const fromBirdeye = await birdeyeNewListings(chain);
  if (fromBirdeye.length) return fromBirdeye;
  return dexDiscoveryTokens(chain);
}`;
    text = replaceRequired(text, oldDiscovery, newDiscovery, "discovery provider order");

    text = replaceRequired(
      text,
      '`${discoverySource === "birdeye" ? "Birdeye New Listing" : "DEX Screener live discovery"} found this real candidate; DEX Screener supplies live pair price/liquidity/volume/transactions.`,',
      '`${discoverySource === "birdeye" ? "Birdeye New Listing" : discoverySource === "geckoterminal" ? "GeckoTerminal New Pool" : "DEX Screener live discovery"} found this real candidate; DEX Screener supplies live pair price/liquidity/volume/transactions.`,',
      "candidate provenance note"
    );
    return text;
  });

  patchFile(root, "lib/autopilot.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      'const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"];',
      'const CHAINS: Chain[] = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "HyperEVM", "Robinhood Chain"];',
      "autopilot chain rotation"
    );
    text = replaceRequired(
      text,
      '  scanningChains: Chain[];\n  currentChain: Chain;',
      '  scanningChains: Chain[];\n  chainStats: Record<Chain, { scans: number; candidates: number; lastScanAt?: string; lastCandidateAt?: string }>;\n  currentChain: Chain;',
      "AutopilotStatus chainStats"
    );
    text = replaceRequired(
      text,
      '    scanningChains: CHAINS,\n    currentChain: CHAINS[0],',
      '    scanningChains: CHAINS,\n    chainStats: Object.fromEntries(CHAINS.map((chain) => [chain, { scans: 0, candidates: 0 }])) as Record<Chain, { scans: number; candidates: number; lastScanAt?: string; lastCandidateAt?: string }>,\n    currentChain: CHAINS[0],',
      "initial chainStats"
    );
    text = replaceRequired(
      text,
      '  current.scanCount += 1;\n\n  const bankroll',
      '  current.scanCount += 1;\n  const chainStat = current.chainStats[chain] ??= { scans: 0, candidates: 0 };\n  chainStat.scans += 1;\n  chainStat.lastScanAt = current.lastScanAt;\n\n  const bankroll',
      "per-chain scan telemetry"
    );
    text = replaceRequired(
      text,
      '  current.candidateCount += 1;\n  current.funnel.candidates += 1;',
      '  current.candidateCount += 1;\n  current.funnel.candidates += 1;\n  current.chainStats[chain].candidates += 1;\n  current.chainStats[chain].lastCandidateAt = new Date().toISOString();',
      "per-chain candidate telemetry"
    );
    return text;
  });

  console.log("[v2.15-chain-patch] Fresh-chain expansion complete: Solana, Ethereum, Base, BNB Chain, Monad, HyperEVM, Robinhood Chain.");
}
