# Spagogo Order App

Ordering and payment site for **Fatima Spagogo**, a small spaghetti-delivery kitchen in Ibafo & Mowe, Ogun State, Nigeria.
A customer picks a meal, pays with Paystack (card / bank transfer / USSD) or with an international card through Stripe Checkout, and the kitchen receives a **paid** order on WhatsApp — no unpaid orders, no price set by the browser.

**Live demo (Paystack and Stripe, both in test mode):** https://spagogofoodapp.netlify.app/
Paystack test card: `4084 0840 8408 4081`, any future expiry, CVV `408`, PIN `0000`, OTP `123456`.
Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC. No real money moves either way.

Operating notes for whoever runs the site (accounts, secrets, backups, what to do when something breaks) are in [`HANDOVER.md`](HANDOVER.md).

## What it does

- Order form with guest checkout; optional customer accounts (email + password, email confirmation, password reset).
- Server-side pricing: item × quantity + delivery fee (Ibafo free, Mowe from ₦500). The browser only sends *what* was chosen.
- Two payment providers, chosen on the form: Paystack (local) or Stripe Checkout (international cards, prices still in naira). Each has its own signature-verified webhook that approves the order.
- Confirmation page that asks the server whether the order is really paid before showing the WhatsApp hand-off button.
- **Opening hours enforced on the server.** The kitchen runs Monday–Friday, 6am–4pm (Africa/Lagos). Orders can be placed and paid at any time; outside those hours `pay.mjs` / `stripe-checkout.mjs` stamp the order with `scheduled_for` = the next opening time. The customer sees that time before paying, on the confirmation and in the WhatsApp message; the kitchen board shows it as a red *Scheduled* badge, and its *Today* view means "scheduled for today".
- Loyalty points: 1 point per ₦100, computed by a Postgres trigger on approved orders only.
- "My orders" page: order history with status (✓ approved, ✗ rejected, ● pending) and points.
- FAQ chatbot (Gemini `gemini-3.5-flash-lite`) with structured output; an order intent in the chat pre-fills the form. Rate-limited per IP; shows a plain message when the free daily quota is used up.
- **Kitchen board** (`staff.html`, unlinked): staff log in with the same accounts and see the orders scheduled for today (or all orders) with payment state, phone/WhatsApp links and address; they move each order New → Preparing → Out for delivery → Delivered (or Cancel). Unpaid orders cannot be started. Refreshes every 30 s.
- Eight pages with a shared header and footer: home/order form, menu, delivery areas, about, FAQ, contact, privacy, terms, plus a 404 page, `robots.txt` and `sitemap.xml`.
- Responsive: phone, tablet (both orientations) and desktop; per-page photo backgrounds; the kitchen board stacks its columns on phones.
- No third-party requests from the browser except the pinned Supabase bundle: fonts (Inter, Outfit — SIL OFL) are served from the site itself; photos are WebP (240 px on the order form, 720 px on the menu page).

## How a payment flows

```
browser                 Netlify functions                 Paystack            Supabase (Postgres)
  │ Place Order ─────────▶ pay.mjs  (/api/pay)                                 │
  │                         validate, price in kobo, scheduled_for ──────────▶ insert order (pending, amount)
  │                         initialize ────────────────▶ authorization_url      │
  │                         store reference ──────────────────────────────────▶ paystack_reference
  │ ◀── redirect to checkout                                                    │
  │ pays on Paystack ─────────────────────────────────▶                          │
  │                       paystack-webhook.mjs ◀─────── charge.success           │
  │                         HMAC-SHA512 check, amount + currency check ───────▶ status = approved → trigger awards points
  │ back on site ────────▶ verify-payment.mjs ──(if still pending)──▶ verify    │
  │ ◀── paid / failed / pending / error                                         │
  │ "Send order to kitchen on WhatsApp" (only when paid)                        │
```

Stripe follows the same shape with its own three functions: `stripe-checkout.mjs` creates a Checkout Session (amount in kobo, currency `ngn`, 35-minute expiry) and stores the session id; `stripe-webhook.mjs` verifies the `Stripe-Signature` header (HMAC-SHA256 over `timestamp.body`, 5-minute replay window, constant-time compare) and approves the order after the same amount + currency check; `verify-stripe.mjs` answers the return page. Whichever of webhook and return-page check arrives first approves; the second one changes nothing.

Function URLs: `pay.mjs` is served at `/api/pay` and `chat.mjs` at `/api/chat` (a custom path is required for Netlify's rate limiting); every other function keeps the default `/.netlify/functions/<name>`.

Orders are created and their status changed only by the server functions, using the Supabase **secret** key. Row Level Security on `orders` gives the browser's publishable key no INSERT/UPDATE/DELETE at all and SELECT only on the signed-in customer's own rows.

## Stack

| Layer | What | Why |
|---|---|---|
| Frontend | Plain HTML / CSS / JS, no build step | Small site, fast on cheap phones, nothing to maintain |
| Hosting + API | Netlify (static + Functions, modern `Request`/`Response` format) | Free tier, Git deploys, secrets stay in env vars |
| Database + Auth | Supabase (Postgres, RLS, email auth with custom SMTP) | Real Postgres with row-level policies and triggers |
| Payments | Paystack (Standard checkout + webhooks) | Nigerian cards, transfers and USSD; test mode for the demo |
| Payments (international) | Stripe Checkout (hosted page + webhooks), restricted API key | Shows a second provider behind the same order flow; test mode only — see *Path to production* |
| Chatbot | Gemini via `chat.mjs` | Structured JSON output → safe form pre-fill |

## Security decisions

- **Prices, delivery fees, totals and the scheduled time are computed on the server** (`pay.mjs`, `stripe-checkout.mjs`). Client-sent amounts, statuses, times or user ids are ignored.
- **Webhook signatures are mandatory**: Paystack — HMAC-SHA512 of the raw body with the secret key; Stripe — HMAC-SHA256 of `timestamp.rawbody` with the endpoint's signing secret, rejected when the timestamp is more than 5 minutes old. Both compared in constant time. Then event type, payment state, amount **and** currency must all match the stored order; a mismatch marks the order `error`, never `approved`.
- **Idempotent**: both providers retry deliveries; an approved order is never touched again, an `error` order is never auto-approved, and the approve update is conditional (`status in (pending, rejected)`), so webhook and return-page check cannot award points twice.
- **Rate limits at the edge** (Netlify rate-limiting rules, enforced before the function runs): `/api/chat` 10 requests per minute per IP, `/api/pay` 5 per minute per IP. Over the limit the request gets a 429 and the page shows a plain "wait a minute" message. The Free plan allows two rules; they are spent on the two endpoints that cost money or quota. The webhooks are deliberately **not** rate-limited — Paystack and Stripe must always get through.
- **Origin allow-list**: `chat.mjs`, `pay.mjs` and `stripe-checkout.mjs` refuse browser requests whose `Origin` header is not this site (403). That stops pages on other domains from spending the Gemini quota or creating pending orders through a visitor's browser. It is not a defence against scripts (any client can forge headers) — the rate limits and server-side validation are.
- **Least-privilege Stripe key**: the functions use a restricted key with *Checkout Sessions: Write* only — it cannot refund, read customers or change the account.
- **Two key classes**: the browser has only the Supabase *publishable* key (RLS enforced); the functions use the *secret* key from Netlify env vars. No key is in the repo.
- **Logged-in orders are attributed from the access token**, verified server-side against Supabase Auth — not from a user id sent by the browser.
- **The confirmation URL leaks nothing**: `verify-payment` and `verify-stripe` return item/amount/schedule only; name, phone and address are kept in the customer's own browser for the WhatsApp message.
- Points are set by a `BEFORE INSERT OR UPDATE` trigger that overwrites any client-supplied value.
- **Staff access is a server-side lookup.** The staff list is its own table with RLS on and *no* policies (browser roles revoked), so nothing in the browser can read or grant it. `staff-orders.mjs` verifies the access token with Supabase Auth, checks the id against that table with the secret key, and only then reads or updates orders. It never writes the payment `status`; kitchen progress is a separate column, and updates are conditional on the state the staff member saw (two phones cannot both "win").
- **Browser hardening**: `_headers` sets a Content-Security-Policy (scripts only from this site and the pinned CDN bundle — no inline scripts — network only to Supabase and our functions, fonts and images from this site, no framing), `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`; `staff.html` and `orders.html` are `no-store` and `noindex`. supabase-js is pinned to an exact version with a Subresource Integrity hash. Payment pages are reached by redirect; the browser never holds a payment key.

## Repository layout

```
index.html, main.js              order form, payment choice, schedule note, return-page panel
menu.html, delivery.html, about.html, faq.html, contact.html, privacy.html, terms.html   content pages
404.html, robots.txt, sitemap.xml, og-image.jpg, logo.svg   not-found page, crawler files, link-preview image, logo
layout.css, order.css, style.css shared layout/header/footer, order form, everything else (incl. kitchen board)
nav.js                           shared header/footer + active link
chat-widget.js                   FAQ chatbot UI (talks to /api/chat)
supabase-init.js                 Supabase client (publishable key)
auth.js                          login / signup / forgot / reset password (Supabase Auth)
orders.html, orders.js           "My orders" page
staff.html, staff.js             kitchen board (staff only; not linked from the site)
fonts/, menu-*.webp, bg-*.webp   self-hosted Inter + Outfit (licences included), dish photos, page backgrounds
_headers                         security headers (CSP etc.) applied by Netlify
Netlify/functions/pay.mjs        price + schedule + save order + Paystack initialize  (served at /api/pay, rate-limited)
Netlify/functions/paystack-webhook.mjs   verify signature + amount → approve
Netlify/functions/verify-payment.mjs     "is this paid?" for the return page (+ declined → rejected)
Netlify/functions/stripe-checkout.mjs    price + schedule + save order + Stripe Checkout Session
Netlify/functions/stripe-webhook.mjs     verify Stripe-Signature + amount → approve
Netlify/functions/verify-stripe.mjs      "is this paid?" for the Stripe return page
Netlify/functions/chat.mjs       Gemini FAQ bot  (served at /api/chat, rate-limited)
Netlify/functions/staff-orders.mjs       staff check + list/update orders for the kitchen board
sql/                             schema changes applied to the Supabase project, in order
netlify.toml                     functions directory
HANDOVER.md                      operating notes: accounts, secrets, deploys, backups, incidents
```

## Configuration

Netlify → Project configuration → Environment variables. Mark them as secret, and set the value for **every deploy context you use** (Production, Deploy Previews, Branch deploys) — a secret set for Production only makes the same function return 500 on a branch deploy.

| Variable | Used by |
|---|---|
| `PAYSTACK_SECRET_KEY` | `pay.mjs`, `paystack-webhook.mjs`, `verify-payment.mjs` |
| `STRIPE_SECRET_KEY` | `stripe-checkout.mjs`, `verify-stripe.mjs` — a *restricted* key, permission Checkout Sessions: Write |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook.mjs` — the `whsec_…` of the endpoint below; each endpoint (production, dev) has its own |
| `SUPABASE_SECRET_KEY` | every function that touches `orders` |
| `GEMINI_API_KEY` | `chat.mjs` |

Paystack → Settings → API Keys & Webhooks → **Webhook URL**:
`https://<site>/.netlify/functions/paystack-webhook`

Stripe → Workbench → Webhooks → **Create an event destination** → payload format *Snapshot*, event `checkout.session.completed`, endpoint
`https://<site>/.netlify/functions/stripe-webhook` → reveal the signing secret and store it as `STRIPE_WEBHOOK_SECRET`.

Supabase: run the files in `sql/` in date order; enable email confirmation; add the site URL to Auth → URL configuration → Redirect URLs.

Site origins: `ALLOWED_ORIGINS` at the top of `chat.mjs`, `pay.mjs` and `stripe-checkout.mjs` lists the production and `dev` URLs; add any new domain there.

## Path to production

This is a working demo with both providers in **test mode**. To take real orders:

1. Complete Paystack business verification, switch to live keys, register the **live** webhook URL.
2. Stripe: Stripe does not currently open accounts for businesses registered in Nigeria (it points them to Paystack). The Stripe option here demonstrates a second provider behind the same order flow; for a real launch either remove the option or run it from a Stripe-supported company entity with live keys and a live webhook endpoint.
3. Replace the `wa.me` hand-off with a server-side send through the **WhatsApp Business (Cloud) API** so the kitchen is notified even if the customer closes the tab.
4. Custom domain + HTTPS (Netlify handles the certificate); add the domain to `ALLOWED_ORIGINS` in the three functions, to Supabase Auth redirect URLs and to the Paystack/Stripe webhook URLs.
5. Raise Supabase Auth email rate limits, or move transactional email to a dedicated provider.
6. Backups: the Supabase Free plan keeps none. `HANDOVER.md` describes the weekly CSV export and the idle-pause rule; a paid Supabase plan adds daily backups and removes pausing.

## Local development

```
npm i -g netlify-cli
netlify functions:serve --port 9999     # functions at http://localhost:9999/.netlify/functions/<name>
```

Serve the static files with any local server (or `netlify dev`) and point the Paystack test webhook at a public tunnel — Paystack cannot call `localhost`. For Stripe, the Stripe CLI can forward events: `stripe listen --forward-to localhost:9999/.netlify/functions/stripe-webhook`. Rate-limit rules are enforced only on Netlify itself. Locally the browser's `Origin` is `http://localhost:…`, which is not in `ALLOWED_ORIGINS`, so add it there temporarily while testing the functions locally — and take it out again before pushing.