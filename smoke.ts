import { runWarRoom } from "../lib/engine";
import { createBaseSnapshot } from "../lib/mock-market";
import { executePaper } from "../lib/execution";

async function main() {
  const chains = ["Solana", "Ethereum", "Base", "BNB Chain", "Monad", "Robinhood Chain"] as const;
  for (const chain of chains) {
    const result = runWarRoom(createBaseSnapshot(chain));
    if (result.agents.length !== 8) throw new Error(`${chain}: expected 8 agents`);
    if (!result.risk.passed) throw new Error(`${chain}: demo snapshot should pass risk`);
    if (result.experiment.stage !== "paper") throw new Error(`${chain}: strategy should be paper stage`);
    if (result.execution.allowed && result.execution.request) {
      const fill = await executePaper(result.execution.request, result.snapshot);
      if (fill.chain !== chain) throw new Error(`${chain}: paper fill routed to wrong chain`);
    }
  }

  const blocked = createBaseSnapshot("Base");
  blocked.honeypot = true;
  const blockedResult = runWarRoom(blocked);
  if (blockedResult.risk.passed) throw new Error("Honeypot must be vetoed");
  if (blockedResult.execution.allowed) throw new Error("Risk-vetoed trade must not create an order");

  console.log("V2 smoke tests passed across 6 chains + deterministic veto test.");
}

void main();
