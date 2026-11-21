/* VTpass client (server-only). Airtime VTU from the pre-funded wallet.
   POST /api/pay {request_id, serviceID, amount, phone}; POST /api/requery {request_id};
   GET /api/balance. Response code "000" = success, "099" = processing. */
const BASE = process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com/api";
const API_KEY = process.env.VTPASS_API_KEY || "";
const SECRET_KEY = process.env.VTPASS_SECRET_KEY || "";
const USERNAME = process.env.VTPASS_USERNAME || "";
const PASSWORD = process.env.VTPASS_PASSWORD || "";

export const vtpassConfigured = Boolean((API_KEY && SECRET_KEY) || (USERNAME && PASSWORD));

function authHeaders(): Record<string, string> {
  if (API_KEY && SECRET_KEY) return { "api-key": API_KEY, "secret-key": SECRET_KEY };
  return { Authorization: "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64") };
}

async function post(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`VTpass ${path} HTTP ${res.status}`);
  return json;
}

export interface VendResult {
  outcome: "delivered" | "pending" | "failed";
  code: string; transactionId: string; message: string;
}

function interpret(json: Record<string, unknown> | null): VendResult {
  const code = String(json?.code || "");
  const tx = (json?.transactionId ?? json?.TransactionId ?? "") as string;
  const msg = String(json?.response_description || "");
  if (code === "000") return { outcome: "delivered", code, transactionId: String(tx), message: msg };
  if (code === "099") return { outcome: "pending", code, transactionId: String(tx), message: msg };
  return { outcome: "failed", code, transactionId: String(tx), message: msg || "VTpass rejected the vend" };
}

export async function buyAirtime(opts: { requestId: string; serviceID: string; amount: number; phone: string }): Promise<VendResult> {
  const json = await post("/pay", {
    request_id: opts.requestId, serviceID: opts.serviceID, amount: opts.amount, phone: opts.phone,
  });
  return interpret(json);
}

export async function requeryVend(requestId: string): Promise<VendResult> {
  const json = await post("/requery", { request_id: requestId });
  return interpret(json);
}

export async function getWalletBalance(): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/balance`, { headers: authHeaders() });
    const json = await res.json().catch(() => null);
    const bal = Number(json?.contents?.balance ?? json?.balance);
    return Number.isFinite(bal) ? bal : null;
  } catch { return null; }
}
