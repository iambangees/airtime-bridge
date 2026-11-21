import { NextResponse, connection } from "next/server";
import { getOrder, storeConfigured } from "@/lib/store";
import { requeryOrder } from "@/lib/pipeline";
import { publicView } from "../route";


export async function GET(_req: Request, { params }: { params: Promise<{ reference: string }> }) {
  await connection();
  if (!storeConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const { reference } = await params;
  let order = await getOrder(reference);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  // Lazy reconciliation: if money may have landed, check the providers instead
  // of trusting the webhook alone (webhooks can be missed, especially in sandbox).
  const ageMs = Date.now() - new Date(order.updated_at).getTime();
  if ((order.status === "AWAITING_PAYMENT" && ageMs > 15000) || order.status === "VENDING" || order.status === "VEND_FAILED")
    order = (await requeryOrder(reference).catch(() => null)) || order;
  return NextResponse.json({ order: publicView(order) });
}
