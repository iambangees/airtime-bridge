import { NextResponse } from "next/server";
import { normalizePhone, detectNetwork, newOrderReference, newVtpassRequestId, NETWORK_NAMES } from "@/lib/core";
import { createDynamicInvoice, monnifyConfigured } from "@/lib/monnify";
import { vtpassConfigured } from "@/lib/vtpass";
import { insertOrder, storeConfigured } from "@/lib/store";


const MIN_AMOUNT = 50;
const MAX_AMOUNT = Number(process.env.MAX_ORDER_AMOUNT || 5000);
const EXPIRY_MINUTES = 30;

export async function POST(req: Request) {
  if (!storeConfigured || !monnifyConfigured || !vtpassConfigured)
    return NextResponse.json({ error: "Airtime Bridge is not fully configured yet (provider keys pending)." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const phone = normalizePhone(String(body?.phone || ""));
  if (!phone) return NextResponse.json({ error: "Enter a valid Nigerian phone number." }, { status: 400 });
  const network = detectNetwork(phone);
  if (!network) return NextResponse.json({ error: "Could not detect the network for that number." }, { status: 400 });
  if (body?.network && body.network !== network)
    return NextResponse.json({ error: `That number looks like ${NETWORK_NAMES[network]}, not the selected network.` }, { status: 400 });
  const amount = Math.floor(Number(body?.amount));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT)
    return NextResponse.json({ error: `Amount must be between ₦${MIN_AMOUNT} and ₦${MAX_AMOUNT}.` }, { status: 400 });

  const reference = newOrderReference();
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);
  try {
    const acct = await createDynamicInvoice({
      reference, amount,
      description: `Airtime ${NETWORK_NAMES[network]} ${phone}`,
      customerName: "Airtime Bridge customer",
      customerEmail: "customer@airtimebridge.local",
      expiresAt,
    });
    const order = await insertOrder({
      reference, phone, network, amount,
      status: "AWAITING_PAYMENT",
      account_number: acct.accountNumber, account_name: acct.accountName,
      bank_name: acct.bankName, bank_code: acct.bankCode, checkout_url: acct.checkoutUrl,
      expires_at: expiresAt.toISOString(),
      vtpass_request_id: newVtpassRequestId(),
    });
    return NextResponse.json({ order: publicView(order) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not create the account number." }, { status: 502 });
  }
}

export function publicView(o: {
  reference: string; phone: string; network: string; amount: number; amount_paid: number | null;
  vend_amount: number | null; status: string; account_number: string | null; account_name: string | null;
  bank_name: string | null; expires_at: string | null; vtpass_txn_id: string | null; created_at: string;
}) {
  return {
    reference: o.reference, phone: o.phone, network: o.network, amount: o.amount,
    amountPaid: o.amount_paid, vendAmount: o.vend_amount, status: o.status,
    accountNumber: o.account_number, accountName: o.account_name, bankName: o.bank_name,
    expiresAt: o.expires_at, vtpassTxnId: o.vtpass_txn_id, createdAt: o.created_at,
  };
}
