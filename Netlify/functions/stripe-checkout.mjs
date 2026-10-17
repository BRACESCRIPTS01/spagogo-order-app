// Netlify/functions/stripe-checkout.mjs
// Creates the order (status 'pending') and a Stripe Checkout Session for it, all server-side.
// Env vars: STRIPE_SECRET_KEY (restricted key: Checkout Sessions write), SUPABASE_SECRET_KEY

const SUPABASE_URL = "https://secpyyvdokaidzkstbqm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8tDy1gTILSX3CVCNTcyF1g_toSX7sr8";

const MENU = {
    item1: { name: "Spicy Spaghetti + Beef + Egg - ₦1,500", price: 1500 },
    item2: { name: "Spicy Spaghetti + Peppered stir-Fry Chicken(meduim) + Egg - ₦2,000", price: 2000 },
    item3: { name: "Spicy Spaghetti + Peppered stir-Fry Chicken(Big) + Egg - ₦2,500", price: 2500 },
    item4: { name: "Spicy Spaghetti + Fish + Egg - ₦2,000", price: 2000 },
    item5: { name: "Spicy Spaghetti + Turkey + Egg - ₦3,000", price: 3000 },
    item6: { name: "Prawn Stir-fry Spaghetti - ₦3,000", price: 3000 },
    item7: { name: "Jollof Spaghetti + Plantain - ₦1,800", price: 1800 },
    item8: { name: "Family Pack (serves 4) - ₦7,500", price: 7500 }
};
const DELIVERY_FEE = { ibafo: 0, Mowe: 500 };
const MAX_QUANTITY = 20;
const CURRENCY = "ngn";
const SESSION_MINUTES = 35;
const OPEN_HOUR = 6;
const CLOSE_HOUR = 16;
const ALLOWED_ORIGINS = ["https://spagogofoodapp.netlify.app", "https://dev--spagogofoodapp.netlify.app"];

export default async (req) => {
    if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
    }
    const requestOrigin = req.headers.get("origin");
    if (requestOrigin && !ALLOWED_ORIGINS.includes(requestOrigin)) {
        return json(403, { error: "Forbidden" });
    }
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!stripeKey || !supabaseKey) {
        console.error("stripe-checkout: missing environment variable(s):",
            [!stripeKey && "STRIPE_SECRET_KEY", !supabaseKey && "SUPABASE_SECRET_KEY"].filter(Boolean).join(", "));
        return json(500, { error: "Card payment is not set up on the server yet" });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json(400, { error: "Invalid JSON body" });
    }
    const order = validate(body);
    if (order.error) {
        return json(400, { error: order.error });
    }

    let userId = null;
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
        const user = await getUser(authHeader.slice(7));
        if (!user) {
            return json(401, { error: "Your login has expired. Please log in again, or log out to order as a guest." });
        }
        userId = user.id;
        if (!order.email) order.email = user.email || "";
    }
    if (!order.email) {
        return json(400, { error: "An email address is needed for your payment receipt" });
    }

    const deliveryFee = DELIVERY_FEE[order.zone];
    const amount = (order.item.price * order.quantity + deliveryFee) * 100;
    const scheduledFor = scheduleFor(new Date());

    const inserted = await supabaseRest(supabaseKey, "POST", "/rest/v1/orders?select=id", {
        customer_name: order.name,
        phone: order.phone,
        address: order.address,
        zone: order.zone,
        item: order.item.name,
        quantity: order.quantity,
        user_id: userId,
        amount: amount,
        payment_provider: "stripe",
        scheduled_for: scheduledFor.toISOString()
    }, "return=representation");
    if (!inserted.ok || !inserted.data || !inserted.data[0] || inserted.data[0].id == null) {
        console.error("stripe-checkout: could not insert order:", inserted.status, inserted.text);
        return json(502, { error: "We couldn't save your order" });
    }
    const orderId = inserted.data[0].id;

    const origin = new URL(req.url).origin;
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("submit_type", "pay");
    params.append("client_reference_id", String(orderId));
    params.append("customer_email", order.email);
    params.append("success_url", origin + "/?session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", origin + "/");
    params.append("expires_at", String(Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60));
    params.append("metadata[order_id]", String(orderId));
    params.append("payment_intent_data[description]", "Spagogo order #" + orderId);
    params.append("line_items[0][quantity]", String(order.quantity));
    params.append("line_items[0][price_data][currency]", CURRENCY);
    params.append("line_items[0][price_data][unit_amount]", String(order.item.price * 100));
    params.append("line_items[0][price_data][product_data][name]", order.item.name.replace(/\s*-\s*₦.*$/, ""));
    if (deliveryFee > 0) {
        params.append("line_items[1][quantity]", "1");
        params.append("line_items[1][price_data][currency]", CURRENCY);
        params.append("line_items[1][price_data][unit_amount]", String(deliveryFee * 100));
        params.append("line_items[1][price_data][product_data][name]", "Delivery to " + order.zone);
    }

    let session = null;
    let failure = "";
    try {
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + stripeKey,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params.toString()
        });
        const data = await res.json();
        if (res.ok) {
            session = data;
        } else {
            failure = "HTTP " + res.status + " " + (data && data.error ? data.error.type + ": " + data.error.message : "");
        }
    } catch (err) {
        failure = String(err);
    }
    if (!session || typeof session.id !== "string" || typeof session.url !== "string") {
        console.error("stripe-checkout: Stripe session failed for order", orderId, "-", failure || "no id/url in response");
        await supabaseRest(supabaseKey, "PATCH", "/rest/v1/orders?id=eq." + orderId, { status: "error" }, "return=minimal");
        return json(502, { error: "We couldn't start the card payment" });
    }
    if (session.amount_total !== amount || session.currency !== CURRENCY) {
        console.error("stripe-checkout: MISMATCH on order", orderId, "- session", session.amount_total, session.currency,
            "expected", amount, CURRENCY);
        await supabaseRest(supabaseKey, "PATCH", "/rest/v1/orders?id=eq." + orderId, { status: "error" }, "return=minimal");
        return json(502, { error: "We couldn't start the card payment" });
    }

    const saved = await supabaseRest(supabaseKey, "PATCH", "/rest/v1/orders?id=eq." + orderId,
        { stripe_session_id: session.id }, "return=minimal");
    if (!saved.ok) {
        console.error("stripe-checkout: could not save session id for order", orderId, saved.status, saved.text);
        await supabaseRest(supabaseKey, "PATCH", "/rest/v1/orders?id=eq." + orderId, { status: "error" }, "return=minimal");
        return json(502, { error: "We couldn't start the card payment" });
    }

    console.log("stripe-checkout: order", orderId, "->", session.id, "for", amount, "kobo");
    return json(200, { url: session.url, reference: session.id, amount: amount, orderId: orderId, scheduledFor: scheduledFor.toISOString() });
};

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status: status,
        headers: { "Content-Type": "application/json" }
    });
}

function validate(b) {
    if (!b || typeof b !== "object") return { error: "Missing order details" };
    const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const name = text(b.name, 80);
    const phone = typeof b.phone === "string" ? b.phone.trim() : "";
    const email = text(b.email, 254);
    const address = text(b.address, 200);
    const zone = typeof b.zone === "string" ? b.zone : "";
    const itemKey = typeof b.item === "string" ? b.item : "";
    const quantity = Number(b.quantity);

    if (!name || !phone || !address) return { error: "Name, phone number and address are required" };
    if (!/^[0-9]{10,11}$/.test(phone)) return { error: "Phone number must be 10-11 digits" };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right" };
    if (!Object.hasOwn(DELIVERY_FEE, zone)) return { error: "Unknown delivery zone" };
    if (!Object.hasOwn(MENU, itemKey)) return { error: "Unknown menu item" };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        return { error: "Quantity must be between 1 and " + MAX_QUANTITY };
    }
    return { name, phone, email, address, zone, item: MENU[itemKey], quantity };
}

function scheduleFor(now) {
    const lagos = new Date(now.getTime() + 60 * 60 * 1000);
    const year = lagos.getUTCFullYear();
    const month = lagos.getUTCMonth();
    let day = lagos.getUTCDate();
    const weekday = lagos.getUTCDay() >= 1 && lagos.getUTCDay() <= 5;
    const hour = lagos.getUTCHours();
    if (weekday && hour >= OPEN_HOUR && hour < CLOSE_HOUR) return now;
    if (!weekday || hour >= CLOSE_HOUR) {
        do { day += 1; } while ([0, 6].includes(new Date(Date.UTC(year, month, day)).getUTCDay()));
    }
    return new Date(Date.UTC(year, month, day, OPEN_HOUR, 0, 0) - 60 * 60 * 1000);
}

async function getUser(token) {
    try {
        const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
            headers: { "apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": "Bearer " + token }
        });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id ? { id: user.id, email: user.email } : null;
    } catch {
        return null;
    }
}

async function supabaseRest(secretKey, method, path, body, prefer) {
    const res = await fetch(SUPABASE_URL + path, {
        method: method,
        headers: {
            "apikey": secretKey,
            "Authorization": "Bearer " + secretKey,
            "Content-Type": "application/json",
            "Prefer": prefer,
            "User-Agent": "spagogo-netlify-function"
        },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text for the log */ }
    return { ok: res.ok, status: res.status, data: data, text: text };
}