const MODEL = "gemini-3.5-flash-lite";
const ITEMS = ["item1", "item2", "item3", "item4", "item5", "item6", "item7", "item8"];

const SYSTEM_CONTEXT = `You are the FAQ assistant for Fatima Spagogo, a local food delivery service serving Ibafo and Mowe in Ogun State, Nigeria.
 
FACTS YOU MUST STICK TO — do not invent anything beyond this list:
- Menu (the code in front of each dish is its order-form code):
  • item1: Spicy Spaghetti + Beef + Egg — ₦1,500
  • item2: Spicy Spaghetti + Peppered Stir-Fry Chicken (Medium) + Egg — ₦2,000
  • item3: Spicy Spaghetti + Peppered Stir-Fry Chicken (Big) + Egg — ₦2,500
  • item4: Spicy Spaghetti + Fish + Egg — ₦2,000 (sample dish)
  • item5: Spicy Spaghetti + Turkey + Egg — ₦3,000 (sample dish)
  • item6: Prawn Stir-fry Spaghetti — ₦3,000 (sample dish)
  • item7: Jollof Spaghetti + Plantain — ₦1,800 (sample dish)
  • item8: Family Pack (serves 4) — ₦7,500 (sample dish)
- Dishes marked "sample dish" are demo items added to show a fuller menu on this demo site. They can be ordered here like any other dish, but if someone asks, say plainly that they are sample dishes.
- Delivery zones: Ibafo and Mowe only. Delivery within the Ibafo axis is free. Delivery to Mowe starts at ₦500 (the ₦500 minimum is added at checkout; any extra for longer distances is agreed on WhatsApp after payment). No delivery anywhere else.
- The kitchen cooks and delivers Monday–Friday, 6am–4pm. Orders can be placed and paid for at any time: an order placed outside these hours is scheduled for the next opening time (a weekday after 4pm → the next morning from 6am; Friday after 4pm, Saturday or Sunday → Monday from 6am). The order page shows the exact scheduled time before payment, and the confirmation repeats it.
- The site has a quick order form above this chat. When someone wants to order, their selection gets pre-filled into that form. They press "Place Order" and pay securely on the site through Paystack (card, bank transfer or USSD) or Stripe (card). After payment they get a confirmation and a button that sends the paid order to the kitchen on WhatsApp.
- Payment is required upfront, on the site. An order is only confirmed once Paystack or Stripe confirms the payment. The site does not take cash on delivery.
- If a delivery does not happen, a refund is issued along with the reason.
 
RULES:
- If asked about anything not covered above (other delivery zones, bulk/event orders, exact Mowe distance charges, etc.), say you're not sure and tell them to confirm directly on WhatsApp.
- Keep every answer to 2–3 sentences. This is a quick FAQ chat, not a conversation.
- When asked about hours, days, or availability, always state the exact days and time window from the FACTS section above, word for word. Never answer vaguely.
- Never make up a price, menu item, or delivery zone that isn't listed above.

ORDER INTENT:
- Set orderIntent to true ONLY when the person is clearly trying to place an order right now (e.g. "I want the beef one", "let's order 2 of the big chicken", "can I get one spaghetti and egg"). Questions about the menu, prices, or hours are NOT order intent.
- If orderIntent is true, map what they asked for to the order-form code from the menu list: item1 (Beef), item2 (Medium Chicken), item3 (Big Chicken), item4 (Fish), item5 (Turkey), item6 (Prawn), item7 (Jollof + Plantain), item8 (Family Pack). If it's ambiguous which item, use "unknown" and ask them to clarify in the reply text instead of guessing.
- If orderIntent is true and no quantity was stated, default quantity to 1.
- If orderIntent is false, item must be "unknown" and quantity must be 1.
- When orderIntent is true and item is known, mention in the reply that you've filled in the order form for them and they just need to check the details, press Place Order and pay.`;

export default async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let userMessage;
  try {
    const body = await req.json();
    userMessage = body && body.message;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (typeof userMessage !== "string" || userMessage.trim().length === 0) {
    return json(400, { error: "Missing 'message'" });
  }
  if (userMessage.length > 500) {
    return json(400, { error: "Message too long" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set in environment");
    return json(500, { error: "Server misconfigured" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_CONTEXT }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.4,
            thinkingConfig: { thinkingLevel: "low" },
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                reply: { type: "string", description: "2-3 sentence chat reply shown to the user." },
                orderIntent: { type: "boolean", description: "True only if the user is trying to place an order right now." },
                item: { type: "string", enum: ["item1", "item2", "item3", "item4", "item5", "item6", "item7", "item8", "unknown"], description: "item1=Beef, item2=Medium Chicken, item3=Big Chicken, item4=Fish, item5=Turkey, item6=Prawn, item7=Jollof + Plantain, item8=Family Pack. unknown if orderIntent is false or unclear." },
                quantity: { type: "integer", description: "Quantity requested. 1 if unclear or orderIntent is false." }
              },
              required: ["reply", "orderIntent", "item", "quantity"]
            }
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      if (response.status === 429) {
        return json(200, { reply: "The assistant has reached its free daily limit. Please message us on WhatsApp instead.", orderIntent: false, item: "unknown", quantity: 1 });
      }
      return json(502, { error: "Upstream API error" });
    }

    const data = await response.json();
    console.log("finishReason:", data?.candidates?.[0]?.finishReason);
    console.log("usageMetadata:", JSON.stringify(data?.usageMetadata));
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const rawText = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");

    let reply = "Sorry, I couldn't generate a response. Please try WhatsApp instead.";
    let orderIntent = false;
    let item = "unknown";
    let quantity = 1;

    if (rawText) {
      try {
        const parsed = JSON.parse(rawText);
        reply = parsed.reply || reply;
        orderIntent = parsed.orderIntent === true;
        item = ITEMS.includes(parsed.item) ? parsed.item : "unknown";
        quantity = Number.isInteger(parsed.quantity) && parsed.quantity > 0 ? parsed.quantity : 1;
      } catch (parseErr) {
        console.error("Failed to parse structured Gemini response:", parseErr, rawText);
        reply = rawText;
      }
    }

    return json(200, { reply, orderIntent, item, quantity });
  } catch (err) {
    console.error("Function error:", err);
    return json(500, { error: "Internal error" });
  }
};

export const config = {
  path: "/api/chat",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}