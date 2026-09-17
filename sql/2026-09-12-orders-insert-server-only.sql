-- ============================================================
-- 2026-09-12  Orders are created only by Netlify/functions/pay.mjs
-- ============================================================
-- pay.mjs inserts orders with the Supabase secret key (bypasses RLS), so the
-- browser must no longer be able to insert rows: an order that skipped pay.mjs
-- would have no server-computed price, no Paystack reference and no payment.
--
-- Before running: confirm the INSERT policy name with
--   select policyname, cmd from pg_policies where tablename = 'orders';
-- At the time this ran the two policies were
--   "Insert own or guest order"      INSERT  (dropped below)
--   "Users can view their own orders" SELECT  (kept)

drop policy if exists "Insert own or guest order" on public.orders;

-- Afterwards only the SELECT policy remains; the browser has no write path.
