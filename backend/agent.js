import { createChatCompletion } from "./llm-unified.js";
import * as memEnhanced from "./memory-enhanced.js";
import { savePreference, getPreferences, checkPreference, deletePreference, clearMemory, viewAllFacts } from "./memory.js";
import { logOnChain, sendCoins, readLastAction } from "./chain.js";
import { mergeStorageTools, executeStorageTool, STORAGE_TOOL_NAMES } from "./storage-0g.js";
import { buildSystemPrompt } from "./personality.js";

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
  },
  {
    type: "function",
    function: {
      name: "read_last_action",
      description: "Read the last action that was logged to the blockchain. This queries the AgentActions contract to retrieve the permanently stored message.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_preference",
      description: "Delete preferences containing a specific search term. Example: 'delete pizza' removes all preferences mentioning pizza.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          searchTerm: { type: "string", description: "What to search for and delete" }
        },
        required: ["userId", "searchTerm"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clear_memory",
      description: "Clear all preferences and memories for the user. Use with caution!",
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
      name: "view_all_facts",
      description: "View all organized facts and preferences - organized into likes, facts (name, profession, etc), and other preferences.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" }
        },
        required: ["userId"]
      }
    }
  }
];

async function runTool(name, args, userId) {
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
      // Create meaningful on-chain record
      const timestamp = new Date().toISOString();
      const meaningfulAction = `Agent Action [${timestamp}]: ${args.action} | User: ${userId}`;
      return await logOnChain(meaningfulAction);
    case "send_coins":
      return await sendCoins(args.to, args.amount);
    case "read_last_action":
      return await readLastAction();
    case "delete_preference":
      return await deletePreference(args.userId, args.searchTerm);
    case "clear_memory":
      return await clearMemory(args.userId);
    case "view_all_facts":
      return await viewAllFacts(args.userId);
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
    console.log(`[agent] User: ${userId}, Input: ${input}`);
    
    // Record this turn in enhanced memory
    await memEnhanced.recordTurn(userId, "user", input);

    // Get memory context
    const memoryContext = await memEnhanced.getMemorySummary(userId);
    
    // Build system prompt with personality
    const systemPrompt = await buildSystemPrompt(
      `You are an AI agent on 0G testnet. Remember: ${memoryContext.split('\n')[0]}`
    );

    // Build tools - merge all available tools
    let allTools = [...tools];
    allTools = mergeStorageTools(allTools);

    const messages = [
      {
        role: "system",
        content: `${systemPrompt}\n\nUser context:\n${memoryContext}`
      },
      {
        role: "user",
        content: input
      }
    ];

    console.log("[agent] Calling LLM with unified interface...");
    const first = await createChatCompletion(messages, allTools);

    const firstMessage = first.choices[0].message;
    console.log("[agent] LLM response:", JSON.stringify(firstMessage, null, 2));

    // Handle case with no tool calls
    if (!firstMessage.tool_calls || firstMessage.tool_calls.length === 0) {
      const contentMsg = firstMessage.content ?? "No response.";
      await memEnhanced.recordTurn(userId, "assistant", contentMsg);
      return contentMsg;
    }

    messages.push(firstMessage);
    let txResults = [];

    // Execute all tool calls
    for (const toolCall of firstMessage.tool_calls) {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      console.log(`[agent] Running tool: ${name}`, args);

      let result;

      // Route to storage tools
      if (STORAGE_TOOL_NAMES.has(name)) {
        result = await executeStorageTool(name, args);
      } else {
        // Route to memory/chain/action tools
        result = await runTool(name, args, userId);
      }

      console.log(`[agent] Tool result:`, result);

      // Capture tx results for UI display
      if ((name === "log_on_chain" || name === "send_coins") && result.txHash) {
        txResults.push({
          action: name === "log_on_chain" ? "logged on chain" : "sent coins",
          txHash: result.txHash
        });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }

    // Get final response from LLM
    console.log("[agent] Calling LLM with tool results...");
    const second = await createChatCompletion(messages);
    const finalContent = second.choices[0].message.content ?? "No final response.";
    
    console.log("[agent] Final response:", finalContent);
    await memEnhanced.recordTurn(userId, "assistant", finalContent);

    // Append tx hashes if any
    let response = finalContent;
    if (txResults.length > 0) {
      response += "\n\n[BLOCKCHAIN_ACTIONS]\n" + 
        txResults.map(tx => `${tx.action}: ${tx.txHash}`).join("\n");
    }

    return response;
  } catch (error) {
    console.error("[agent] ERROR:", error);
    throw error;
  }
}