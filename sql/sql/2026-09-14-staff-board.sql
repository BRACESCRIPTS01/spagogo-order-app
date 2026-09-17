-- ============================================================
-- 2026-09-14  Kitchen staff board (staff.html + Netlify/functions/staff-orders.mjs)
-- ============================================================
-- Design notes
--  * The staff flag is NOT a column on profiles: profiles has an UPDATE policy
--    that lets a customer change any column of their own row, so they could
--    make themselves staff. A separate table with RLS on, NO policies and the
--    browser roles revoked can only be read by the server functions.
--  * Kitchen progress is a separate enum from the payment status, which stays
--    owned by Paystack's webhook. Staff never touch `status`.

-- 1. Staff list
create table if not exists public.staff (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);
alter table public.staff enable row level security;
revoke all on table public.staff from anon, authenticated;

-- 2. Kitchen status on orders
do $$ begin
  if not exists (select 1 from pg_type where typname = 'kitchen_status') then
    create type public.kitchen_status as enum
      ('new', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');
  end if;
end $$;

alter table public.orders
  add column if not exists kitchen_status     public.kitchen_status not null default 'new',
  add column if not exists kitchen_updated_at timestamptz;

-- 3. Who is staff. Add more people with the same statement and their email.
insert into public.staff (user_id, note)
select id, 'restaurant owner' from auth.users where email = 'fatimaspagheti@gmail.com'
on conflict (user_id) do nothing;

-- Check:
--   select count(*) from public.staff;                                   -- 1
--   select count(*) from pg_policies where tablename = 'staff';          -- 0
