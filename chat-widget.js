(function () {
    var CHAT_ENDPOINT = "/.netlify/functions/chat";

    var toggleBtn = document.getElementById("chatToggleBtn");
    var closeBtn = document.getElementById("chatCloseBtn");
    var chatWindow = document.getElementById("chatWindow");
    var messagesEl = document.getElementById("chatMessages");
    var inputEl = document.getElementById("chatInput");
    var sendBtn = document.getElementById("chatSendBtn");

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

function handleOrderHandoff(item, quantity) {
    var form = document.getElementById("orderForm");
    if (!form) return;

    if (["item1", "item2", "item3"].indexOf(item) !== -1) {
        var radio = document.querySelector('input[name="menuItem"][value="' + item + '"]');
        if (radio) radio.checked = true;
    }
    if (Number.isInteger(quantity) && quantity > 0) {
        document.getElementById("quantity").value = quantity;
    }

    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.classList.add("formHighlight");
    setTimeout(function () {
        form.classList.remove("formHighlight");
    }, 3000);
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
    .then(function (res) { return res.json(); })
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
})();
