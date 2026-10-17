(function () {
        var CHAT_ENDPOINT = "/api/chat";
    var ITEMS = ["item1", "item2", "item3", "item4", "item5", "item6", "item7", "item8"];

    var toggleBtn = document.getElementById("chatToggleBtn");
    var closeBtn = document.getElementById("chatCloseBtn");
    var chatWindow = document.getElementById("chatWindow");
    var messagesEl = document.getElementById("chatMessages");
    var inputEl = document.getElementById("chatInput");
    var sendBtn = document.getElementById("chatSendBtn");
    if (!toggleBtn || !closeBtn || !chatWindow || !messagesEl || !inputEl || !sendBtn) return;

    toggleBtn.addEventListener("click", function () {
        chatWindow.classList.toggle("hidden");
    });
    closeBtn.addEventListener("click", function () {
        chatWindow.classList.add("hidden");
    });

    function addMessage(text, sender) {
        var div = document.createElement("div");
        div.className = "chatMsg " + sender;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
        var div = document.createElement("div");
        div.className = "chatMsg bot typing";
        div.id = "typingIndicator";
        div.innerHTML = "<span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span>";
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
        var el = document.getElementById("typingIndicator");
        if (el) el.remove();
    }

    function fillOrderForm(item, quantity) {
        var form = document.getElementById("orderForm");
        if (!form) return false;
        if (ITEMS.indexOf(item) !== -1) {
            var radio = document.querySelector('input[name="menuItem"][value="' + item + '"]');
            if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }
        if (Number.isInteger(quantity) && quantity > 0) {
            var qty = document.getElementById("quantity");
            if (qty) {
                qty.value = quantity;
                qty.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        form.classList.add("formHighlight");
        setTimeout(function () {
            form.classList.remove("formHighlight");
        }, 3000);
        return true;
    }

    function handleOrderHandoff(item, quantity) {
        if (fillOrderForm(item, quantity)) return;
        var qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
        addMessage("Taking you to the order form now.", "bot");
        setTimeout(function () {
            location.assign("/?item=" + encodeURIComponent(item) + "&qty=" + qty + "#orderForm");
        }, 1500);
    }

    function applyQueryHandoff() {
        var params = new URLSearchParams(location.search);
        var item = params.get("item");
        if (!item || ITEMS.indexOf(item) === -1 || !document.getElementById("orderForm")) return;
        var qty = parseInt(params.get("qty"), 10);
        fillOrderForm(item, qty > 0 ? qty : 1);
        history.replaceState(null, "", location.pathname + location.hash);
    }

    function sendMessage() {
        var text = inputEl.value.trim();
        if (!text) return;
        addMessage(text, "user");
        inputEl.value = "";
        sendBtn.disabled = true;
        showTyping();

        fetch(CHAT_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text })
        })
                .then(function (res) {
            if (res.status === 429) {
                return { reply: "You're sending messages too quickly. Please wait a minute and try again." };
            }
            return res.json();
        })
        .then(function (data) {
            hideTyping();
            sendBtn.disabled = false;
            addMessage(data.reply || "Sorry, something went wrong. Please try WhatsApp instead.", "bot");
            if (data.orderIntent && data.item && data.item !== "unknown") {
                handleOrderHandoff(data.item, data.quantity);
            }
        })
        .catch(function () {
            hideTyping();
            sendBtn.disabled = false;
            addMessage("Sorry, I couldn't reach the assistant. Please try WhatsApp instead.", "bot");
        });
    }

    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            sendMessage();
        }
    });

    applyQueryHandoff();
})();
