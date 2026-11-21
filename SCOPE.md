# Airtime Bridge — Project Scope

*Working title — rename freely, like Veylo became Discaro.*
*Scoped 2026-11-21 at Abubakar's request. Status: BUILD STARTED 2026-11-21 on his go-ahead — Phases 1–2 code built and locally verified (Next.js app in this repo: order flow, Monnify dynamic invoices, VTpass vend, webhook + polling + cron reconciliation, Supabase schema). Phase 0 COMPLETE 2026-11-21 (Monnify + VTpass sandbox keys, Supabase project + schema + grant). Phase 1 full-chain test PASSED the same evening: order → Monnify dynamic invoice (Wema VA) → signed webhook (HMAC verified; forged signature 401; replay caused no double vend) → VTpass sandbox vend DELIVERED with real txn id; the one leg not exercisable in sandbox is Monnify's own transfer detection (its sandbox checkout cannot simulate a bank transfer — it waits for a real one, which must never be sent to a test account). Next: deploy to Vercel + set the webhook URL in the Monnify dashboard. Float stays a Phase 4 step.*

## 1. The idea (Abubakar's words, restated)

When his bank's own airtime purchase fails, he wants a tool that:

1. Generates a **fresh virtual account number that expires in minutes**
2. He transfers the exact amount to it from any bank app
3. The system **confirms receipt automatically**
4. The airtime is vended to his phone **the moment the money lands**
5. The account number dies — the next purchase gets a brand-new one

This is the "pay with transfer" pattern used across Nigerian fintech (e.g. betting-site deposit accounts). It is fully buildable from licensed building blocks — the tool never issues account numbers itself.

## 2. How it works (user flow)

1. Open the app → enter phone number, pick network (auto-detected from the number), enter amount (₦50 minimum) → tap **Get account number**
2. The app shows: **bank name + account number + exact amount + a live countdown** (e.g. 30:00)
3. He transfers from any bank app/USSD
4. Within seconds of the transfer landing, the processor's webhook hits our server → the order flips to PAID
5. The server calls the VTU API → airtime lands on the phone → order flips to DELIVERED, with the provider's reference shown
6. If the countdown ends unpaid, the order expires; the account number is never reused

## 3. Architecture (his proven stack)

- **App:** Next.js + TypeScript + Tailwind on Vercel (same stack as Discaro), Supabase Postgres for orders
- **Payments:** Monnify API — creates a one-time reserved account per order with an expiry; webhook confirms payment; transaction-status API as a polling fallback
- **Vending:** VTpass API — airtime purchase paid from a pre-funded VTpass wallet; sandbox available for testing
- **Money flow:** his transfer → Monnify (settles to his Monnify balance same day) ‖ VTpass wallet float (pre-funded ₦10–20k) pays for the vend instantly → settlements replenish the float

### Order state machine

`CREATED → AWAITING_PAYMENT → PAID → VENDING → DELIVERED`
Branches: `EXPIRED` (no payment in time), `VEND_FAILED` (paid but vend failed → auto-retry, then refund queue), `UNDERPAID` / `OVERPAID` (see policy below), `REFUNDED`.

Every webhook is verified by signature and processed **idempotently** (the same notification twice can never vend twice). A background requery job double-checks any order stuck in AWAITING_PAYMENT or VENDING — webhooks can be missed; money must not be.

## 4. Provider picks

| Role | Pick | Why | Alternative |
|---|---|---|---|
| Virtual accounts | **Monnify** (Moniepoint) | One-time accounts with expiry are its specialty (~40 min validity); instant confirmation; same-day settlement | Paystack (fees lower on small amounts — 1% capped ₦300 — but its virtual accounts are persistent per-customer, not one-time per purchase) |
| Airtime vending | **VTpass** | The standard developer VTU API; sandbox; airtime for MTN/Glo/Airtel/9mobile; pays reseller commission | Reloadly, ClubKonnect, InstantMobile |

## 5. Cost model (per purchase, at published rates — confirm exact figures at onboarding)

| | ₦500 | ₦1,000 | ₦5,000 |
|---|---|---|---|
| His bank's transfer fee (paid by sender, external) | ~₦10 | ~₦10 | ~₦10–25 |
| Monnify fee (1.5%, capped ₦2,000, +7.5% VAT on fee) | ~₦8 | ~₦16 | ~₦81 |
| VTU discount earned (~2–3% depending on network) | −₦10–15 | −₦20–30 | −₦100–150 |
| **Net cost of the pipe** | **≈ ₦0** | **≈ ₦0** | **≈ ₦0 or better** |

- No setup or monthly fees at either provider.
- One-off: a **float of ₦10–20k** sits in the VTpass wallet so vends are instant; settlements refill it.
- Float timing (clarified 2026-11-21): the float is a **Phase 4 go-live step, not a build cost** — Phases 1–3 run entirely on Monnify + VTpass sandboxes with test money, so the whole flow is proven before any real naira moves. The float is also not a fee: it stays his money in his VTpass wallet, is consumed only as airtime is actually vended, and can start smaller (₦2–5k) for personal use.
- Rule of thumb: the VTU discount roughly pays the processor fee. The real price of a purchase is his own bank's ~₦10 transfer charge.

## 6. Gates and honest limits

- **Merchant onboarding is his step** (like Supabase/Vercel were): Monnify signup needs BVN + ID + business name; full activation may ask for CAC registration — if it does, that's his call at that point. VTpass live API access requires first proving a **sandbox** integration (they ask for a successful test request ID).
- **Exact-amount policy (recommended default):** the account is created for one exact amount. Underpayment → vend what was actually received (if ≥ ₦50) or hold for refund; overpayment → vend the ordered amount, keep the excess as visible credit. Late payment to an expired account → the processor holds it; the app flags it for manual refund (reversals can take days — a processor rule, not ours).
- **Personal-use economics:** for his own airtime alone, this is a lot of machinery vs OPay/PalmPay. It earns its keep as a portfolio-grade fintech build, and it's public-ready if he ever wants the reseller spread from other people's purchases — but public use adds support/reconciliation burden and is a separate decision.
- **Dependency risk:** two providers must be up for a purchase to complete; the design degrades honestly (clear status shown, money never silently lost — every state is reconcilable from provider records).

## 7. Build phases

- **Phase 0 — Accounts:** Monnify + VTpass signups (his KYC steps), sandbox keys into the project env
- **Phase 1 — Sandbox end-to-end:** create expiring account → test transfer → webhook → test vend. Proves the whole chain before any real money
- **Phase 2 — The app:** order flow (number/network/amount → account + countdown → live status → delivered), order history, Supabase schema + RLS
- **Phase 3 — Hardening:** requery job, vend retries, refund queue, admin view, abuse limits (per-number/per-day caps)
- **Phase 4 — Go live, personal:** real keys, small float, low caps, used only by him
- **Phase 5 — Optional public launch:** only on a separate decision

## 8. Decisions needed from Abubakar

1. **Scope of use:** personal-first (recommended) — public later only if he says so
2. **Providers:** Monnify + VTpass as picked above, or does he want Paystack evaluated first?
3. **Name:** keep "Airtime Bridge" as the working title or pick another
4. **CAC question:** if Monnify's full activation requires business registration, proceed or park? (Decide when we see the actual requirement — no action now.)

*What Muse can do alone: all of Phases 1–3 in sandbox. What needs Abubakar: every identity/KYC step inside the provider dashboards, and the go-live call.*
