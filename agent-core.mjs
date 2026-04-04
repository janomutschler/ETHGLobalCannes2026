import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import * as mem from "./memory.mjs";
import { readSoul } from "./soul.mjs";
import {
  mergeStorageTools,
  STORAGE_TOOL_NAMES,
  executeStorageTool,
} from "./storage-0g.mjs";
import {
  mergeRagTools,
  RAG_TOOL_NAMES,
  executeRagTool,
  retrieveRagContext,
} from "./rag.mjs";

/** Passed to `getGenerativeModel(..., requestOptions)` — see Google AI SDK `RequestOptions`. */
function geminiRequestOptionsFromEnv() {
  const opts = {};
  const base = process.env.GEMINI_BASE_URL?.trim();
  if (base) {
    opts.baseUrl = base.replace(/\/+$/, "");
  }
  const ver = process.env.GEMINI_API_VERSION?.trim();
  if (ver) {
    opts.apiVersion = ver;
  }
  return opts;
}

function looksLikeGoogleApiKey(key) {
  return Boolean(key?.startsWith("AIza"));
}

/** Strip agent-emitted wallet blocks so short-term memory stays readable. */
const AGENT_WALLET_REQUEST_RE = /<<WALLET_REQUEST>>[\s\S]*?<<\/WALLET_REQUEST>>\s*/gi;

function stripAgentWalletRequestForMemory(text) {
  return (text || "").replace(AGENT_WALLET_REQUEST_RE, "").trimEnd();
}

/**
 * LLM selection:
 * - OpenAI-compatible (OpenAI, Groq, OpenRouter, …) when OPENAI_API_KEY is set and GEMINI_API_KEY is empty
 *   (unless OPENAI_API_KEY is a Google AIza… key — then Gemini SDK is used with that key).
 * - Gemini when GEMINI_API_KEY is set (takes precedence over OpenAI vars).
 */
export function createLlmContext() {
  const geminiKeyExplicit = process.env.GEMINI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiKey =
    geminiKeyExplicit || (looksLikeGoogleApiKey(openaiKey) ? openaiKey : "");

  if (geminiKey) {
    if (!geminiKeyExplicit && looksLikeGoogleApiKey(openaiKey)) {
      console.warn(
        "[0g-agent] Google API key detected in OPENAI_API_KEY — using Gemini SDK. Prefer GEMINI_API_KEY in .env."
      );
    }
    const genAI = new GoogleGenerativeAI(geminiKey);
    return {
      provider: "gemini",
      genAI,
      model:
        process.env.GEMINI_MODEL?.trim() ||
        process.env.OPENAI_MODEL?.trim() ||
        "gemini-2.0-flash",
      geminiRequestOptions: geminiRequestOptionsFromEnv(),
    };
  }
  return { provider: "openai", ...createOpenAIClient() };
}

export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  if (looksLikeGoogleApiKey(apiKey)) {
    throw new Error(
      "Google API keys (AIza…) must use the Gemini path. Set GEMINI_API_KEY or remove OPENAI_API_KEY after moving the key."
    );
  }
  let baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  if (
    baseURL &&
    baseURL.includes("generativelanguage.googleapis.com")
  ) {
    console.warn(
      "[0g-agent] OPENAI_BASE_URL is for Google Generative Language (Gemini REST), not OpenAI Chat Completions — ignoring it. Use GEMINI_API_KEY for Gemini, or a real OpenAI-compatible base URL."
    );
    baseURL = undefined;
  }
  const isGroq = Boolean(baseURL?.includes("groq.com"));
  const openai = new OpenAI({ apiKey, baseURL });
  const model =
    process.env.OPENAI_MODEL ||
    (isGroq ? "llama-3.3-70b-versatile" : "gpt-4o-mini");
  return { openai, model, isGroq };
}

function mcpToolsToOpenAI(mcpTools) {
  return mcpTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters:
        t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} },
    },
  }));
}

function toolResultToString(result) {
  if (result.isError) {
    return `Error: ${JSON.stringify(result.content ?? result)}`;
  }
  const parts = result.content ?? [];
  return parts
    .map((block) => {
      if (block.type === "text") return block.text;
      return JSON.stringify(block);
    })
    .join("\n");
}

async function dispatchToolCall(client, name, args) {
  if (STORAGE_TOOL_NAMES.has(name)) {
    return executeStorageTool(name, args);
  }
  if (RAG_TOOL_NAMES.has(name)) {
    return executeRagTool(name, args);
  }
  const result = await client.callTool({ name, arguments: args });
  return toolResultToString(result);
}

function sanitizeAssistantMessage(msg, allowedNames) {
  const calls = msg.tool_calls;
  if (!calls?.length) {
    return { message: msg, allToolCallsInvalid: false };
  }

  const valid = [];
  const invalidNames = [];
  for (const c of calls) {
    const name = c.function?.name;
    if (name && allowedNames.has(name)) valid.push(c);
    else if (name) invalidNames.push(name);
  }

  if (invalidNames.length === 0) {
    return { message: msg, allToolCallsInvalid: false };
  }

  const allowedList = [...allowedNames].join(", ");
  const note = `\n\n[Use only these tools (exact names): ${allowedList}. Do not call: ${invalidNames.join(", ")}.]`;

  const message = {
    role: "assistant",
    content: (msg.content ?? "") + note,
    ...(valid.length ? { tool_calls: valid } : {}),
  };

  return {
    message,
    allToolCallsInvalid: valid.length === 0 && calls.length > 0,
  };
}

export async function connectMcp(clientName = "0g-agent") {
  const transport = new StdioClientTransport({
    command: process.env.ZERO_G_MCP_COMMAND || "npx",
    args: process.env.ZERO_G_MCP_ARGS
      ? JSON.parse(process.env.ZERO_G_MCP_ARGS)
      : ["-y", "@0gfoundation/0g-cc"],
    env: { ...getDefaultEnvironment(), ...process.env },
    stderr: "inherit",
  });

  const client = new Client({ name: clientName, version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const { tools: mcpTools } = await client.listTools();
  const openaiTools = mcpToolsToOpenAI(mcpTools);
  const allowedToolNames = new Set(mcpTools.map((t) => t.name));
  const toolNameList = [...allowedToolNames].join(", ");

  const ctx = {
    client,
    openaiTools,
    allowedToolNames,
    toolNameList,
    async dispose() {
      await client.close();
    },
  };
  const withStorage = await mergeStorageTools(ctx);
  return mergeRagTools(withStorage);
}

const MAX_STEPS = 12;

async function runChatLoopGemini(
  ctx,
  systemContent,
  userPrompt,
  client,
  openaiTools,
  allowedToolNames,
  hooks,
  finish
) {
  const { genAI, model: modelName, geminiRequestOptions = {} } = ctx;
  const { onToolCall } = hooks;

  const functionDeclarations = openaiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description || undefined,
    parameters: t.function.parameters,
  }));

  const genModel = genAI.getGenerativeModel(
    {
      model: modelName,
      systemInstruction: systemContent,
      tools: [{ functionDeclarations }],
    },
    geminiRequestOptions
  );

  const chat = genModel.startChat({ history: [] });
  let last = await chat.sendMessage(userPrompt);

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = last.response;
    const calls = resp.functionCalls?.() ?? [];

    if (!calls.length) {
      let text = "(no text)";
      try {
        text = resp.text() || text;
      } catch {
        /* blocked or non-text */
      }
      return await finish(text);
    }

    const responseParts = [];
    for (const call of calls) {
      const name = call.name;
      let args = call.args;
      if (!args || typeof args !== "object") args = {};

      if (!allowedToolNames.has(name)) {
        responseParts.push({
          functionResponse: {
            name,
            response: {
              error: `Invalid tool. Use only: ${[...allowedToolNames].join(", ")}`,
            },
          },
        });
        continue;
      }

      onToolCall?.(name, args);
      const text = await dispatchToolCall(client, name, args);
      responseParts.push({
        functionResponse: {
          name,
          response: { result: text },
        },
      });
    }

    last = await chat.sendMessage(responseParts);
  }

  let tail = "(Stopped: max tool steps reached.)";
  try {
    tail = last.response.text() || tail;
  } catch {
    /* ignore */
  }
  return await finish(tail);
}

/**
 * @param {object} ctx — from connectMcp + createLlmContext()
 * @param {string} userPrompt
 * @param {{
 *   onToolCall?: (name: string, args: object) => void;
 *   walletContext?: { address: string; chainId: number; chainName: string; balanceNative: string; symbol: string };
 * }} hooks
 * @returns {Promise<string>}
 */
export async function runChatLoop(ctx, userPrompt, hooks = {}) {
  const { client, openaiTools, allowedToolNames, toolNameList } = ctx;
  const { onToolCall, walletContext } = hooks;

  await mem.ensureMemoryDir();
  const rememberLine = mem.parseRememberInstruction(userPrompt);
  if (rememberLine) {
    await mem.appendLongTerm(rememberLine);
  }

  const shortMem = await mem.readShortTerm();
  const longMem = await mem.readLongTerm();
  const memoryBlock = mem.formatMemoryForPrompt(shortMem, longMem);
  const ragBlock = await retrieveRagContext(userPrompt);
  const soulText = await readSoul();

  const baseSystem =
    `You are an agent for the 0G Network. You may ONLY call these tools (exact names): ${toolNameList}. ` +
    "Do not use web search tools or any name not in that list. " +
    "Use tools when they help; after tool results, answer clearly. " +
    "For general knowledge (weather, news, etc.) answer from your own knowledge — do not invent tools. " +
    "Never tell the user to put a wallet private key or seed phrase in .env or on the server — signing is via MetaMask in their browser only. " +
    "Wallet requests: If the user asks you to execute a real send/transfer (not a tutorial), you have valid 0x recipient(s) and amount, AND this prompt includes a \"User wallet\" section (MetaMask connected), append at the very end exactly one block:\n" +
    "<<WALLET_REQUEST>>\n" +
    '{"action":"native_send","to":"0x000000000000000000000000000000000000dEaD","amount":"0.01"}\n' +
    "<</WALLET_REQUEST>>\n" +
    'Use action "erc20_send" with "token","to","amount" for ERC-20 (18 decimals). ' +
    "Do not include the block if User wallet is absent, for hypotheticals, or if any address/amount is missing — tell them to connect MetaMask or clarify.";

  const memoryHint =
    "The user can add a durable fact by starting a message with !remember followed by the text (you will see it in their message). " +
    "For richer profile or document memory, use twin_rag_ingest; twin_rag_search retrieves passages explicitly. " +
    "A RAG section below may auto-retrieve relevant twin knowledge for this message.";

  const soulBlock = soulText
    ? `## Soul (personality — follow closely)\n${soulText}`
    : "";

  const walletBlock = walletContext
    ? [
        "## User wallet (authoritative for this request)",
        `MetaMask in the browser sent this read-only snapshot with the user's message. It overrides any short-term memory where a past reply claimed there was "no wallet" or asked for a private key in the environment — those replies were incorrect.`,
        `Network: ${walletContext.chainName} (chainId ${walletContext.chainId})`,
        `Address: ${walletContext.address}`,
        `Native balance: ${walletContext.balanceNative} ${walletContext.symbol}`,
        `Answer balance questions using these numbers (native/gas token only). You do not have ERC-20 balances here. If this section is absent, say they should click Connect MetaMask or use /balance.`,
        `You may end your reply with a <<WALLET_REQUEST>> block (see base instructions) when the user wants you to submit a concrete transfer via their wallet.`,
      ].join("\n")
    : "";

  const systemParts = [baseSystem];
  if (soulBlock) systemParts.push(soulBlock);
  systemParts.push(memoryHint);
  if (memoryBlock) systemParts.push(memoryBlock);
  if (ragBlock) systemParts.push(ragBlock);
  if (walletBlock) systemParts.push(walletBlock);
  const systemContent = systemParts.join("\n\n");

  async function finish(reply) {
    const text = reply ?? "(no text)";
    await mem.appendShortTerm(userPrompt, stripAgentWalletRequestForMemory(text));
    return text;
  }

  if (ctx.provider === "gemini") {
    return runChatLoopGemini(
      ctx,
      systemContent,
      userPrompt,
      client,
      openaiTools,
      allowedToolNames,
      hooks,
      finish
    );
  }

  const { openai, model, isGroq } = ctx;

  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userPrompt },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools: openaiTools.length ? openaiTools : undefined,
      tool_choice: openaiTools.length ? "auto" : undefined,
      ...(isGroq ? { parallel_tool_calls: false } : {}),
    });

    const choice = completion?.choices?.[0];
    if (!choice) {
      const hint =
        "The OpenAI SDK expected { choices: [{ message }] } but got something else. " +
        "If you use Google Gemini, set GEMINI_API_KEY (not OPENAI_*). " +
        "If you use a proxy, OPENAI_BASE_URL must speak the OpenAI Chat Completions API.";
      throw new Error(
        `${hint}\nModel: ${model}\nSnippet: ${JSON.stringify(completion).slice(0, 600)}`
      );
    }

    const { message: msg, allToolCallsInvalid } = sanitizeAssistantMessage(
      choice.message,
      allowedToolNames
    );

    messages.push(msg);

    const calls = msg.tool_calls;
    if (!calls?.length) {
      if (allToolCallsInvalid) {
        continue;
      }
      return await finish(msg.content ?? "(no text)");
    }

    for (const call of calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      onToolCall?.(name, args);
      const text = await dispatchToolCall(client, name, args);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: text,
      });
    }
  }

  return await finish("(Stopped: max tool steps reached.)");
}
