import type { AgentOpinion, IndependentAgentRead, ResearchAgentId } from "./types";

const researchIds: ResearchAgentId[] = ["launch", "social", "wallet", "quant", "contract", "bear"];

export function captureIndependentReads(
  rawAgents: AgentOpinion[],
  formedAt = new Date().toISOString(),
  memoryHints: Partial<Record<ResearchAgentId, string[]>> = {},
): IndependentAgentRead[] {
  return researchIds.map((id) => {
    const agent = rawAgents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error(`Missing independent read for ${id}`);
    const hints = memoryHints[id] ?? [];
    return {
      agentId: id,
      score: agent.score,
      stance: agent.stance,
      thesis: `${agent.summary} ${agent.detail}`,
      evidence: [...agent.evidence, ...hints.map((hint) => `Memory: ${hint}`)],
      memoryHints: hints,
      formedAt,
    };
  });
}
