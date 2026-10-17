-- ============================================================
-- 2026-10-17  scheduled_for: when the kitchen should start an order
-- ============================================================
-- Run once in the Supabase SQL Editor. A second run stops at the
-- first "already exists" error, which means it was already applied.
--
-- scheduled_for  equals created_at for orders placed in opening hours;
--                orders placed outside Mon-Fri 6am-4pm (Lagos) get the
--                next opening time, set by pay.mjs / stripe-checkout.mjs.
--                Existing rows are backfilled with created_at.

alter table public.orders add column scheduled_for timestamp with time zone;
update public.orders set scheduled_for = created_at where scheduled_for is null;
alter table public.orders alter column scheduled_for set default now();
alter table public.orders alter column scheduled_for set not null;