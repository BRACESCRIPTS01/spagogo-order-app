-- ============================================================
-- 2026-10-10  Stripe Checkout as a second payment option
-- ============================================================
-- Run once in the Supabase SQL Editor. A second run stops at the
-- first "already exists" error, which means it was already applied.
--
-- payment_provider   'paystack' | 'stripe' | null (no online payment)
--                    default 'paystack', so pay.mjs is unchanged;
--                    stripe-checkout.mjs sets 'stripe' explicitly.
-- stripe_session_id  Stripe Checkout Session id (cs_...), the Stripe
--                    equivalent of paystack_reference: stripe-webhook.mjs
--                    matches on it, and UNIQUE keeps repeats harmless.

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists stripe_session_id text;

update public.orders
set payment_provider = 'paystack'
where paystack_reference is not null;

alter table public.orders
  alter column payment_provider set default 'paystack';

alter table public.orders
  add constraint orders_payment_provider_check
  check (payment_provider in ('paystack', 'stripe'));

alter table public.orders
  add constraint orders_stripe_session_id_key unique (stripe_session_id);

comment on column public.orders.payment_provider is
  'paystack | stripe | null = no online payment. Set by the server functions, never by the browser.';
comment on column public.orders.stripe_session_id is
  'Stripe Checkout Session id (cs_...). Set by stripe-checkout.mjs; stripe-webhook.mjs matches on it.';

-- How status moves for Stripe orders (server-side only, same as Paystack):
--   pending -> approved   stripe-webhook.mjs / verify after signature + amount + currency checks
--   pending -> rejected   verify when Stripe reports the session expired or the payment failed
--   pending -> error      amount/currency mismatch (needs a human)