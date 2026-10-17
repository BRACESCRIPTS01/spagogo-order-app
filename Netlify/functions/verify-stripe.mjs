// Netlify/functions/verify-stripe.mjs
// The browser calls this when the customer lands back from Stripe Checkout:
//   GET /.netlify/functions/verify-stripe?session_id=cs_test_...
// Same answers as verify-payment.mjs so the page can treat both providers alike:
//   { status: "paid" | "failed" | "pending" | "error", order: { id, amount, item, quantity, zone } }
// Env vars: STRIPE_SECRET_KEY (restricted key, Checkout Sessions: Write), SUPABASE_SECRET_KEY

const SUPABASE_URL = "https://secpyyvdokaidzkstbqm.supabase.co";
const CURRENCY = "ngn";

export default async (req) => {
    if (req.method !== "GET") return json(405, { error: "Method not allowed" });
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!stripeKey || !supabaseKey) {
        console.error("verify-stripe: missing environment variable(s):",
            [!stripeKey && "STRIPE_SECRET_KEY", !supabaseKey && "SUPABASE_SECRET_KEY"].filter(Boolean).join(", "));
        return json(500, { error: "Server not configured" });
    }

    const sessionId = new URL(req.url).searchParams.get("session_id") || "";
    if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) {
        return json(400, { error: "Missing or invalid session id" });
    }

    const found = await supabaseRest(supabaseKey, "GET",
        "/rest/v1/orders?select=id,status,amount,item,quantity,zone,created_at,scheduled_for&stripe_session_id=eq." + encodeURIComponent(sessionId));
    if (!found.ok || !Array.isArray(found.data)) {
        console.error("verify-stripe: order lookup failed for", sessionId, found.status, found.text);
        return json(500, { error: "Lookup failed" });
    }
    const order = found.data[0];
    if (!order) return json(404, { error: "No order with that session" });
    const pub = { id: order.id, amount: order.amount, item: order.item, quantity: order.quantity, zone: order.zone, created_at: order.created_at, scheduled_for: order.scheduled_for };
    if (order.status === "approved") return json(200, { status: "paid", order: pub });
    if (order.status === "error") return json(200, { status: "error", order: pub });

    let res = null;
    let s = null;
    try {
        res = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
            headers: { "Authorization": "Bearer " + stripeKey }
        });
        s = await res.json();
    } catch (err) {
        console.error("verify-stripe: Stripe unreachable for", sessionId, String(err));
    }
    if (res && (res.status === 401 || res.status === 403)) {
        console.error("verify-stripe: Stripe rejected the API key (" + res.status + ") -",
            s && s.error && s.error.message, "- check STRIPE_SECRET_KEY permissions");
        return json(500, { error: "Verification unavailable" });
    }
    if (!res || !res.ok || !s || s.object !== "checkout.session") {
        console.warn("verify-stripe: Stripe gave no usable answer for", sessionId, "-", res && res.status, s && s.error && s.error.message);
        return json(200, { status: order.status === "rejected" ? "failed" : "pending", order: pub });
    }

    if (s.payment_status === "paid") {
        if (Number.isInteger(s.amount_total) && s.amount_total === order.amount && s.currency === CURRENCY) {
            const upd = await supabaseRest(supabaseKey, "PATCH",
                "/rest/v1/orders?id=eq." + order.id + "&status=in.(pending,rejected)&select=id,status",
                { status: "approved" }, "return=representation");
            if (!upd.ok) {
                console.error("verify-stripe: could not approve order", order.id, upd.status, upd.text);
                return json(500, { error: "Update failed" });
            }
            console.log("verify-stripe: order", order.id, "APPROVED via verify (" + sessionId + ")");
            return json(200, { status: "paid", order: pub });
        }
        console.error("verify-stripe: MISMATCH on order", order.id, "- paid", s.amount_total, s.currency,
            "expected", order.amount, CURRENCY + ". Marking error.");
        await supabaseRest(supabaseKey, "PATCH",
            "/rest/v1/orders?id=eq." + order.id + "&status=in.(pending,rejected)",
            { status: "error" }, "return=minimal");
        return json(200, { status: "error", order: pub });
    }

    if (s.status === "expired") {
        await supabaseRest(supabaseKey, "PATCH",
            "/rest/v1/orders?id=eq." + order.id + "&status=eq.pending",
            { status: "rejected" }, "return=minimal");
        console.log("verify-stripe: order", order.id, "payment page EXPIRED without payment");
        return json(200, { status: "failed", order: pub, reason: "payment page expired" });
    }

    console.log("verify-stripe: order", order.id, "Stripe status", s.status, "/", s.payment_status, "- leaving as", order.status);
    return json(200, { status: order.status === "rejected" ? "failed" : "pending", order: pub });
};

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status: status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
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