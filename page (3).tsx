"use client";
import { useEffect, useState } from "react";
type Kind="main"|"rug"|"proof";
const info:{kind:Kind;title:string;desc:string}[]=[
 {kind:"main",title:"Main File Cabinet",desc:"Council learning, accumulated evidence, role performance and rejection patterns."},
 {kind:"rug",title:"Rug File Cabinet",desc:"Unsellable and locked-capital incidents preserved for post-mortem analysis."},
 {kind:"proof",title:"Proof of Work",desc:"Trade-by-trade evidence, independent reconciliation and runtime heartbeat monitoring."},
];
export default function Cabinets(){const [kind,setKind]=useState<Kind>("proof");const [data,setData]=useState<any>(null);const [err,setErr]=useState("");
 useEffect(()=>{let on=true;const load=()=>fetch(`/api/cabinets/${kind}`,{cache:"no-store"}).then(r=>r.json()).then(x=>{if(on){setData(x);setErr("")}}).catch(e=>on&&setErr(String(e)));load();const id=setInterval(load,5000);return()=>{on=false;clearInterval(id)}},[kind]);
 const selected=info.find(x=>x.kind===kind)!; const v=data?.verification; const h=data?.heartbeat;
 return <><header className="primary-app-nav"><a className="app-nav-brand" href="/">BOT WAR ROOM <small>V3.6.3</small></a><nav><a href="/">Trading</a><a className="active" href="/cabinets">File Cabinets</a></nav></header><main className="cabinet-page"><header className="cabinet-top"><div><small>V3.6.3 · MONITORING PHASE</small><h1>Intelligence File Cabinets</h1><p>Read-only evidence and learning. Nothing on this page can place, alter or stop a trade.</p></div><a className="back-trading" href="/">← Trading</a></header>
 <nav className="cabinet-tabs">{info.map(x=><button key={x.kind} onClick={()=>setKind(x.kind)} className={kind===x.kind?"active":""}>{x.title}</button>)}</nav>
 <section className="cabinet-card"><div className="cabinet-card-head"><div><h2>{selected.title}</h2><p>{selected.desc}</p></div><a className="download-cabinet" href={`/api/cabinets/${kind}?download=1`}>Download Data</a></div>
 {err&&<p>{err}</p>}
 {kind==="proof"&&<><div className="proof-grid"><span><small>Evidence records</small><b>{v?.records??0}</b></span><span><small>Confirmed internal</small><b>{v?.confirmedInternal??0}</b></span><span><small>Unconfirmed</small><b>{v?.unconfirmed??0}</b></span><span><small>Accounting</small><b>{data?.reconciliation?.accountingVerified?"VERIFIED":"CHECK"}</b></span></div><div className="heartbeat"><b>Runtime heartbeat</b><span>Last opportunity: {h?.lastOpportunityAt?new Date(h.lastOpportunityAt).toLocaleString():"Waiting"}</span><span>Last mark refresh: {h?.lastMarkRefreshAt?new Date(h.lastMarkRefreshAt).toLocaleString():"Waiting"}</span><span>Latest pass: {h?.lastRejectionReason??"None"}</span></div></>}
 {kind==="rug"&&<div className="proof-grid"><span><small>Incidents</small><b>{data?.summary?.incidents??0}</b></span><span><small>Locked loss</small><b>${Number(data?.summary?.lockedCapitalLossUsd??0).toFixed(2)}</b></span></div>}
 {kind==="main"&&<div className="proof-grid"><span><small>Council runs</small><b>{data?.councilRuns??0}</b></span><span><small>Opportunities</small><b>{data?.opportunityCount??0}</b></span><span><small>Evidence lines</small><b>{data?.fileCabinetEvidence?.length??0}</b></span></div>}
 <pre className="cabinet-preview">{JSON.stringify(data,null,2)}</pre></section></main></>}
