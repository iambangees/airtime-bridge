import { NextResponse, connection } from "next/server";
import { listRecentOrders } from "@/lib/store";
import { getWalletBalance } from "@/lib/vtpass";

/** Owner status view (Phase 3 admin view, API form): VTpass float, order
    counts by status, last-24h totals, and the refund queue (orders that took
    money but could not be cleanly delivered). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const orders = await listRecentOrders(500);
  const counts: Record<string, number> = {};
  for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const dayAgo = Date.now() - 24 * 3600_000;
  const recent = orders.filter((o) => new Date(o.created_at).getTime() >= dayAgo);
  const refundQueue = orders
    .filter((o) => ["VEND_FAILED", "UNDERPAID", "OVERPAID"].includes(o.status))
    .map((o) => ({ reference: o.reference, phone: o.phone, network: o.network, amount: o.amount, amountPaid: o.amount_paid, status: o.status, createdAt: o.created_at, lastError: o.last_error }));
  const vtpassBalance = await getWalletBalance().catch(() => null);
  return NextResponse.json({
    ok: true,
    vtpassBalance,
    lowBalanceThreshold: Number(process.env.LOW_BALANCE_THRESHOLD || 2000),
    counts,
    last24h: {
      orders: recent.length,
      delivered: recent.filter((o) => o.status === "DELIVERED").length,
      deliveredAmount: recent.filter((o) => o.status === "DELIVERED").reduce((s, o) => s + (o.vend_amount ?? 0), 0),
    },
    refundQueue,
  });
}
