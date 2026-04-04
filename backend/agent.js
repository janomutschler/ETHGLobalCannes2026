import { openai } from "./openaiClient.js";
import { savePreference, getPreferences, checkPreference } from "./memory.js";
import { logOnChain, sendCoins } from "./chain.js";

const tools = [
  {
    type: "function",
    function: {
      name: "save_preference",
      description: "Save a user preference, fact, or something they want remembered. Examples: 'I like pizza', 'My name is Diego', 'I work as an engineer'.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          preference: { type: "string", description: "What the user wants to remember" }
        },
        required: ["userId", "preference"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_preferences",
      description: "Retrieve all stored preferences and facts for a user.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_preference",
      description: "Check if a user likes, dislikes, or has a specific preference for something.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          item: { type: "string", description: "What to check for (e.g., 'pizza', 'coffee')" }
        },
        required: ["userId", "item"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_fact",
      description: "Query a specific fact about the user like their name, profession, location, etc.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          factKey: { type: "string", description: "What to query (e.g., 'name', 'profession', 'location', 'age')" }
        },
        required: ["userId", "factKey"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "log_on_chain",
      description: "Log an action string to the blockchain when the user asks for an on-chain action demo.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_coins",
      description: "Send 0G testnet tokens to a specified address. This performs a real transaction on the 0G testnet blockchain.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address on 0G testnet" },
          amount: { type: "string", description: "Amount in 0G tokens (e.g., '0.01')" }
        },
        required: ["to", "amount"]
      }
    }
  }
];

async function runTool(name, args) {
  switch (name) {
    case "save_preference":
      return await savePreference(args.userId, args.preference);
    case "get_preferences":
      return await getPreferences(args.userId);
    case "check_preference":
      return await checkPreference(args.userId, args.item);
    case "query_fact": {
      const prefs = await getPreferences(args.userId);
      const value = extractFact(prefs, args.factKey);
      return {
        ok: true,
        factKey: args.factKey,
        value: value || null,
        allPreferences: prefs
      };
    }
    case "log_on_chain":
      return await logOnChain(args.action);
    case "send_coins":
      return await sendCoins(args.to, args.amount);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function extractFact(preferences, key) {
  const patterns = [
    new RegExp(`\\bmy ${key} is ([a-z0-9 ]+)`, 'i'),
    new RegExp(`\\b${key} is ([a-z0-9 ]+)`, 'i'),
    new RegExp(`\\bi am ([a-z0-9 ]+)`, 'i'),
    new RegExp(`\\bi'm ([a-z0-9 ]+)`, 'i')
  ];

  for (const pref of preferences) {
    for (const pattern of patterns) {
      const match = pref.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

export async function handleMessage(userId, input) {
  try {
    console.log(`[handleMessage] User: ${userId}, Input: ${input}`);
    
    const messages = [
      {
        role: "system",
        content: [
          "You are an AI agent on 0G testnet that can perform real transactions and remember user preferences.",
          `IMPORTANT: Always use userId: "${userId}" when calling tools.`,
          "You MUST use tools to:",
          "1. Save any preferences, facts, or information the user wants remembered (use save_preference)",
          "2. Retrieve all stored information (use get_preferences)",
          "3. Check specific preferences (use check_preference)",
          "4. Query specific facts about the user (use query_fact)",
          "5. Perform blockchain transactions (use send_coins, log_on_chain)",
          "Never guess or make up facts about the user - always use tools to retrieve stored information.",
          "When a user tells you something to remember, acknowledge what you saved.",
          "When a user asks about their preferences or facts, use the appropriate tool first, then answer based on the results.",
          "Keep responses natural and conversational."
        ].join(" ")
      },
      {
        role: "user",
        content: input
      }
    ];

    console.log("[handleMessage] Calling OpenAI first request...");
    const first = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      tools,
      tool_choice: "auto"
    });

    console.log("[handleMessage] First response received:", JSON.stringify(first.choices[0].message, null, 2));
    const firstMessage = first.choices[0].message;

    if (!firstMessage.tool_calls || firstMessage.tool_calls.length === 0) {
      console.log("[handleMessage] No tool calls, returning content");
      return firstMessage.content ?? "No response.";
    }

    console.log(`[handleMessage] Found ${firstMessage.tool_calls.length} tool calls`);
    messages.push(firstMessage);

    for (const toolCall of firstMessage.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      console.log(`[handleMessage] Running tool: ${name} with args:`, args);
      const result = await runTool(name, args);
      console.log(`[handleMessage] Tool result:`, result);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }

    console.log("[handleMessage] Calling OpenAI second request...");
    const second = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages
    });

    console.log("[handleMessage] Second response received:", second.choices[0].message.content);
    return second.choices[0].message.content ?? "No final response.";
  } catch (error) {
    console.error("[handleMessage] ERROR:", error);
    throw error;
  }
}