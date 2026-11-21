/* The money pipeline: payment confirmed -> vend -> delivered.
   Every step is guarded and idempotent; safe to call from the webhook,
   the status poller and the cron requery at the same time. */
import { amountToVend } from "./core";
import { getOrder, transition, patchOrder, type Order } from "./store";
import { buyAirtime, requeryVend } from "./vtpass";
import { getInvoiceState } from "./monnify";

const MAX_VEND_ATTEMPTS = 3;

/** A payment has been confirmed for this order (webhook or poller). */
export async function processPayment(reference: string, amountPaid: number, txnRef?: string): Promise<Order | null> {
  let order = await getOrder(reference);
  if (!order) return null;
  if (["PAID", "VENDING", "DELIVERED"].includes(order.status)) return order; // already handled — replay
  if (!["AWAITING_PAYMENT", "EXPIRED", "UNDERPAID", "OVERPAID"].includes(order.status)) return order;

  const { vend, flag } = amountToVend(order.amount, amountPaid);
  const paidStatus = flag === "over" ? "OVERPAID" : flag === "under" ? "UNDERPAID" : "PAID";
  const moved = await transition(reference, ["AWAITING_PAYMENT", "EXPIRED"], paidStatus as never, {
    amount_paid: amountPaid, vend_amount: vend, monnify_txn_ref: txnRef || order.monnify_txn_ref,
  }).catch(() => null);
  order = moved || (await getOrder(reference));
  if (!order) return null;
  if (vend <= 0) return order; // paid under ₦50 — sits in UNDERPAID for the refund queue
  if (order.status === "PAID" || order.status === "OVERPAID" || order.status === "UNDERPAID")
    return vendOrder(reference);
  return order;
}

/** PAID/UNDERPAID/OVERPAID -> VENDING -> DELIVERED | VEND_FAILED. */
export async function vendOrder(reference: string): Promise<Order | null> {
  let order = await getOrder(reference);
  if (!order || !order.vtpass_request_id || !order.vend_amount) return order;
  if (order.status === "VEND_FAILED" && order.vend_attempts >= MAX_VEND_ATTEMPTS) return order;
  const moved = await transition(reference, ["PAID", "UNDERPAID", "OVERPAID", "VEND_FAILED"], "VENDING", {
    vend_attempts: order.vend_attempts + 1,
  }).catch(() => null);
  if (!moved) return getOrder(reference); // someone else is vending it
  order = moved;
  const vtpassRequestId = order.vtpass_request_id, vendAmount = order.vend_amount;
  if (!vtpassRequestId || !vendAmount) return order;
  try {
    const r = await buyAirtime({
      requestId: vtpassRequestId, serviceID: order.network,
      amount: vendAmount, phone: order.phone,
    });
    if (r.outcome === "delivered") {
      return await transition(reference, ["VENDING"], "DELIVERED", {
        vtpass_txn_id: r.transactionId || order.vtpass_txn_id, last_error: null,
      });
    }
    if (r.outcome === "pending") {
      await patchOrder(reference, { vtpass_txn_id: r.transactionId || order.vtpass_txn_id, last_error: "VTpass: transaction pending" });
      return getOrder(reference); // stays VENDING; requery resolves it
    }
    await transition(reference, ["VENDING"], "VEND_FAILED", { last_error: `VTpass ${r.code}: ${r.message}` });
  } catch (e) {
    await transition(reference, ["VENDING"], "VEND_FAILED", { last_error: e instanceof Error ? e.message : String(e) }).catch(() => null);
  }
  return getOrder(reference);
}

/** Reconcile one order against both providers (poller + cron). */
export async function requeryOrder(reference: string): Promise<Order | null> {
  const order = await getOrder(reference);
  if (!order) return null;
  if (order.status === "AWAITING_PAYMENT") {
    if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
      const moved = await transition(reference, ["AWAITING_PAYMENT"], "EXPIRED").catch(() => null);
      if (moved) return moved;
    }
    const inv = await getInvoiceState(reference);
    if (inv && (inv.status === "PAID" || inv.amountPaid > 0))
      return processPayment(reference, inv.amountPaid || inv.amount);
    return order;
  }
  if (order.status === "VENDING" && order.vtpass_request_id) {
    const r = await requeryVend(order.vtpass_request_id).catch(() => null);
    if (r?.outcome === "delivered")
      return transition(reference, ["VENDING"], "DELIVERED", { vtpass_txn_id: r.transactionId || order.vtpass_txn_id, last_error: null });
    if (r?.outcome === "failed")
      return transition(reference, ["VENDING"], "VEND_FAILED", { last_error: `VTpass ${r.code}: ${r.message}` });
    return order;
  }
  if (order.status === "VEND_FAILED" && order.vend_attempts < MAX_VEND_ATTEMPTS)
    return vendOrder(reference);
  return order;
}
