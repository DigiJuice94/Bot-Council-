import { NextRequest, NextResponse } from "next/server";
import { buildCabinetExport, type CabinetKind } from "@/lib/cabinet-export";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{kind:string}>}){const {kind:rawKind}=await params;const kind=rawKind as CabinetKind;if(!["main","rug","proof"].includes(kind))return NextResponse.json({error:"Unknown cabinet"},{status:404});const data=await buildCabinetExport(kind);if(request.nextUrl.searchParams.get("download")==="1")return new NextResponse(JSON.stringify(data,null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="bot-war-room-${kind}-cabinet-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"no-store"}});
// ?limit=N — dashboard path: return only the N newest decisions and trim the
// accumulated research to the scalars the dashboard renders. The full export
// (and ?download=1) is unchanged.
const limitRaw=request.nextUrl.searchParams.get("limit");
if(limitRaw){const limit=Math.max(1,Math.min(50,parseInt(limitRaw,10)||1));const loose=data as {decisions?:unknown[];accumulatedKnowledge?:Record<string,unknown>};const knowledge=loose.accumulatedKnowledge;return NextResponse.json({...loose,decisions:Array.isArray(loose.decisions)?loose.decisions.slice(0,limit):loose.decisions,accumulatedKnowledge:knowledge?{casesStudied:knowledge.casesStudied,observations:knowledge.observations,runnerCases:knowledge.runnerCases,dumperCases:knowledge.dumperCases}:knowledge},{headers:{"Cache-Control":"no-store"}});}
return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}})}
