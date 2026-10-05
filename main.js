// Price Calculation Logic
function updateTotal() {
    var prices = { "item1": 1500, "item2": 2000, "item3": 2500 };
    var item = document.querySelector('input[name="menuItem"]:checked').value;
    var quantity = parseInt(document.getElementById("quantity").value, 10) || 1;
    var total = prices[item] * quantity;
    document.getElementById("displayTotal").textContent = "₦" + total.toLocaleString("en-NG");
}
document.querySelectorAll('input[name="menuItem"]').forEach(radio => radio.addEventListener('change', updateTotal));
document.getElementById("quantity").addEventListener('input', updateTotal);

document.getElementById("submitOrder").addEventListener("click", async function() {
    var submitBtn = this;
    var errDiv = document.getElementById("formError");
    if (errDiv) {
        errDiv.style.display = "none";
        errDiv.textContent = "";
    }
    
    function showError(msg) {
        if (errDiv) {
            errDiv.textContent = msg;
            errDiv.style.display = "block";
        } else {
            alert(msg);
        }
    }

    var name = document.getElementById("customerName").value.trim();
    var phone = document.getElementById("customerPhone").value.trim();
    var email = document.getElementById("customerEmail").value.trim();
    var address = document.getElementById("deliveryAddress").value.trim();
    var zone = document.getElementById("deliveryZone").value;
    var item = document.querySelector('input[name="menuItem"]:checked').value;
    var quantity = document.getElementById("quantity").value;
    if (name === "" || phone === "" || address === "") {
        showError("Please fill in your name, phone number, and address before placing order.");
        return;
    }
    var phonePattern = /^[0-9]{10,11}$/;
    if (!phonePattern.test(phone)) {
        showError("Please enter a valid phone number (10-11 digits, no letters or symbols).");
        return;
    }
    // Logged in? Send the access token so the server can attach the order to
    // the account (and use the account email if the email box is empty).
    var sessionRes = await supabaseClient.auth.getSession();
    var session = sessionRes.data.session;
    if (email === "" && !session) {
        showError("Please enter your email address so we can send your payment receipt.");
        return;
    }
    var headers = { "Content-Type": "application/json" };
    if (session) headers["Authorization"] = "Bearer " + session.access_token;
    submitBtn.disabled = true;
    submitBtn.textContent = "Starting payment\u2026";
    var result = null;
    try {
        // The server prices the order (menu + delivery fee), saves it as
        // 'pending' and asks Paystack for a checkout link.
        var res = await fetch("/.netlify/functions/pay", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                name: name, phone: phone, email: email, address: address,
                zone: zone, item: item, quantity: quantity
            })
        });
        result = await res.json();
        if (!res.ok) throw new Error(result.error || "HTTP " + res.status);
    } catch (err) {
        console.error("Error starting payment:", err);
        submitBtn.disabled = false;
        submitBtn.textContent = "Place Order";
        showError("Sorry, we couldn't start your payment. " + (err.message || "") + " Please try again or message us on WhatsApp.");
        return;
    }
    // Keep the delivery details on this device for the WhatsApp message after
    // payment. The server never sends them back (the reference ends up in a URL).
    try {
        localStorage.setItem("spagogo-order-" + result.reference,
            JSON.stringify({ name: name, phone: phone, address: address, expires: Date.now() + 30*60*1000 }));
    } catch (e) { /* storage blocked: the WhatsApp message asks for details instead */ }
    // Off to Paystack. After paying, Paystack sends the customer back here.
    // The order is confirmed by Paystack's webhook (not by this page), and the
    // WhatsApp message to the kitchen is only sent once that confirmation lands.
    window.location.assign(result.url);
});
// If the customer presses Back from the Paystack page, the browser may restore
// this page from memory with the button still disabled. Reset it.
window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    var btn = document.getElementById("submitOrder");
    btn.disabled = false;
    btn.textContent = "Place Order";
});

// ---- Back from Paystack --------------------------------------------------
// Paystack returns the customer to /?trxref=...&reference=... . We ask our
// server whether that order is really paid (it checks with Paystack and the
// webhook's result) and only then show the WhatsApp button. Nothing here
// trusts the URL: a made-up reference just gets "not paid".
(function () {
    var params = new URLSearchParams(window.location.search);
    var reference = params.get("reference") || params.get("trxref");
    if (!reference) return;
    var panel = document.getElementById("paymentResult");
    var titleEl = document.getElementById("paymentTitle");
    var textEl = document.getElementById("paymentText");
    var hintEl = document.getElementById("paymentHint");
    var waLink = document.getElementById("whatsappLink");
    var closeBtn = document.getElementById("paymentCloseBtn");
    var attempts = 0;

    function show(state, title, text, hint) {
        panel.className = "paymentResult pay-" + state;
        titleEl.textContent = title;
        textEl.textContent = text;
        hintEl.textContent = hint || "";
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function naira(kobo) { return "\u20a6" + (kobo / 100).toLocaleString("en-NG"); }
    function savedDetails() {
        try { 
            var d = JSON.parse(localStorage.getItem("spagogo-order-" + reference));
            if (d && d.expires && Date.now() > d.expires) {
                localStorage.removeItem("spagogo-order-" + reference);
                return null;
            }
            return d || null;
        }
        catch (e) { return null; }
    }
    function whatsappMessage(order) {
        var d = savedDetails();
        var lines = [
            "*PAID ORDER*",
            "Order #" + order.id,
            "Item: " + order.item,
            "Quantity: " + order.quantity,
            "Zone: " + order.zone,
            "Total paid: " + naira(order.amount),
            "Paystack ref: " + reference
        ];
        if (d && d.name) {
            lines.push("Name: " + d.name, "Phone: " + d.phone, "Address: " + d.address);
        } else {
            lines.push("Name / phone / address: (typing them below)");
        }
        return "https://wa.me/2347055076189?text=" + encodeURIComponent(lines.join("\n"));
    }
    function check() {
        attempts += 1;
        fetch("/.netlify/functions/verify-payment?reference=" + encodeURIComponent(reference))
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
            var d = r.data || {};
            if (!r.ok) throw new Error(d.error || "verify failed");
            if (d.status === "paid") {
                show("paid", "Payment received \u2705",
                    "Order #" + d.order.id + " \u2014 " + d.order.quantity + " \u00d7 " + d.order.item + " \u2014 " + naira(d.order.amount) + " paid.",
                    "Last step: tap the button so the kitchen gets your order and delivery details on WhatsApp.");
                waLink.href = whatsappMessage(d.order);
                waLink.classList.remove("hidden");
                if (!savedDetails()) {
                    hintEl.textContent = "Tap the button, then type your name, phone number and address into the chat (we couldn\u2019t recover them on this device).";
                }
            } else if (d.status === "failed") {
                show("failed", "Payment didn\u2019t go through \u2716",
                    "Your bank declined the payment" + (d.reason ? " (" + d.reason + ")" : "") + ". Nothing was charged and the kitchen has not been notified.",
                    "You can place the order again below with another card.");
            } else if (d.status === "error") {
                show("error", "We need to check this payment",
                    "The amount Paystack reported doesn\u2019t match order #" + d.order.id + ". Please don\u2019t pay again.",
                    "Message us on WhatsApp with reference " + reference + " and we\u2019ll sort it out.");
            } else if (attempts < 4) {
                show("pending", "Confirming your payment\u2026", "This usually takes a few seconds.", "");
                setTimeout(check, 2500);
            } else {
                show("pending", "Payment not confirmed yet",
                    "We haven\u2019t received a payment for order #" + d.order.id + ". If you did pay, wait a minute and refresh this page.",
                    "Otherwise you can place the order again below.");
            }
        })
        .catch(function (err) {
            console.error("verify-payment:", err);
            show("error", "Couldn\u2019t check the payment",
                "Please refresh this page in a moment. If you paid, your money is safe: the order is confirmed automatically on our side.",
                "Reference: " + reference);
        });
    }
    closeBtn.addEventListener("click", function () {
        panel.classList.add("hidden");
        try { localStorage.removeItem("spagogo-order-" + reference); } catch (e) { /* ignore */ }
        history.replaceState(null, "", window.location.pathname);
    });
    // Tidy the address bar, but keep the reference for retries/refresh via the closure.
    if (params.has("trxref") || params.has("reference")) {
        history.replaceState(null, "", window.location.pathname + "?reference=" + encodeURIComponent(reference));
    }
    panel.classList.remove("hidden");
    show("pending", "Confirming your payment\u2026", "This usually takes a few seconds.", "");
    check();
})();
