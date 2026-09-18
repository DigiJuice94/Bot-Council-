import type { AgentId, AgentOpinion, WarRoomResult } from "./types";

export type CouncilTurnRound = "opening" | "rebuttal" | "decision" | "exit" | "execution" | "handoff";

export type CouncilTurn = {
  id: string;
  agentId: AgentId;
  round: CouncilTurnRound;
  message: string;
  respondsTo?: AgentId;
};

function relation(speaker: AgentOpinion, target: AgentOpinion) {
  if (speaker.stance === target.stance) return `I agree with ${target.name}'s direction`;
  if (speaker.score >= target.score + 12) return `I'm more constructive than ${target.name}`;
  if (speaker.score + 12 <= target.score) return `I'm more cautious than ${target.name}`;
  return `I'm not fully aligned with ${target.name}`;
}

function reply(speaker: AgentOpinion, target: AgentOpinion, extra?: string) {
  return `${relation(speaker, target)}. ${speaker.summary} ${speaker.detail}${extra ? ` ${extra}` : ""}`;
}

export function buildCouncilDiscussion(result: WarRoomResult): CouncilTurn[] {
  if (result.independentCouncil) {
    const trace = result.independentCouncil;
    const opening: CouncilTurn[] = trace.initialOpinions.map((opinion, index) => ({
      id: `private-${index}-${opinion.agentId}`,
      agentId: opinion.agentId,
      round: "opening",
      message: `PRIVATE READ LOCKED · ${opinion.vote} · ${opinion.confidence}% confidence. ${opinion.thesis}${opinion.evidence.length ? ` Evidence: ${opinion.evidence.slice(0, 2).join(" · ")}` : ""}`,
    }));
    const meeting: CouncilTurn[] = trace.meetingOpinions.map((opinion, index) => ({
      id: `meeting-${index}-${opinion.agentId}`,
      agentId: opinion.agentId,
      round: "rebuttal",
      message: `${opinion.changedVote ? "VOTE CHANGED" : "VOTE HELD"} · ${opinion.vote} · ${opinion.confidence}%. ${opinion.rebuttal ?? opinion.thesis}`,
    }));
    return [
      ...opening,
      ...meeting,
      {
        id: "independent-cio",
        agentId: "cio",
        round: "decision",
        message: `I received eight locked private reads and their meeting responses; I did not generate them. My synthesis is ${trace.cioOpinion.vote} at ${trace.cioOpinion.confidence}% confidence. ${trace.cioOpinion.thesis}`,
      },
      {
        id: "deterministic-executor",
        agentId: "executor",
        round: "execution",
        respondsTo: "cio",
        message: `Deterministic Executor is outside the nine-entity Council. It only applies route/accounting/hard-safety rules after the CIO decision. Feasibility: ${result.councilProcess.executorVote}.`,
      },
    ];
  }

  const byId = new Map(result.agents.map((agent) => [agent.id, agent]));
  const launch = byId.get("launch");
  const social = byId.get("social");
  const wallet = byId.get("wallet");
  const quant = byId.get("quant");
  const contract = byId.get("contract");
  const bear = byId.get("bear");
  const cio = byId.get("cio");
  const executor = byId.get("executor");

  if (!launch || !social || !wallet || !quant || !contract || !bear || !cio || !executor) {
    return result.agents.map((agent, index) => ({
      id: `fallback-${index}-${agent.id}`,
      agentId: agent.id,
      round: agent.id === "cio" ? "decision" : agent.id === "executor" ? "execution" : "opening",
      message: `${agent.summary} ${agent.detail}`,
    }));
  }

  const research = [launch, social, wallet, quant, contract];
  const strongestBull = research.reduce((best, agent) => agent.score > best.score ? agent : best, research[0]);
  const strongestSafetyVoice = contract.score <= 58 ? contract : bear;
  const exit = result.exitStrategy;
  const firstTp = exit.takeProfits[0];
  const lastTp = exit.takeProfits[exit.takeProfits.length - 1];

  return [
    {
      id: "open-launch",
      agentId: launch.id,
      round: "opening",
      message: `This candidate entered the ${result.councilProcess.lane === "meme" ? "meme-native" : "standard"} council lane. My launch read was formed independently before hearing the room. ${launch.summary} ${launch.detail}`,
    },
    {
      id: "open-social",
      agentId: social.id,
      round: "opening",
      respondsTo: launch.id,
      message: reply(social, launch, "My independent social read was already formed; now I'm checking whether it confirms the launch case."),
    },
    {
      id: "open-wallet",
      agentId: wallet.id,
      round: "opening",
      respondsTo: social.id,
      message: reply(wallet, social, "My wallet view was formed independently. I'm using real buyer behavior to test the narrative."),
    },
    {
      id: "open-quant",
      agentId: quant.id,
      round: "opening",
      respondsTo: wallet.id,
      message: reply(quant, wallet, `My quant model formed its view first. Alpha scored ${result.alpha.score}/100 with a ${result.alpha.rewardRiskProxy.toFixed(2)}x reward/risk proxy; now I'm checking whether wallet flow confirms it.`),
    },
    {
      id: "open-contract",
      agentId: contract.id,
      round: "opening",
      respondsTo: quant.id,
      message: reply(contract, quant, "My contract verdict is independent of the bullish story. A runner thesis cannot overrule a specific hard safety failure."),
    },
    {
      id: "open-bear",
      agentId: bear.id,
      round: "opening",
      respondsTo: strongestBull.id,
      message: `My dumper-pattern thesis was formed before the meeting. Market context is ${result.regime.label}, while token context is ${result.memeRegime.label}. I'm challenging ${strongestBull.name}'s ${strongestBull.score}% case and the supporting evidence. ${bear.summary} ${bear.detail}`,
    },
    {
      id: "rebut-launch",
      agentId: launch.id,
      round: "rebuttal",
      respondsTo: bear.id,
      message: reply(launch, bear, `My strongest launch evidence remains ${launch.evidence[0] ?? "the early-flow structure"}.`),
    },
    {
      id: "rebut-social",
      agentId: social.id,
      round: "rebuttal",
      respondsTo: bear.id,
      message: reply(social, bear, "I'm testing whether attention is durable enough to survive the downside case Bear raised."),
    },
    {
      id: "rebut-wallet",
      agentId: wallet.id,
      round: "rebuttal",
      respondsTo: bear.id,
      message: reply(wallet, bear, `Tracked flow is my tie-breaker: ${wallet.evidence[0] ?? wallet.detail}.`),
    },
    {
      id: "rebut-quant",
      agentId: quant.id,
      round: "rebuttal",
      respondsTo: strongestSafetyVoice.id,
      message: reply(quant, strongestSafetyVoice, "I want the entry only if live runner-pattern data still works after the dumper challenge."),
    },
    {
      id: "rebut-contract",
      agentId: contract.id,
      round: "rebuttal",
      respondsTo: bear.id,
      message: reply(contract, bear, result.risk.passed
        ? "The deterministic gate still passes, so the debate can continue on timing, sizing and exits."
        : "The deterministic veto ends the argument regardless of bullish opinions."),
    },
    {
      id: "rebut-bear",
      agentId: bear.id,
      round: "rebuttal",
      respondsTo: strongestBull.id,
      message: bear.score >= 58
        ? `I've heard the rebuttals. ${bear.summary} I still want ${strongestBull.name}'s case stress-tested against ${bear.detail}.`
        : `I still disagree with ${strongestBull.name}'s ${strongestBull.score}% case. ${bear.summary} ${bear.detail}`,
    },
    {
      id: "decision-cio",
      agentId: cio.id,
      round: "decision",
      respondsTo: bear.id,
      message: `I've heard all six isolated reads and the rebuttals. Runner Genome is ${result.runnerGenome.entryScore.toFixed(0)}/100 vs dumper risk ${result.runnerGenome.dumperRiskScore.toFixed(0)}/100 from ${result.runnerGenome.sampleSize} labeled cases. Research support is ${result.councilProcess.researchSupport}/6 and council conviction is ${result.councilConviction}%. My synthesis is ${result.councilProcess.cioVote} at ${result.conviction}%. ${cio.summary} ${cio.detail}`,
    },
    {
      id: "exit-quant",
      agentId: quant.id,
      round: "exit",
      respondsTo: cio.id,
      message: result.decision === "BUY"
        ? `Before entry, here is the exit math: initial stop ${exit.stopLossPct}%, trailing stop ${exit.trailingStopPct}%, first trim +${firstTp.gainPct}% for ${firstTp.sellPct}%, and the runner target is +${lastTp.gainPct}%.`
        : `No position yet, but if CIO upgrades this to BUY the exit framework is already defined: stop ${exit.stopLossPct}%, trail ${exit.trailingStopPct}%, and staged profit-taking.` ,
    },
    {
      id: "exit-bear",
      agentId: bear.id,
      round: "exit",
      respondsTo: quant.id,
      message: `I want the exit plan to fail safely. Emergency exit if liquidity drops below $${Math.round(exit.liquidityFloorUsd).toLocaleString()}, contract safety changes, or the original thesis breaks.` ,
    },
    {
      id: "exit-contract",
      agentId: contract.id,
      round: "exit",
      respondsTo: bear.id,
      message: "Agreed. Contract safety stays live after entry. A later sellability, honeypot, authority or concentration failure should trigger an emergency exit review immediately.",
    },
    {
      id: "execution-executor",
      agentId: executor.id,
      round: "execution",
      respondsTo: cio.id,
      message: result.decision === "BUY"
        ? `CIO called BUY and my execution vote is ${result.councilProcess.executorVote}. ${executor.summary} I am the eighth active council role: I can reduce or block routing if liquidity, sizing or execution quality fails. After a fill, Position Guardian owns the position continuously until it is closed.`
        : `CIO called ${result.councilProcess.cioVote}; my execution vote is ${result.councilProcess.executorVote}. ${executor.summary} Position Guardian remains on every existing position while this setup is skipped or watched.`,
    },
    {
      id: "handoff-launch",
      agentId: launch.id,
      round: "handoff",
      respondsTo: executor.id,
      message: "Position monitoring is handed off. I'm returning to discovery now so the next opportunity can be analyzed while open positions remain under Position Guardian watch.",
    },
  ];
}
