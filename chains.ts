import type { Chain, ChainFamily } from "./types";

export type ChainConfig = {
  id: string;
  name: Chain;
  family: ChainFamily;
  nativeSymbol: string;
  paperVenue: string;
  executionAdapter: "jupiter" | "evm-router";
  enabled: boolean;
};

export const CHAINS: ChainConfig[] = [
  { id: "solana", name: "Solana", family: "solana", nativeSymbol: "SOL", paperVenue: "Jupiter Paper", executionAdapter: "jupiter", enabled: true },
  { id: "ethereum", name: "Ethereum", family: "evm", nativeSymbol: "ETH", paperVenue: "EVM Paper Router", executionAdapter: "evm-router", enabled: true },
  { id: "base", name: "Base", family: "evm", nativeSymbol: "ETH", paperVenue: "EVM Paper Router", executionAdapter: "evm-router", enabled: true },
  { id: "bnb", name: "BNB Chain", family: "evm", nativeSymbol: "BNB", paperVenue: "EVM Paper Router", executionAdapter: "evm-router", enabled: true },
  { id: "monad", name: "Monad", family: "evm", nativeSymbol: "MON", paperVenue: "EVM Paper Router", executionAdapter: "evm-router", enabled: true },
  { id: "robinhood", name: "Robinhood Chain", family: "evm", nativeSymbol: "ETH", paperVenue: "EVM Paper Router", executionAdapter: "evm-router", enabled: true },
];

export function getChainConfig(chain: Chain): ChainConfig {
  const config = CHAINS.find((item) => item.name === chain);
  if (!config) throw new Error(`Unsupported chain: ${chain}`);
  return config;
}
