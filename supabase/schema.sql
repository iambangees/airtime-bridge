-- Airtime Bridge — orders schema (run in the Supabase SQL Editor, "Run and enable RLS")
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,            -- our reference = Monnify invoiceReference
  phone text not null,
  network text not null,                     -- mtn | airtel | glo | etisalat (VTpass serviceID)
  amount integer not null,                   -- ordered amount (NGN)
  amount_paid integer,                       -- what actually arrived
  vend_amount integer,                       -- what was vended (exact-amount policy)
  status text not null default 'CREATED',    -- see src/lib/core.ts OrderStatus
  account_number text,
  account_name text,
  bank_name text,
  bank_code text,
  checkout_url text,
  expires_at timestamptz,
  monnify_txn_ref text,
  vtpass_request_id text unique,
  vtpass_txn_id text,
  vend_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at);

alter table public.orders enable row level security;
-- No public policies on purpose: the browser never talks to this table.
-- All access is server-side with the service role key (bypasses RLS),
-- and the API only ever returns a single order by its unguessable reference.
