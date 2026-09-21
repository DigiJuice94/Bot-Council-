import { getTradeJournal } from "./trade-journal";
import { listManagedPositions } from "./position-store";
import { getPaperWallet } from "./paper-wallet";

export type CabinetKind = "main" | "rug" | "proof";
const round=(v:number)=>Number((Number.isFinite(v)?v:0).toFixed(6));

export async function buildCabinetExport(kind: CabinetKind) {
  const generatedAt=new Date().toISOString();
  const [journal,positions,wallet]=await Promise.all([getTradeJournal(500),listManagedPositions(),getPaperWallet()]);
  if(kind==="main") return {kind,generatedAt,build:"V3.6.3.3 Monitoring / Proof-of-Work",purpose:"Downloadable read-only record of the current War Room decisions and fills for later analysis.",summary:{decisions:journal.decisions.length,fills:journal.fills.length,positions:positions.length},decisions:journal.decisions,fills:journal.fills};
  if(kind==="rug"){
    const incidents=positions.filter((p:any)=>p.status==="unsellable"||p.lockedReason||Number(p.lockedCapitalLossUsd??0)>0);
    return {kind,generatedAt,build:"V3.6.3.3 Monitoring / Proof-of-Work",purpose:"Downloadable rug, unsellable and locked-capital evidence.",summary:{incidents:incidents.length,lockedCapitalLossUsd:round(incidents.reduce((s:number,p:any)=>s+Number(p.lockedCapitalLossUsd??0),0))},incidents};
  }
  const fills=(journal.fills as any[]).map((f:any)=>{const quantity=Number(f.quantity??0),price=Number(f.price??0),recorded=Number(f.valueUsd??f.notionalUsd??0),expected=round(quantity*price);const hasComparable=quantity>0&&price>0&&recorded>0;const delta=hasComparable?round(recorded-expected):null;const confirmed=hasComparable?Math.abs(delta as number)<=0.02:true;return {...f,expectedGrossValueUsd:hasComparable?expected:null,recordedValueDeltaUsd:delta,evidenceStatus:confirmed?"CONFIRMED_INTERNAL":"UNCONFIRMED"};});
  const confirmed=fills.filter((f:any)=>f.evidenceStatus==="CONFIRMED_INTERNAL").length;
  const reconstructed=round(Number(wallet.cashUsd)+Number(wallet.openExposureUsd));
  return {kind,generatedAt,build:"V3.6.3.3 Monitoring / Proof-of-Work",purpose:"Read-only audit evidence. Internal confirmation proves stored ledger/math consistency; live execution still requires wallet/chain evidence.",heartbeat:{walletUpdatedAt:wallet.updatedAt,journalGeneratedAt:journal.generatedAt,decisionRecords:journal.decisions.length,fillRecords:journal.fills.length,openPositions:wallet.openPositions,unsellablePositions:wallet.unsellablePositions},reconciliation:{startingCashUsd:wallet.startingCashUsd,capitalContributionsUsd:wallet.capitalContributionsUsd??0,cashUsd:wallet.cashUsd,openExposureUsd:wallet.openExposureUsd,reportedEquityUsd:wallet.equityUsd,independentlyReconstructedEquityUsd:reconstructed,equityDeltaUsd:round(wallet.equityUsd-reconstructed),reportedRealizedPnlUsd:wallet.realizedPnlUsd,reportedUnrealizedPnlUsd:wallet.unrealizedPnlUsd,reportedTotalPnlUsd:wallet.totalPnlUsd,totalFeesUsd:wallet.totalFeesUsd,accountingVerified:wallet.accountingVerified,accountingVerifiedAt:wallet.accountingVerifiedAt},verification:{records:fills.length,confirmedInternal:confirmed,unconfirmed:fills.length-confirmed},fills,positions};
}
