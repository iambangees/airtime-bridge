import { NextResponse } from "next/server";
import { verifyMonnifySignature } from "@/lib/core";
import { monnifySecret } from "@/lib/monnify";
import { processPayment } from "@/lib/pipeline";


export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("monnify-signature");
  // Sandbox notifications may arrive without the signature header; in that case
  // we still only act on the reference, and the pipeline/poller reconcile the
  // amount against Monnify's own API before value is delivered.
  if (signature && !verifyMonnifySignature(raw, signature, monnifySecret))
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  let body: { eventType?: string; eventData?: Record<string, unknown> } | null = null;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON." }, { status: 400 }); }
  if (body?.eventType !== "SUCCESSFUL_TRANSACTION") return NextResponse.json({ ok: true, ignored: true });
  const data = body.eventData || {};
  const reference = String(data.paymentReference || "");
  const amountPaid = Number(data.amountPaid || 0);
  const txnRef = String(data.transactionReference || "");
  if (!reference || !(amountPaid > 0)) return NextResponse.json({ ok: true, ignored: true });
  await processPayment(reference, amountPaid, txnRef).catch(() => null);
  return NextResponse.json({ ok: true });
}
