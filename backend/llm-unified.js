import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

/**
 * Determine which LLM to use based on environment variables
 * Priority: Gemini > OpenAI-compatible > default (OpenAI)
 */
export function createLlmContext() {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

  if (!hasGeminiKey && !hasOpenAiKey) {
    console.warn("[llm] No LLM API keys configured. Set OPENAI_API_KEY or GEMINI_API_KEY");
  }

  // Prefer Gemini if available
  if (hasGeminiKey) {
    console.log("[llm] Using Google Gemini");
    return { type: "gemini", initialized: true };
  }

  // Fall back to OpenAI
  if (hasOpenAiKey) {
    console.log("[llm] Using OpenAI-compatible API");
    return { type: "openai", initialized: true };
  }

  return { type: "openai", initialized: false };
}

/**
 * Create OpenAI client
 */
export function createOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  return new OpenAI({
    apiKey,
    ...(baseUrl && { baseURL: baseUrl })
  });
}

/**
 * Create Google Gemini client
 */
export function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }

  return new GoogleGenerativeAI(apiKey);
}

/**
 * Create a unified chat completion interface
 */
export async function createChatCompletion(messages, tools, model = null) {
  const llmContext = createLlmContext();

  if (llmContext.type === "gemini") {
    return await createGeminiChatCompletion(messages, tools, model);
  } else {
    return await createOpenAiChatCompletion(messages, tools, model);
  }
}

/**
 * OpenAI chat completion with tools
 */
async function createOpenAiChatCompletion(messages, tools, model) {
  const client = createOpenAiClient();
  const modelToUse = model || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  console.log(`[openai] Chat with model: ${modelToUse}, tools: ${tools?.length || 0}`);

  const response = await client.chat.completions.create({
    model: modelToUse,
    messages,
    tools,
    tool_choice: tools?.length > 0 ? "auto" : undefined
  });

  return response;
}

/**
 * Google Gemini chat completion with tools
 */
async function createGeminiChatCompletion(messages, tools, model) {
  const client = createGeminiClient();
  const modelToUse = model || process.env.GEMINI_MODEL || "gemini-1.5-flash";

  console.log(`[gemini] Chat with model: ${modelToUse}, tools: ${tools?.length || 0}`);

  const genai = client;
  const modelInstance = genai.getGenerativeModel({
    model: modelToUse,
    tools: tools ? [{ functionDeclarations: tools.map(t => t.function) }] : undefined
  });

  // Convert OpenAI messages to Gemini format
  const geminiMessages = messages.map(msg => ({
    role: msg.role === "user" ? "user" : msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const response = await modelInstance.generateContent({
    contents: geminiMessages
  });

  // Convert Gemini response back to OpenAI format
  const choices = response.response?.candidates?.length > 0
    ? [{
        message: {
          role: "assistant",
          content: response.response.candidates[0].content?.parts?.[0]?.text || "",
          tool_calls: null
        },
        finish_reason: "stop"
      }]
    : [];

  return { choices };
}

/**
 * Stream completion (for future enhancement)
 */
export async function createChatCompletionStream(messages, tools, model) {
  console.log("[llm] Streaming not yet implemented");
  return await createChatCompletion(messages, tools, model);
}
