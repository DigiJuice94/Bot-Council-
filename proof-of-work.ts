import { createHash } from "crypto";
import { createClient } from "redis";
import type { PaperFill } from "./types";

const EVENT_KEY = "bot-war-room:proof-of-work:v1:events";
const MAX_EVENTS = 10_000;

type ProofKind = "scan" | "decision" | "fill" | "verification" | "health" | "error";
type ProofStatus = "confirmed" | "partial" | "unconfirmed" | "info";
export type ProofEvent = { id:string; at:string; kind:ProofKind; status:ProofStatus; subject:string; details:Record<string,unknown>; previousHash?:string; hash:string };
type G = typeof globalThis & { __bwrProofRedis?:Promise<any|null>; __bwrProofEvents?:ProofEvent[] };
const g = globalThis as G;

async function redisClient(){
  if(!process.env.REDIS_URL) return null;
  if(!g.__bwrProofRedis) g.__bwrProofRedis=(async()=>{ try { const c=createClient({url:process.env.REDIS_URL}); await c.connect(); return c; } catch { return null; } })();
  return g.__bwrProofRedis;
}
function digest(value:unknown){ return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function latestHash(){ const r=await redisClient(); if(r){ const row=await r.lIndex(EVENT_KEY,0); if(row){ try{return JSON.parse(row).hash as string}catch{} } } return g.__bwrProofEvents?.[0]?.hash; }

export async function appendProof(kind:ProofKind,status:ProofStatus,subject:string,details:Record<string,unknown>={}){
  const at=new Date().toISOString(); const previousHash=await latestHash();
  const base={id:`pow-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,at,kind,status,subject,details,previousHash};
  const event:ProofEvent={...base,hash:digest(base)};
  const r=await redisClient();
  if(r){ await r.lPush(EVENT_KEY,JSON.stringify(event)); await r.lTrim(EVENT_KEY,0,MAX_EVENTS-1); }
  else g.__bwrProofEvents=[event,...(g.__bwrProofEvents??[])].slice(0,MAX_EVENTS);
  return event;
}

export async function recordFillProof(fill:PaperFill, tokenAddress:string, positionId?:string){
  const finite=[fill.requestedUsd,fill.filledUsd,fill.fillPrice,fill.slippageBps,fill.feeUsd].every(Number.isFinite);
  const arithmeticOk=finite && fill.requestedUsd>=0 && fill.filledUsd>=0 && fill.fillPrice>0 && fill.feeUsd>=0;
  const routeEvidence=fill.routeVerified===true;
  const status:ProofStatus=!arithmeticOk?"unconfirmed":routeEvidence?"confirmed":"partial";
  return appendProof("fill",status,`${fill.side} ${fill.symbol}`,{
    fillId:fill.id,positionId,tokenAddress,chain:fill.chain,side:fill.side,requestedUsd:fill.requestedUsd,filledUsd:fill.filledUsd,
    fillPrice:fill.fillPrice,slippageBps:fill.slippageBps,feeUsd:fill.feeUsd,routeVerified:fill.routeVerified??false,routeProvider:fill.routeProvider,
    createdAt:fill.createdAt,checks:{finite,arithmeticOk,routeEvidence},note: routeEvidence?"Paper fill has independent route evidence.":"Paper accounting is internally checkable; live execution is not proven by paper data."
  });
}

export async function getProofOfWork(limit=500){
  const n=Math.max(1,Math.min(2000,Math.round(limit))); const r=await redisClient();
  let events:ProofEvent[]=[];
  if(r){ events=(await r.lRange(EVENT_KEY,0,n-1)).flatMap((x:string)=>{try{return [JSON.parse(x)]}catch{return[]}}); } else events=(g.__bwrProofEvents??[]).slice(0,n);
  const counts={confirmed:0,partial:0,unconfirmed:0,info:0}; for(const e of events) counts[e.status]++;
  const fills=events.filter(e=>e.kind==="fill"); const scans=events.filter(e=>e.kind==="scan"); const errors=events.filter(e=>e.kind==="error");
  return { cabinet:"Proof of Work",readOnlyObserver:true,tradingAuthority:false,counts,totalEvents:events.length,fillProofs:fills.length,scanHeartbeats:scans.length,errorEvents:errors.length,lastHeartbeatAt:scans[0]?.at,lastEventAt:events[0]?.at,events,generatedAt:new Date().toISOString() };
}
