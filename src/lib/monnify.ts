/* Monnify client (server-only). Dynamic invoices: a fresh virtual account per
   order that dies on payment or expiry — no customer BVN/NIN needed.
   Docs: POST /api/v1/auth/login (Basic apiKey:secretKey -> Bearer token),
   POST /api/v1/invoice/create, GET /api/v1/invoice/{reference}. */
const BASE = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";
const API_KEY = process.env.MONNIFY_API_KEY || "";
const SECRET = process.env.MONNIFY_SECRET_KEY || "";
const CONTRACT = process.env.MONNIFY_CONTRACT_CODE || "";

export const monnifyConfigured = Boolean(API_KEY && SECRET && CONTRACT);
export const monnifySecret = SECRET;

let tokenCache: { token: string; until: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.token;
  const basic = Buffer.from(`${API_KEY}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const json = await res.json().catch(() => null);
  const token = json?.responseBody?.accessToken;
  if (!res.ok || !token) throw new Error(`Monnify auth failed (${res.status}): ${json?.responseMessage || "no token"}`);
  tokenCache = { token, until: Date.now() + 50 * 60 * 1000 }; // tokens live ~60 min
  return token;
}

async function call(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.requestSuccessful === false)
    throw new Error(`Monnify ${path} failed (${res.status}): ${json?.responseMessage || "unknown error"}`);
  return json?.responseBody;
}

export interface DynamicAccount {
  accountNumber: string; accountName: string; bankName: string; bankCode: string; checkoutUrl: string;
}

/** Creates a one-time (dynamic) invoice: Monnify generates a fresh virtual
    account tied to this invoice only. Format expiry as Monnify expects. */
export async function createDynamicInvoice(opts: {
  reference: string; amount: number; description: string;
  customerName: string; customerEmail: string; expiresAt: Date;
}): Promise<DynamicAccount> {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = opts.expiresAt;
  const expiryDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const body = await call("/api/v1/invoice/create", {
    method: "POST",
    body: JSON.stringify({
      amount: opts.amount,
      invoiceReference: opts.reference,
      description: opts.description,
      currencyCode: "NGN",
      contractCode: CONTRACT,
      customerName: opts.customerName,
      customerEmail: opts.customerEmail,
      expiryDate,
      paymentMethods: ["ACCOUNT_TRANSFER"],
    }),
  });
  if (!body?.accountNumber) throw new Error("Monnify invoice created without an account number");
  return {
    accountNumber: body.accountNumber, accountName: body.accountName || "",
    bankName: body.bankName || "", bankCode: body.bankCode || "", checkoutUrl: body.checkoutUrl || "",
  };
}

export interface InvoiceState { status: string; amount: number; amountPaid: number }

/** Polling fallback for the webhook. Returns null when Monnify can't confirm. */
export async function getInvoiceState(reference: string): Promise<InvoiceState | null> {
  try {
    const body = await call(`/api/v1/invoice/${encodeURIComponent(reference)}`);
    if (!body) return null;
    return {
      status: String(body.invoiceStatus || ""),
      amount: Number(body.amount || 0),
      amountPaid: Number(body.amountPaid ?? (body.invoiceStatus === "PAID" ? body.amount : 0) ?? 0),
    };
  } catch { return null; }
}
