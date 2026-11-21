import { NextResponse } from "next/server";
import { listOrdersByStatus } from "@/lib/store";
import { requeryOrder } from "@/lib/pipeline";


/** Sweep stuck orders. Vercel Cron (vercel.json) calls this with GET and sends
    Authorization: Bearer <CRON_SECRET> automatically; any external scheduler
    (e.g. cron-job.org) can POST with the same header. */
async function sweep(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const stuck = await listOrdersByStatus(["AWAITING_PAYMENT", "VENDING", "VEND_FAILED"], 25);
  let checked = 0;
  for (const o of stuck) { await requeryOrder(o.reference).catch(() => null); checked++; }
  return NextResponse.json({ ok: true, checked });
}

export async function GET(req: Request) { return sweep(req); }
export async function POST(req: Request) { return sweep(req); }
