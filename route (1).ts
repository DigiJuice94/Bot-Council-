import { NextRequest, NextResponse } from "next/server";
import { ensureAutonomousWarRoom } from "@/lib/autopilot";
import { getProofOfWork } from "@/lib/proof-of-work";
export const dynamic="force-dynamic"; export const revalidate=0;
export async function GET(req:NextRequest){ try{ ensureAutonomousWarRoom(); const limit=Number(req.nextUrl.searchParams.get("limit")??500); return NextResponse.json(await getProofOfWork(limit),{headers:{"Cache-Control":"no-store"}}); }catch(error){ return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:500}); } }
