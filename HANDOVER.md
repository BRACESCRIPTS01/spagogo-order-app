# Handover notes — Spagogo Order App

Operating notes for whoever runs the site. The technical description is in `README.md`; this file is about accounts, secrets, deploys, backups and what to do when something breaks.

## 1. Where everything lives

| Thing | Where | Notes |
|---|---|---|
| Code | GitHub `BRACESCRIPTS01/spagogo-order-app` | `main` = production, `dev` = testing. Nothing goes to `main` without being tested on `dev` first. |
| Hosting + functions | Netlify project `spagogofoodapp` | Production: https://spagogofoodapp.netlify.app — Test: https://dev--spagogofoodapp.netlify.app (branch deploy, same database). |
| Database + logins | Supabase project `secpyyvdokaidzkstbqm` | Tables `orders`, `profiles`, `staff`; Auth with custom SMTP. Free plan. |
| Payments (local) | Paystack | **Test mode.** Webhook URL registered in Settings → API Keys & Webhooks. |
| Payments (cards abroad) | Stripe | **Test mode only** — Stripe does not open accounts for Nigerian-registered businesses. |
| Chatbot | Google AI Studio key (`gemini-3.5-flash-lite`) | Free tier: roughly 500 requests per day at the time of writing, shared by production and `dev`. |
| Kitchen WhatsApp | +234 705 507 6189 | Paid orders are handed over here by the customer's tap. |
| Business email | fatimaspagheti@gmail.com | Shown on the contact page. |

In this demo every account belongs to the developer. For a client project each of these accounts is opened **in the client's name**, the developer is added as a collaborator, and the client can remove that access at any time.

## 2. Secrets

All secrets are Netlify environment variables, marked *Contains secret values*: `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY` (restricted key), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`. They are never in the repository, never in chat messages, never in the browser. Each variable must have a value for **Production and Branch deploys**, otherwise the function returns 500 on the missing context.

At handover to a client: rotate every key (Paystack, Stripe, Supabase secret key, Gemini), paste the new values into Netlify, redeploy, and switch on two-factor authentication on GitHub, Netlify, Supabase, Paystack and Stripe.

## 3. Deploying a change

1. Work on the `dev` branch and push. Netlify builds `dev--spagogofoodapp.netlify.app` automatically — branch deploys cost no credits.
2. Test on the `dev` URL (order page, a Paystack test payment, the kitchen board).
3. Only then: `git checkout main` → `git pull` → `git merge dev` → `git push` → `git checkout dev`. A production deploy costs 15 of the 300 free Netlify credits per month, so merge finished batches, not single lines.
4. Check the production page once after the deploy.

Rollback: Netlify → Deploys → pick the previous deploy → *Publish deploy*.

## 4. Changing business facts

| What | Where to change it |
|---|---|
| Opening hours | `OPEN_HOUR` / `CLOSE_HOUR` in `Netlify/functions/pay.mjs` and `stripe-checkout.mjs` (the rule that counts), the same two numbers in `main.js` (the note the customer sees), the FACTS line in `chat.mjs`, and the text on `index.html`, `menu.html`, `delivery.html`, `faq.html`, `terms.html`, `contact.html`. |
| Menu and prices | `MENU` in `pay.mjs` **and** `stripe-checkout.mjs` (both must match), the dish list in `index.html`, `menu.html`, and the menu list in `chat.mjs`. Keep the ` - ₦1,500` suffix on item names — the points trigger reads the price from it. |
| Delivery fee | `DELIVERY_FEE` in `pay.mjs` and `stripe-checkout.mjs`; texts on `index.html`, `delivery.html`, `faq.html`, `terms.html`, `chat.mjs`. |
| Add a staff member | Supabase → SQL Editor: `insert into public.staff (user_id, note) select id, 'Name' from auth.users where email = 'person@example.com';` (the person must have created a customer account first). Remove with `delete from public.staff where user_id = (select id from auth.users where email = 'person@example.com');` |
| Site domain | `ALLOWED_ORIGINS` in `chat.mjs`, `pay.mjs`, `stripe-checkout.mjs`; Supabase Auth → URL configuration; Paystack and Stripe webhook URLs; `sitemap.xml`, `robots.txt` and the `og:url` tags. |

## 5. Weekly backup (the Free plan keeps none)

Supabase Free has no automatic backups. Once a week (Friday after 4 pm is a natural moment):

1. Supabase → **Table Editor** → hover the `orders` table in the left list → the **⋯** menu → **Export data** → **Export table as CSV**.
2. Repeat for `profiles` and `staff`.
3. Save the three files in a dated folder (for example `backups/2026-10-17/`) on a drive that is not the laptop alone (Google Drive, OneDrive, a USB stick).

Alternative when you need a filtered export: SQL Editor → run `select * from public.orders order by id;` → **Export** above the results → **Download CSV**.

Customer logins (`auth.users`) cannot be re-imported from CSV with their passwords; if the project were ever lost, customers would use *Forgot password* once. Orders and points come back from the CSV.

## 6. Supabase idle pause

Free-plan projects are **paused after about 7 days with no activity**. Normal use (orders, logins, the kitchen board on weekdays) keeps the project active; a long holiday does not.

- Symptoms: the order page says payment could not start, login fails, the kitchen board shows an error. Netlify function logs show connection errors to Supabase.
- Fix: Supabase dashboard → the project → **Restore project**. It takes a few minutes; nothing is lost on a pause.
- Prevention: open the kitchen board or the My-orders page at least once a week, or move the project to a paid plan (also brings daily backups).

Supabase Free allows two active projects per organisation; this site uses one.

## 7. When something looks wrong

| Symptom | Check, in this order |
|---|---|
| Customer paid but the kitchen got nothing | Paystack dashboard → Transactions (did the charge succeed?) → Supabase `orders` row (`status` approved?) → the customer did not tap the WhatsApp button; call the number on the order. |
| Order stays "pending" on the confirmation page | Netlify → the project → function logs for `paystack-webhook` / `verify-payment`. Usual causes: webhook URL not registered for this site, or `PAYSTACK_SECRET_KEY` missing for that deploy context. |
| "Card payment is not set up" / "Payment is not set up" | A secret is missing for that context (Production vs Branch deploys) — see section 2. |
| Chat says it reached its daily limit | Gemini free quota is used up; it resets at midnight Pacific time (8–9 am Lagos). Nothing to fix. |
| Chat or Place Order says "wait a minute" | Netlify rate limit: 10 chat requests or 5 payment starts per minute from one IP. Wait 60 s. |
| Kitchen board "Today" is empty on a weekend | Expected: *Today* lists orders **scheduled** for today; weekend orders are scheduled for Monday 6 am. Use *All*. |
| 500 on `dev--` but production fine | Secret not set for Branch deploys. |

Function logs: Netlify → the project → **Logs → Functions** (pick the function, then the time range).

## 8. Test data in the database

Rows created while testing (Paystack/Stripe test cards) sit in `orders` next to real ones. To clean up, first look:

```sql
select id, created_at, customer_name, item, amount, status, payment_provider
from public.orders
where id >= 26
order by id;
```

then delete **only the ids you recognise as tests**, by explicit list:

```sql
delete from public.orders where id in (26, 27);
```

Points were awarded on those test orders to the test accounts; they disappear with the rows (points are stored on the order).

## 9. Known limits, stated plainly

- Both payment providers run in **test mode**; no real money has ever moved through this site.
- The kitchen is notified by the **customer's** WhatsApp tap. If the customer closes the page, the order is still saved and paid, but someone has to look at the kitchen board.
- No automatic backups (section 5), possible idle pause (section 6).
- The chatbot answers only from the facts in `chat.mjs`; it says "ask on WhatsApp" for anything else.
- Rate limits and the origin allow-list slow abuse down; they do not make the site "unhackable" — nothing does.