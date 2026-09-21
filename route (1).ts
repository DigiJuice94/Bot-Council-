import { NextRequest, NextResponse } from "next/server";
import { buildCabinetExport, type CabinetKind } from "@/lib/cabinet-export";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{kind:string}> }) {
  const { kind } = await params;
  if (!["main","rug","proof"].includes(kind)) return NextResponse.json({error:"Unknown cabinet"},{status:404});
  const data = await buildCabinetExport(kind as CabinetKind);
  const download = req.nextUrl.searchParams.get("download") === "1";
  return NextResponse.json(data,{headers: download ? {"Content-Disposition":`attachment; filename=bot-war-room-${kind}-cabinet-${new Date().toISOString().slice(0,10)}.json`,"Cache-Control":"no-store"}:{"Cache-Control":"no-store"}});
}
