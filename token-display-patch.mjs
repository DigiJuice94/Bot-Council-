import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[v2.23-token-display] ${message}`);
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
  console.log(`[v2.23-token-display] patched ${rel}`);
}

export function applyTokenDisplayPatch(root = process.cwd()) {
  patchFile(root, "lib/types.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  name: string;\n  tokenAddress: string;',
      '  name: string;\n  imageUrl?: string;\n  tokenAddress: string;',
      "MarketSnapshot imageUrl"
    );
    text = replaceRequired(
      text,
      '  tokenAddress: string;\n  symbol: string;\n  strategyId: string;',
      '  tokenAddress: string;\n  symbol: string;\n  imageUrl?: string;\n  strategyId: string;',
      "ManagedPosition imageUrl"
    );
    return text;
  });

  patchFile(root, "lib/market-data.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '  info?: { socials?: Array<{ platform?: string; handle?: string }> | null } | null;',
      '  info?: { imageUrl?: string; socials?: Array<{ platform?: string; handle?: string }> | null } | null;',
      "DexPair imageUrl"
    );
    text = replaceRequired(
      text,
      '  name?: string;\n};',
      '  name?: string;\n  imageUrl?: string;\n};',
      "DiscoveryToken imageUrl"
    );
    text = replaceRequired(
      text,
      '    name: row?.name ? String(row.name) : undefined,\n  };',
      `    name: row?.name ? String(row.name) : undefined,
    imageUrl: [row?.imageUrl, row?.image_url, row?.logoURI, row?.logo_uri, row?.logoUrl, row?.logo, row?.icon]
      .find((value) => typeof value === "string" && /^https?:\\/\\//i.test(value)) as string | undefined,
  };`,
      "discovery image extraction"
    );
    text = replaceRequired(
      text,
      '      name: String(attrs.name ?? "").slice(0, 80) || undefined,\n    });',
      `      name: String(attrs.name ?? "").slice(0, 80) || undefined,
      imageUrl: typeof attrs.image_url === "string" && /^https?:\\/\\//i.test(attrs.image_url) ? attrs.image_url : undefined,
    });`,
      "Gecko image extraction"
    );
    text = replaceRequired(
      text,
      'function snapshotFromPair(chain: Chain, pair: DexPair, security: SecurityResult, discoverySource: DiscoveryToken["source"] = "dexscreener"): MarketSnapshot | null {',
      'function snapshotFromPair(chain: Chain, pair: DexPair, security: SecurityResult, discoverySource: DiscoveryToken["source"] = "dexscreener", fallbackImageUrl?: string): MarketSnapshot | null {',
      "snapshot image fallback arg"
    );
    text = replaceRequired(
      text,
      '    name: String(pair.baseToken?.name ?? pair.baseToken?.symbol ?? "Unknown token").slice(0, 80),\n    tokenAddress, chain,',
      `    name: String(pair.baseToken?.name ?? pair.baseToken?.symbol ?? "Unknown token").slice(0, 80),
    imageUrl: typeof pair.info?.imageUrl === "string" && /^https?:\\/\\//i.test(pair.info.imageUrl)
      ? pair.info.imageUrl
      : fallbackImageUrl,
    tokenAddress, chain,`,
      "snapshot image assignment"
    );
    text = replaceRequired(
      text,
      '    const snapshot = snapshotFromPair(chain, pair, security, token?.source ?? "dexscreener");',
      '    const snapshot = snapshotFromPair(chain, pair, security, token?.source ?? "dexscreener", token?.imageUrl);',
      "candidate image fallback"
    );
    text = replaceRequired(
      text,
      '  return snapshotFromPair(position.chain, pair, security, process.env.BIRDEYE_API_KEY && BIRDEYE_CHAIN[position.chain] ? "birdeye" : "dexscreener");',
      '  return snapshotFromPair(position.chain, pair, security, process.env.BIRDEYE_API_KEY && BIRDEYE_CHAIN[position.chain] ? "birdeye" : "dexscreener", position.imageUrl);',
      "position image fallback"
    );
    return text;
  });

  patchFile(root, "lib/position-manager.ts", (input) => {
    let text = input;
    text = replaceRequired(
      text,
      '    symbol: fill.symbol,\n    strategyId: request.strategyId,',
      '    symbol: fill.symbol,\n    imageUrl: snapshot.imageUrl,\n    strategyId: request.strategyId,',
      "persist image at entry"
    );
    text = replaceRequired(
      text,
      '    status,\n    markPrice: mark,',
      '    status,\n    imageUrl: snapshot.imageUrl ?? position.imageUrl,\n    markPrice: mark,',
      "refresh image during Guardian mark"
    );
    return text;
  });

  console.log("[v2.23-token-display] Token images now flow from live providers into decision cards and managed positions when available.");
}
