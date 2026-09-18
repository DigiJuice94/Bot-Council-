import type { MarketSnapshot } from "./types";

export function sellabilityUnverified(snapshot: MarketSnapshot): boolean {
  const source = snapshot.dataProvenance;
  return Boolean(source?.live && source.marketSource !== "adapter" && !source.quality?.sellability);
}

export function confirmedSellabilityFailure(snapshot: MarketSnapshot): boolean {
  return snapshot.sellable === false && !sellabilityUnverified(snapshot);
}
