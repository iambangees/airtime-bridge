"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Order = {
  reference: string; phone: string; network: string; amount: number;
  amountPaid: number | null; vendAmount: number | null; status: string;
  accountNumber: string | null; accountName: string | null; bankName: string | null;
  expiresAt: string | null; vtpassTxnId: string | null; createdAt: string;
};

const NETWORKS = [
  { id: "mtn", name: "MTN" }, { id: "airtel", name: "Airtel" },
  { id: "glo", name: "Glo" }, { id: "etisalat", name: "9mobile" },
];
const PREFIXES: Record<string, string[]> = {
  mtn: ["0703", "0704", "0706", "0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "0916"],
  airtel: ["0701", "0708", "0801", "0802", "0808", "0812", "0901", "0902", "0904", "0907", "0912"],
  glo: ["0705", "0805", "0807", "0811", "0815", "0905", "0915"],
  etisalat: ["0809", "0817", "0818", "0908", "0909"],
};
function detect(phone: string): string | null {
  const p = phone.replace(/[\s()-]/g, "");
  const local = p.startsWith("+234") ? "0" + p.slice(4) : p.startsWith("234") && p.length === 13 ? "0" + p.slice(3) : p;
  for (const [net, list] of Object.entries(PREFIXES)) if (list.includes(local.slice(0, 4))) return net;
  return null;
}
const fmt = (n: number) => "₦" + n.toLocaleString("en-NG");
const TERMINAL = ["DELIVERED", "EXPIRED", "REFUNDED"];

export default function Home() {
  const [phone, setPhone] = useState("");
  const [manualNetwork, setManualNetwork] = useState<string | null>(null);
  const network = manualNetwork ?? detect(phone) ?? "";
  const [amount, setAmount] = useState("500");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Client-only values (localStorage, wall clock) load after mount.
    const kick = setTimeout(() => {
      try { setRecent(JSON.parse(localStorage.getItem("ab-orders") || "[]")); } catch { /* ignore */ }
      setNow(Date.now());
    }, 0);
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => { clearTimeout(kick); clearInterval(t); };
  }, []);

  const stopPolling = () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };

  const fetchOrder = useCallback(async (reference: string) => {
    const res = await fetch(`/api/orders/${reference}`);
    const json = await res.json().catch(() => null);
    if (res.ok && json?.order) {
      setOrder(json.order);
      if (TERMINAL.includes(json.order.status)) stopPolling();
      return json.order as Order;
    }
    return null;
  }, []);

  const startPolling = useCallback((reference: string) => {
    stopPolling();
    pollRef.current = setInterval(() => { fetchOrder(reference).catch(() => null); }, 4000);
  }, [fetchOrder]);

  async function createOrder() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, network, amount: Number(amount) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Something went wrong.");
      setOrder(json.order);
      const refs = [json.order.reference, ...recent.filter(r => r !== json.order.reference)].slice(0, 6);
      setRecent(refs);
      try { localStorage.setItem("ab-orders", JSON.stringify(refs)); } catch { /* ignore */ }
      startPolling(json.order.reference);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    setBusy(false);
  }

  function reset() { stopPolling(); setOrder(null); setError(""); }

  async function resume(reference: string) {
    setError(""); const o = await fetchOrder(reference);
    if (o && !TERMINAL.includes(o.status)) startPolling(reference);
  }

  const countdown = order?.expiresAt ? Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000)) : 0;
  const mmss = `${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")}`;
  const copy = (label: string, text: string) => { navigator.clipboard?.writeText(text).catch(() => null); setCopied(label); setTimeout(() => setCopied(""), 1500); };

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Airtime <span className="text-accent">Bridge</span></h1>
        <p className="mt-2 text-inksoft">A fresh account number for every top-up. Transfer the exact amount — your airtime lands the moment the money does.</p>
      </header>

      {!order && (
        <section className="mt-8 rounded-2xl border border-line bg-panel p-5">
          <label className="block text-sm text-inksoft">Phone number to recharge</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="0803 000 0000"
            className="mt-1 w-full rounded-xl border border-line bg-panel2 px-4 py-3 text-lg outline-none focus:border-accent" />
          <label className="mt-4 block text-sm text-inksoft">Network {network && !manualNetwork && <span className="text-muted">(auto-detected)</span>}</label>
          <div className="mt-1 grid grid-cols-4 gap-2">
            {NETWORKS.map(n => (
              <button key={n.id} onClick={() => setManualNetwork(n.id)}
                className={`rounded-xl border px-2 py-2.5 text-sm ${network === n.id ? "border-accent bg-accentdeep text-white font-semibold" : "border-line bg-panel2 text-inksoft"}`}>{n.name}</button>
            ))}
          </div>
          <label className="mt-4 block text-sm text-inksoft">Amount</label>
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="500"
            className="mt-1 w-full rounded-xl border border-line bg-panel2 px-4 py-3 text-lg outline-none focus:border-accent" />
          <div className="mt-2 flex gap-2">
            {[100, 200, 500, 1000].map(v => (
              <button key={v} onClick={() => setAmount(String(v))}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${amount === String(v) ? "border-accent text-accent" : "border-line text-muted"}`}>{fmt(v)}</button>
            ))}
          </div>
          {error && <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-bad">{error}</p>}
          <button onClick={createOrder} disabled={busy || !phone || !network || !amount}
            className="mt-5 w-full rounded-xl bg-accentdeep py-3.5 text-lg font-semibold text-white disabled:opacity-40">
            {busy ? "Creating your account number…" : "Get account number"}
          </button>
          <p className="mt-3 text-center text-xs text-muted">The account number is created fresh for this purchase and expires in 30 minutes. It is never reused.</p>
        </section>
      )}

      {order && (
        <section className="mt-8 rounded-2xl border border-line bg-panel p-5">
          {order.status === "AWAITING_PAYMENT" && (<>
            <p className="text-center text-sm text-inksoft">Transfer exactly</p>
            <p className="text-center text-4xl font-bold">{fmt(order.amount)}</p>
            <p className="mt-1 text-center text-sm text-muted">to this {order.bankName || "bank"} account:</p>
            <div className="mt-4 rounded-xl bg-panel2 p-4 text-center">
              <p className="text-3xl font-bold tracking-widest">{order.accountNumber}</p>
              <p className="mt-1 text-sm text-inksoft">{order.accountName}</p>
              <div className="mt-3 flex justify-center gap-2">
                <button onClick={() => copy("num", order.accountNumber || "")} className="rounded-lg border border-line px-3 py-1.5 text-sm">{copied === "num" ? "Copied ✓" : "Copy number"}</button>
                <button onClick={() => copy("amt", String(order.amount))} className="rounded-lg border border-line px-3 py-1.5 text-sm">{copied === "amt" ? "Copied ✓" : "Copy amount"}</button>
              </div>
            </div>
            <p className="mt-4 text-center">Account expires in <span className={`font-mono font-bold ${countdown < 120 ? "text-bad" : "text-accent"}`}>{mmss}</span></p>
            <p className="mt-1 animate-pulse text-center text-sm text-inksoft">Waiting for your transfer…</p>
          </>)}
          {(order.status === "PAID" || order.status === "VENDING" || order.status === "OVERPAID") && (
            <div className="py-6 text-center">
              <p className="text-4xl">⏳</p>
              <p className="mt-2 text-xl font-semibold">Payment received — sending your airtime…</p>
              <p className="mt-1 text-sm text-inksoft">{fmt(order.vendAmount || order.amount)} of {NETWORKS.find(n => n.id === order.network)?.name} airtime to {order.phone}</p>
            </div>
          )}
          {order.status === "UNDERPAID" && (
            <div className="py-6 text-center">
              <p className="text-4xl">⚠️</p>
              <p className="mt-2 text-xl font-semibold">You transferred {fmt(order.amountPaid || 0)} instead of {fmt(order.amount)}</p>
              <p className="mt-1 text-sm text-inksoft">{(order.vendAmount || 0) >= 50
                ? <>We vended {fmt(order.vendAmount || 0)} of airtime — the amount that actually arrived.</>
                : <>That's under the ₦50 minimum to vend, so it's held in the refund queue.</>}</p>
            </div>
          )}
          {order.status === "DELIVERED" && (
            <div className="py-6 text-center">
              <p className="text-4xl">✅</p>
              <p className="mt-2 text-xl font-semibold">Airtime delivered</p>
              <p className="mt-1 text-sm text-inksoft">{fmt(order.vendAmount || order.amount)} {NETWORKS.find(n => n.id === order.network)?.name} → {order.phone}</p>
              {order.vtpassTxnId && <p className="mt-1 text-xs text-muted">VTpass reference: {order.vtpassTxnId}</p>}
            </div>
          )}
          {order.status === "VEND_FAILED" && (
            <div className="py-6 text-center">
              <p className="text-4xl">🔁</p>
              <p className="mt-2 text-xl font-semibold">Payment received, vend hit a snag</p>
              <p className="mt-1 text-sm text-inksoft">Your money is safe and recorded. The vend retries automatically; if it still can't complete, the order goes to the refund queue.</p>
            </div>
          )}
          {order.status === "EXPIRED" && (
            <div className="py-6 text-center">
              <p className="text-4xl">⌛</p>
              <p className="mt-2 text-xl font-semibold">This account number has expired</p>
              <p className="mt-1 text-sm text-inksoft">No payment arrived in time. Start again to get a fresh number — never send money to an expired one.</p>
            </div>
          )}
          <button onClick={reset} className="mt-4 w-full rounded-xl border border-line py-3 font-medium">New top-up</button>
          <p className="mt-3 text-center text-xs text-muted">Order {order.reference} · keep this reference if anything goes wrong.</p>
        </section>
      )}

      {recent.length > 0 && !order && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-inksoft">Recent orders on this device</h2>
          <div className="mt-2 space-y-2">
            {recent.map(r => (
              <button key={r} onClick={() => resume(r)} className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-left text-sm text-inksoft">
                {r} <span className="float-right text-accent">Check status →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 text-center text-xs text-muted">
        Personal tool · payments by Monnify, airtime by VTpass · a fresh virtual account is generated per purchase and expires after 30 minutes.
      </footer>
    </main>
  );
}
