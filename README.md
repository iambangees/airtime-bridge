# Airtime Bridge

A fresh bank account number for every airtime purchase: enter a phone number and amount → get a one-time virtual account (Monnify dynamic invoice) → transfer the exact amount → the webhook confirms → VTpass vends the airtime instantly. The account number dies after payment or 30 minutes and is never reused.

See **SCOPE.md** for the full product scope and cost model.

## Status

Phases 1–2 code is built and locally verified (build + lint + types clean; 31 unit tests over the core logic; watertight order state machine with guarded, idempotent transitions). It runs end-to-end as soon as sandbox keys exist — see Phase 0.

## Phase 0 — accounts (owner's steps)

1. **Monnify** — sign up at monnify.com (business name + BVN + ID). In the dashboard: *Developers → API Keys & Contract* → copy the **sandbox** API key, secret key and contract code. Set the webhook URL (after deploy) to `https://<your-domain>/api/webhooks/monnify`.
2. **VTpass** — sign up at vtpass.com, then generate API keys in the dashboard (public + secret). Sandbox base URL: `https://sandbox.vtpass.com/api`. Sandbox test numbers: `08011111111` = successful vend, `201000000000` = pending, `500000000000` = unexpected response.
3. **Supabase** — create a project, run `supabase/schema.sql` in the SQL Editor ("Run and enable RLS"), copy the project URL + **service role** key (server-only secret — never put it in the browser or a public repo).

Put everything in `.env.local` (see `.env.example`). Nothing real is funded at this stage: the VTpass wallet float is a Phase 4 (go-live) step, not a build cost.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in sandbox keys
npm run dev                  # http://localhost:3000
```

Without keys the app still runs — the order API answers an honest "not fully configured yet" instead of failing silently.

## How it holds together

- `src/lib/core.ts` — pure logic: phone normalisation, network detection, Monnify signature check (HMAC-SHA512), the order state machine, the exact-amount policy.
- `src/lib/monnify.ts` — auth token cache, dynamic invoice creation, invoice status (polling fallback).
- `src/lib/vtpass.ts` — airtime purchase, requery, wallet balance.
- `src/lib/store.ts` — Supabase orders with guarded transitions (an update only lands from an allowed state — webhook replays can't double-vend).
- `src/lib/pipeline.ts` — payment → vend → delivered; safe to call from webhook, poller and cron simultaneously.
- `src/app/api/cron/requery` — sweep for stuck orders; call it every minute from any scheduler with `Authorization: Bearer <CRON_SECRET>`.
