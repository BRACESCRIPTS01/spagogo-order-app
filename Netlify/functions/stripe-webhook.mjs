// Netlify/functions/stripe-webhook.mjs
// Stripe calls this when a Checkout Session has been paid (snapshot event "checkout.session.completed").
// Signature check -> event check -> order lookup by stripe_session_id -> amount + currency check -> 'approved'.
// Env vars: STRIPE_WEBHOOK_SECRET (this endpoint's whsec_... signing secret), SUPABASE_SECRET_KEY

import { createHmac, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = "https://secpyyvdokaidzkstbqm.supabase.co";
const CURRENCY = "ngn";
const TOLERANCE_SECONDS = 300;

export default async (req) => {
    if (req.method !== "POST") return reply(405, "Method not allowed");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!webhookSecret || !supabaseKey) {
        console.error("stripe-webhook: missing environment variable(s):",
            [!webhookSecret && "STRIPE_WEBHOOK_SECRET", !supabaseKey && "SUPABASE_SECRET_KEY"].filter(Boolean).join(", "));
        return reply(500, "Server not configured");
    }

    const raw = Buffer.from(await req.arrayBuffer());
    const check = verifySignature(req.headers.get("stripe-signature") || "", raw, webhookSecret);
    if (!check.ok) {
        console.warn("stripe-webhook: rejected -", check.reason, "- from ip", req.headers.get("x-nf-client-connection-ip"));
        return reply(401, "Invalid signature");
    }

    let event;
    try {
        event = JSON.parse(raw.toString("utf8"));
    } catch {
        return reply(400, "Invalid JSON");
    }
    const session = event && event.data && typeof event.data.object === "object" && event.data.object ? event.data.object : {};

    const paidEvent = event && (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded");
    if (!paidEvent || session.object !== "checkout.session" || session.payment_status !== "paid") {
        console.log("stripe-webhook: ignoring event", event && event.type, "payment_status", session.payment_status);
        return reply(200, "Ignored");
    }
    const sessionId = typeof session.id === "string" ? session.id : "";
    if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) {
        console.warn("stripe-webhook: ignoring paid event with unusable session id");
        return reply(200, "Ignored");
    }

    const found = await supabaseRest(supabaseKey, "GET",
        "/rest/v1/orders?select=id,status,amount&stripe_session_id=eq." + encodeURIComponent(sessionId));
    if (!found.ok || !Array.isArray(found.data)) {
        console.error("stripe-webhook: order lookup failed for", sessionId, found.status, found.text);
        return reply(500, "Lookup failed");
    }
    const order = found.data[0];
    if (!order) {
        console.warn("stripe-webhook: no order with session", sessionId, "- nothing to do");
        return reply(200, "Unknown session");
    }

    const amountOk = Number.isInteger(session.amount_total) && session.amount_total === order.amount;
    const currencyOk = session.currency === CURRENCY;
    if (!amountOk || !currencyOk) {
        console.error("stripe-webhook: MISMATCH on order", order.id, "- paid", session.amount_total, session.currency,
            "expected", order.amount, CURRENCY + ". Marking error.");
        if (order.status !== "approved") {
            await supabaseRest(supabaseKey, "PATCH", "/rest/v1/orders?id=eq." + order.id,
                { status: "error" }, "return=minimal");
        }
        return reply(200, "Mismatch recorded");
    }

    if (order.status === "approved") {
        console.log("stripe-webhook: order", order.id, "already approved - repeat delivery ignored");
        return reply(200, "Already approved");
    }
    const updated = await supabaseRest(supabaseKey, "PATCH",
        "/rest/v1/orders?id=eq." + order.id + "&status=in.(pending,rejected)&select=id,status,points_earned",
        { status: "approved" }, "return=representation");
    if (!updated.ok || !Array.isArray(updated.data)) {
        console.error("stripe-webhook: could not approve order", order.id, updated.status, updated.text);
        return reply(500, "Update failed");
    }
    if (updated.data.length === 0) {
        console.warn("stripe-webhook: order", order.id, "not changed (status was", order.status + ")");
        return reply(200, "No change");
    }
    console.log("stripe-webhook: order", order.id, "APPROVED via", sessionId, "- points awarded:", updated.data[0].points_earned);
    return reply(200, "OK");
};

function verifySignature(header, raw, secret) {
    let timestamp = "";
    const signatures = [];
    for (const part of header.split(",")) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        const key = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        if (key === "t") timestamp = value;
        else if (key === "v1") signatures.push(value);
    }
    if (!/^[0-9]{1,12}$/.test(timestamp) || signatures.length === 0) return { ok: false, reason: "malformed header" };
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (age > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance (" + age + "s)" };
    const expected = Buffer.from(createHmac("sha256", secret).update(timestamp + ".").update(raw).digest("hex"));
    for (const sig of signatures) {
        const given = Buffer.from(sig);
        if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
    }
    return { ok: false, reason: "no matching v1 signature" };
}

function reply(status, message) {
    return new Response(message, { status: status, headers: { "Content-Type": "text/plain" } });
}

async function supabaseRest(secretKey, method, path, body, prefer) {
    const headers = {
        "apikey": secretKey,
        "Authorization": "Bearer " + secretKey,
        "User-Agent": "spagogo-netlify-function"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers["Prefer"] = prefer;
    const res = await fetch(SUPABASE_URL + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text for the log */ }
    return { ok: res.ok, status: res.status, data: data, text: text };
}