/* Airtime Bridge — pure core logic (no framework, no network).
   Kept dependency-free so it can be unit-tested outside Next. */
import { createHmac, createHash, timingSafeEqual, randomBytes } from "crypto";

export type OrderStatus =
  | "CREATED" | "AWAITING_PAYMENT" | "PAID" | "VENDING" | "DELIVERED"
  | "EXPIRED" | "VEND_FAILED" | "UNDERPAID" | "OVERPAID" | "REFUNDED";

export type Network = "mtn" | "airtel" | "glo" | "etisalat";

const PREFIXES: Record<Network, string[]> = {
  mtn: ["0703", "0704", "0706", "0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "0916"],
  airtel: ["0701", "0708", "0801", "0802", "0808", "0812", "0901", "0902", "0904", "0907", "0912"],
  glo: ["0705", "0805", "0807", "0811", "0815", "0905", "0915"],
  etisalat: ["0809", "0817", "0818", "0908", "0909"],
};

export const NETWORK_NAMES: Record<Network, string> = {
  mtn: "MTN", airtel: "Airtel", glo: "Glo", etisalat: "9mobile",
};

/** Accepts 0803…, +234803…, 234803… or 803… and returns the local 0-format, or null. */
export function normalizePhone(raw: string): string | null {
  let p = (raw || "").replace(/[\s()-]/g, "");
  if (p.startsWith("+234")) p = "0" + p.slice(4);
  else if (p.startsWith("234") && p.length === 13) p = "0" + p.slice(3);
  else if (/^[789]/.test(p) && p.length === 10) p = "0" + p;
  return /^0[789]\d{9}$/.test(p) ? p : null;
}

export function detectNetwork(phone: string): Network | null {
  const prefix = phone.slice(0, 4);
  for (const net of Object.keys(PREFIXES) as Network[])
    if (PREFIXES[net].includes(prefix)) return net;
  return null;
}

export function newOrderReference(now = new Date()): string {
  return "AB" + now.getTime().toString(36).toUpperCase() + randomBytes(3).toString("hex").toUpperCase();
}

/** VTpass request_id: Lagos-time YYYYMMDDHHmmss prefix + random suffix (unique per vend attempt is NOT
    wanted — the id identifies the vend for an order, so it is generated once per order). */
export function newVtpassRequestId(now = new Date()): string {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000); // WAT = UTC+1
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${lagos.getUTCFullYear()}${p(lagos.getUTCMonth() + 1)}${p(lagos.getUTCDate())}${p(lagos.getUTCHours())}${p(lagos.getUTCMinutes())}${p(lagos.getUTCSeconds())}`;
  return stamp + randomBytes(4).toString("hex").toUpperCase();
}

/** Monnify webhook check: header `monnify-signature` is HMAC-SHA512(raw body, client secret).
    A legacy plain SHA512(secret + body) variant is also accepted. Timing-safe compares. */
export function verifyMonnifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const given = signature.trim().toLowerCase();
  const candidates = [
    createHmac("sha512", secret).update(rawBody).digest("hex"),
    createHash("sha512").update(secret + rawBody).digest("hex"),
  ];
  return candidates.some((hex) => {
    const a = Buffer.from(hex), b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ["AWAITING_PAYMENT", "EXPIRED"],
  AWAITING_PAYMENT: ["PAID", "EXPIRED", "UNDERPAID", "OVERPAID"],
  PAID: ["VENDING", "VEND_FAILED"],
  VENDING: ["DELIVERED", "VEND_FAILED"],
  VEND_FAILED: ["VENDING", "REFUNDED"],
  UNDERPAID: ["VENDING", "REFUNDED"],
  OVERPAID: ["VENDING"],
  DELIVERED: [],
  EXPIRED: ["PAID", "UNDERPAID", "OVERPAID"], // a late payment can still land on an expired invoice — it must be reconcilable
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Exact-amount policy (scope §6): returns how much airtime to vend for a payment. */
export function amountToVend(ordered: number, paid: number): { vend: number; flag: "exact" | "under" | "over" | "too_small" } {
  if (paid >= ordered) return { vend: ordered, flag: paid > ordered ? "over" : "exact" };
  if (paid >= 50) return { vend: paid, flag: "under" };
  return { vend: 0, flag: "too_small" };
}
