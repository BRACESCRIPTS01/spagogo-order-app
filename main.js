function updateTotal() {
    var prices = { "item1": 1500, "item2": 2000, "item3": 2500, "item4": 2000, "item5": 3000, "item6": 3000, "item7": 1800, "item8": 7500 };
    var fees = { "ibafo": 0, "Mowe": 500 };
    var radio = document.querySelector('input[name="menuItem"]:checked');
    var quantity = parseInt(document.getElementById("quantity").value, 10) || 1;
    var zone = document.getElementById("deliveryZone").value;
    var food = prices[radio.value] * quantity;
    var fee = fees[zone] || 0;
    var total = food + fee;
    document.getElementById("summaryDish").textContent = radio.dataset.name + " \u00d7 " + quantity;
    document.getElementById("summaryFood").textContent = "\u20a6" + food.toLocaleString("en-NG");
    document.getElementById("summaryFee").textContent = fee > 0 ? "\u20a6" + fee.toLocaleString("en-NG") : "Free";
    document.getElementById("displayTotal").textContent = "\u20a6" + total.toLocaleString("en-NG");
}
document.querySelectorAll('input[name="menuItem"]').forEach(function (radio) { radio.addEventListener("change", updateTotal); });
document.getElementById("quantity").addEventListener("input", updateTotal);
document.getElementById("deliveryZone").addEventListener("change", updateTotal);
document.querySelectorAll(".qtyBtn").forEach(function (btn) {
    btn.addEventListener("click", function () {
        var input = document.getElementById("quantity");
        var next = (parseInt(input.value, 10) || 1) + Number(btn.dataset.step);
        if (next < 1) next = 1;
        if (next > 20) next = 20;
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
});
updateTotal();

function scheduleFor(now) {
    var lagos = new Date(now.getTime() + 60 * 60 * 1000);
    var year = lagos.getUTCFullYear();
    var month = lagos.getUTCMonth();
    var day = lagos.getUTCDate();
    var weekday = lagos.getUTCDay() >= 1 && lagos.getUTCDay() <= 5;
    var hour = lagos.getUTCHours();
    if (weekday && hour >= 6 && hour < 16) return null;
    if (!weekday || hour >= 16) {
        do { day += 1; } while ([0, 6].indexOf(new Date(Date.UTC(year, month, day)).getUTCDay()) !== -1);
    }
    return new Date(Date.UTC(year, month, day, 6, 0, 0) - 60 * 60 * 1000);
}
function formatSchedule(date) {
    return date.toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}
function isScheduled(order) {
    if (!order || !order.scheduled_for || !order.created_at) return false;
    return new Date(order.scheduled_for).getTime() - new Date(order.created_at).getTime() > 5 * 60 * 1000;
}
function updateScheduleNote() {
    var note = document.getElementById("scheduleNote");
    if (!note) return;
    var next = scheduleFor(new Date());
    if (next === null) {
        note.classList.add("hidden");
        note.textContent = "";
        return;
    }
    note.textContent = "The kitchen is closed right now (Mon\u2013Fri, 6am\u20134pm). You can still pay: this order will be prepared on " + formatSchedule(next) + ".";
    note.classList.remove("hidden");
}
updateScheduleNote();
setInterval(updateScheduleNote, 60 * 1000);

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
    var payMethod = document.querySelector('input[name="payMethod"]:checked');
    var provider = payMethod && payMethod.value === "stripe" ? "stripe" : "paystack";
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
        // 'pending' and asks the chosen provider for a checkout link.
        var endpoint = provider === "stripe" ? "/.netlify/functions/stripe-checkout" : "/.netlify/functions/pay";
        var res = await fetch(endpoint, {
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
    // Off to the payment page (Paystack or Stripe). After paying, the customer is
    // sent back here. The order is confirmed by the provider's webhook (not by this
    // page), and the WhatsApp message to the kitchen is only sent once that lands.
    window.location.assign(result.url);
});
// If the customer presses Back from the payment page, the browser may restore
// this page from memory with the button still disabled. Reset it.
window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    var btn = document.getElementById("submitOrder");
    btn.disabled = false;
    btn.textContent = "Place Order";
});

// ---- Back from the payment page -------------------------------------------
// Paystack returns the customer to /?trxref=...&reference=... and Stripe to
// /?session_id=cs_... . We ask our server whether that order is really paid (it
// checks with the provider and the webhook's result) and only then show the
// WhatsApp button. Nothing here trusts the URL: a made-up id just gets "not paid".
(function () {
    var params = new URLSearchParams(window.location.search);
    var provider = params.has("session_id") ? "stripe" : "paystack";
    var providerName = provider === "stripe" ? "Stripe" : "Paystack";
    var reference = provider === "stripe" ? params.get("session_id") : (params.get("reference") || params.get("trxref"));
    if (!reference) return;
    var verifyUrl = provider === "stripe"
        ? "/.netlify/functions/verify-stripe?session_id=" + encodeURIComponent(reference)
        : "/.netlify/functions/verify-payment?reference=" + encodeURIComponent(reference);
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
            (provider === "stripe" ? "Stripe session: " : "Paystack ref: ") + reference
        ];
        if (isScheduled(order)) {
            lines.push("Scheduled for: " + formatSchedule(new Date(order.scheduled_for)));
        }
        if (d && d.name) {
            lines.push("Name: " + d.name, "Phone: " + d.phone, "Address: " + d.address);
        } else {
            lines.push("Name / phone / address: (typing them below)");
        }
        return "https://wa.me/2347055076189?text=" + encodeURIComponent(lines.join("\n"));
    }
    function check() {
        attempts += 1;
        fetch(verifyUrl)
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
            var d = r.data || {};
            if (!r.ok) throw new Error(d.error || "verify failed");
            if (d.status === "paid") {
                show("paid", "Payment received \u2705",
                    "Order #" + d.order.id + " \u2014 " + d.order.quantity + " \u00d7 " + d.order.item + " \u2014 " + naira(d.order.amount) + " paid." +
                        (isScheduled(d.order) ? " The kitchen is closed right now, so it is scheduled for " + formatSchedule(new Date(d.order.scheduled_for)) + "." : ""),
                    "Last step: tap the button so the kitchen gets your order and delivery details on WhatsApp.");
                waLink.href = whatsappMessage(d.order);
                waLink.classList.remove("hidden");
                if (!savedDetails()) {
                    hintEl.textContent = "Tap the button, then type your name, phone number and address into the chat (we couldn\u2019t recover them on this device).";
                }
            } else if (d.status === "failed") {
                show("failed", "Payment didn\u2019t go through \u2716",
                    "The payment didn\u2019t complete" + (d.reason ? " (" + d.reason + ")" : "") + ". Nothing was charged and the kitchen has not been notified.",
                    "You can place the order again below with another card.");
            } else if (d.status === "error") {
                show("error", "We need to check this payment",
                    "The amount " + providerName + " reported doesn\u2019t match order #" + d.order.id + ". Please don\u2019t pay again.",
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
            console.error("verify:", err);
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
    // Tidy the address bar, but keep the id for retries/refresh via the closure.
    history.replaceState(null, "", window.location.pathname + (provider === "stripe" ? "?session_id=" : "?reference=") + encodeURIComponent(reference));
    panel.classList.remove("hidden");
    show("pending", "Confirming your payment\u2026", "This usually takes a few seconds.", "");
    check();
})();