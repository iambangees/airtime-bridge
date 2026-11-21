/* Order store (server-only) — Supabase with the service role key.
   Every write is a guarded transition: the update only lands when the row is
   still in an allowed "from" state, which is what makes webhook replays and
   double-clicks harmless. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canTransition, type OrderStatus } from "./core";

export interface Order {
  id: string;
  reference: string;
  phone: string;
  network: string;
  amount: number;
  amount_paid: number | null;
  vend_amount: number | null;
  status: OrderStatus;
  account_number: string | null;
  account_name: string | null;
  bank_name: string | null;
  bank_code: string | null;
  checkout_url: string | null;
  expires_at: string | null;
  monnify_txn_ref: string | null;
  vtpass_request_id: string | null;
  vtpass_txn_id: string | null;
  vend_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const storeConfigured = Boolean(URL && SERVICE_KEY);

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) client = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  return client;
}

export async function insertOrder(row: Partial<Order> & { reference: string; phone: string; network: string; amount: number }): Promise<Order> {
  const { data, error } = await db().from("orders").insert(row).select("*").single();
  if (error) throw new Error(`insertOrder: ${error.message}`);
  return data as Order;
}

export async function getOrder(reference: string): Promise<Order | null> {
  const { data, error } = await db().from("orders").select("*").eq("reference", reference).maybeSingle();
  if (error) throw new Error(`getOrder: ${error.message}`);
  return (data as Order) || null;
}

export async function listOrdersByStatus(statuses: OrderStatus[], limit = 25): Promise<Order[]> {
  const { data, error } = await db().from("orders").select("*").in("status", statuses)
    .order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listOrdersByStatus: ${error.message}`);
  return (data as Order[]) || [];
}

/** Guarded transition: returns the updated order, or null when another
    processor already moved it (idempotency). */
export async function transition(reference: string, from: OrderStatus[], to: OrderStatus, patch: Partial<Order> = {}): Promise<Order | null> {
  for (const f of from) if (!canTransition(f, to)) throw new Error(`illegal transition ${f} -> ${to}`);
  const { data, error } = await db().from("orders")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("reference", reference).in("status", from)
    .select("*").maybeSingle();
  if (error) throw new Error(`transition: ${error.message}`);
  return (data as Order) || null;
}

export async function patchOrder(reference: string, patch: Partial<Order>): Promise<void> {
  const { error } = await db().from("orders")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("reference", reference);
  if (error) throw new Error(`patchOrder: ${error.message}`);
}
