import type { AgentPerformance, ResearchAgentId, ResearchAgentWeights } from "./types";

export const DEFAULT_AGENT_WEIGHTS: ResearchAgentWeights = {
  launch: 0.12,
  social: 0.10,
  wallet: 0.18,
  quant: 0.23,
  contract: 0.27,
  bear: 0.10,
};

const researchIds: ResearchAgentId[] = ["launch", "social", "wallet", "quant", "contract", "bear"];

export function normalizeResearchWeights(input: Partial<ResearchAgentWeights>): ResearchAgentWeights {
  const raw = researchIds.map((id) => Math.max(0.04, Number(input[id] ?? DEFAULT_AGENT_WEIGHTS[id])));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(researchIds.map((id, index) => [id, raw[index] / total])) as ResearchAgentWeights;
}

export function weightsFromPerformance(records: AgentPerformance[]): ResearchAgentWeights {
  if (!records.length) return DEFAULT_AGENT_WEIGHTS;
  const map = new Map(records.map((record) => [record.agentId, record]));
  const proposed: Partial<ResearchAgentWeights> = {};
  for (const id of researchIds) {
    const record = map.get(id);
    if (!record || record.observations < 30) {
      proposed[id] = DEFAULT_AGENT_WEIGHTS[id];
      continue;
    }
    const directionalLift = Math.max(-0.25, Math.min(0.25, (record.directionalAccuracyPct - 50) / 100));
    const reasoningLift = Math.max(-0.15, Math.min(0.15, (record.reasoningAccuracyPct - 50) / 125));
    const edgeLift = Math.max(-0.18, Math.min(0.18, record.avgEdgePct / 50));
    proposed[id] = DEFAULT_AGENT_WEIGHTS[id] * (1 + directionalLift + reasoningLift + edgeLift);
  }
  return normalizeResearchWeights(proposed);
}

export function scoreAgentOutcome(score: number, realizedReturnPct: number) {
  const expectedUp = score >= 58;
  const realizedUp = realizedReturnPct > 0;
  return { correct: expectedUp === realizedUp, edgePct: realizedReturnPct * ((score - 50) / 50) };
}
