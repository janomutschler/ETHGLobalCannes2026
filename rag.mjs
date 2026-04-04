import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MEMORY_DIR = process.env.MEMORY_DIR
  ? process.env.MEMORY_DIR
  : join(__dirname, "memory");
const RAG_STORE = join(MEMORY_DIR, "rag-store.json");

const CHUNK_SIZE = Number(process.env.RAG_CHUNK_SIZE || 600);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 80);
const TOP_K = Number(process.env.RAG_TOP_K || 5);
const MAX_CHUNKS = Number(process.env.RAG_MAX_CHUNKS || 1500);
const OPENAI_EMBED_MODEL =
  process.env.RAG_OPENAI_EMBED_MODEL?.trim() || "text-embedding-3-small";
const GEMINI_EMBED_MODEL =
  process.env.RAG_GEMINI_EMBED_MODEL?.trim() || "text-embedding-004";

/** @type {Set<string>} */
export const RAG_TOOL_NAMES = new Set(["twin_rag_ingest", "twin_rag_search"]);

const TOOL_INGEST = "twin_rag_ingest";
const TOOL_SEARCH = "twin_rag_search";

function ragDisabled() {
  return process.env.RAG_DISABLED === "1" || process.env.RAG_DISABLED === "true";
}

function looksLikeGoogleApiKey(key) {
  return Boolean(key?.startsWith("AIza"));
}

/**
 * @returns {"openai" | "gemini" | null}
 */
function embeddingBackend() {
  const forced = process.env.RAG_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;

  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    (looksLikeGoogleApiKey(process.env.OPENAI_API_KEY)
      ? process.env.OPENAI_API_KEY?.trim()
      : "");
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (geminiKey) return "gemini";
  if (openaiKey && !looksLikeGoogleApiKey(openaiKey)) return "openai";
  return null;
}

async function ensureDir() {
  await mkdir(MEMORY_DIR, { recursive: true });
}

/**
 * @returns {Promise<{ version: number; chunks: Array<{ id: string; text: string; source: string; createdAt: string; embedding: number[] }> }>}
 */
async function loadStore() {
  try {
    const raw = await readFile(RAG_STORE, "utf8");
    const j = JSON.parse(raw);
    const chunks = Array.isArray(j.chunks) ? j.chunks : [];
    return { version: 1, chunks };
  } catch {
    return { version: 1, chunks: [] };
  }
}

async function saveStore(store) {
  await ensureDir();
  let { chunks } = store;
  if (chunks.length > MAX_CHUNKS) {
    chunks = chunks
      .slice()
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .slice(-MAX_CHUNKS);
  }
  await writeFile(
    RAG_STORE,
    JSON.stringify({ version: 1, chunks }, null, 0) + "\n",
    "utf8"
  );
}

function splitIntoChunks(text) {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  const paragraphs = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paragraphs) {
    if (p.length <= CHUNK_SIZE) {
      out.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      const piece = p.slice(i, i + CHUNK_SIZE).trim();
      if (piece) out.push(piece);
    }
  }
  return out;
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function embedOpenAI(texts) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || looksLikeGoogleApiKey(apiKey)) {
    throw new Error("RAG needs OPENAI_API_KEY (sk-…) for OpenAI embeddings");
  }
  const openai = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
  });
  const input = Array.isArray(texts) ? texts : [texts];
  const res = await openai.embeddings.create({
    model: OPENAI_EMBED_MODEL,
    input: input.length === 1 ? input[0] : input,
  });
  const list = Array.isArray(res.data)
    ? res.data.sort((x, y) => x.index - y.index)
    : [];
  return list.map((d) => d.embedding);
}

function geminiEmbedRequestOptions() {
  const opts = {};
  const base = process.env.GEMINI_BASE_URL?.trim();
  if (base) opts.baseUrl = base.replace(/\/+$/, "");
  const ver = process.env.GEMINI_API_VERSION?.trim();
  if (ver) opts.apiVersion = ver;
  return opts;
}

async function embedGemini(texts) {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    (looksLikeGoogleApiKey(process.env.OPENAI_API_KEY)
      ? process.env.OPENAI_API_KEY?.trim()
      : "");
  if (!key) {
    throw new Error(
      "RAG needs GEMINI_API_KEY (or Google key in OPENAI_API_KEY) for Gemini embeddings"
    );
  }
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel(
    { model: GEMINI_EMBED_MODEL },
    geminiEmbedRequestOptions()
  );
  const arr = Array.isArray(texts) ? texts : [texts];
  if (arr.length === 1) {
    const r = await model.embedContent(arr[0]);
    const values = r.embedding?.values;
    if (!values?.length) throw new Error("Gemini embedContent returned no values");
    return [values];
  }
  const batch = await model.batchEmbedContents({
    requests: arr.map((text) => ({
      content: { role: "user", parts: [{ text }] },
    })),
  });
  const embeddings = batch.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== arr.length) {
    throw new Error("Gemini batchEmbedContents size mismatch");
  }
  return embeddings.map((e) => {
    const values = e?.values;
    if (!values?.length) throw new Error("Gemini embedding missing values");
    return values;
  });
}

async function embedTexts(texts) {
  const backend = embeddingBackend();
  if (!backend) {
    throw new Error(
      "No embedding backend: set OPENAI_API_KEY (sk-…) or GEMINI_API_KEY, or RAG_EMBEDDING_PROVIDER"
    );
  }
  if (backend === "openai") return embedOpenAI(texts);
  return embedGemini(texts);
}

/**
 * @param {string} query
 * @param {number} [k]
 */
export async function retrieveRagContext(query, k = TOP_K) {
  if (ragDisabled()) return "";
  const q = query.trim();
  if (q.length < 2) return "";

  const store = await loadStore();
  if (!store.chunks.length) return "";

  let qVec;
  try {
    [qVec] = await embedTexts([q]);
  } catch (e) {
    console.warn(
      `[rag] retrieve skip: ${e instanceof Error ? e.message : String(e)}`
    );
    return "";
  }

  const scored = store.chunks
    .filter((c) => c.embedding?.length)
    .map((c) => ({ c, score: cosine(qVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (!scored.length) return "";

  const lines = scored.map(
    ({ c, score }, i) =>
      `[${i + 1}] (source: ${c.source || "unknown"}, score: ${score.toFixed(3)})\n${c.text}`
  );
  return (
    "## Digital twin knowledge (retrieved — prefer over guesses for user-specific facts)\n" +
    lines.join("\n\n---\n\n") +
    "\n\nIf nothing here answers the question, say so and use tools or general knowledge as appropriate."
  );
}

export async function ingestTwinKnowledge(text, source = "user") {
  const chunks = splitIntoChunks(text);
  if (!chunks.length) return { added: 0, message: "No text to ingest" };

  const embeddings = await embedTexts(chunks);
  const store = await loadStore();
  const now = new Date().toISOString();
  const src = String(source || "user").slice(0, 200);
  for (let i = 0; i < chunks.length; i++) {
    store.chunks.push({
      id: randomUUID(),
      text: chunks[i],
      source: src,
      createdAt: now,
      embedding: embeddings[i],
    });
  }
  await saveStore(store);
  return {
    added: chunks.length,
    message: `Ingested ${chunks.length} chunk(s) into the digital twin knowledge base.`,
  };
}

export async function searchTwinKnowledge(query, topK = TOP_K) {
  const block = await retrieveRagContext(query, topK);
  if (!block) {
    return { text: "No matching passages in the twin knowledge base (empty or below threshold)." };
  }
  return { text: block };
}

function openAiToolDef(name, description, properties, required) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}

export function buildRagOpenAiTools() {
  if (ragDisabled()) return null;
  if (!embeddingBackend()) return null;

  return {
    openaiTools: [
      openAiToolDef(
        TOOL_INGEST,
        "Add text to the user's digital twin knowledge base (RAG). Use for facts, preferences, bios, documents the user wants remembered for future turns.",
        {
          text: {
            type: "string",
            description: "Content to remember (can be several paragraphs).",
          },
          source: {
            type: "string",
            description: "Short label e.g. user_profile, meeting_notes, pasted_doc",
          },
        },
        ["text"]
      ),
      openAiToolDef(
        TOOL_SEARCH,
        "Search the digital twin knowledge base and return the most relevant stored passages (with sources).",
        {
          query: { type: "string", description: "What to look up." },
          top_k: {
            type: "integer",
            description: `Max passages (default ${TOP_K})`,
          },
        },
        ["query"]
      ),
    ],
    toolNames: [...RAG_TOOL_NAMES],
  };
}

export async function executeRagTool(name, args) {
  try {
    if (name === TOOL_INGEST) {
      const text = typeof args.text === "string" ? args.text : "";
      const source =
        typeof args.source === "string" ? args.source : "agent_ingest";
      const r = await ingestTwinKnowledge(text, source);
      return JSON.stringify(r);
    }
    if (name === TOOL_SEARCH) {
      const query = typeof args.query === "string" ? args.query : "";
      const topK =
        typeof args.top_k === "number" && args.top_k > 0
          ? Math.min(20, args.top_k)
          : TOP_K;
      const r = await searchTwinKnowledge(query, topK);
      return r.text;
    }
    return `Error: unknown RAG tool: ${name}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function mergeRagTools(mcpCtx) {
  const bundle = buildRagOpenAiTools();
  if (!bundle?.openaiTools?.length) return mcpCtx;

  const mergedAllowed = new Set([
    ...mcpCtx.allowedToolNames,
    ...bundle.toolNames,
  ]);
  return {
    ...mcpCtx,
    openaiTools: [...bundle.openaiTools, ...mcpCtx.openaiTools],
    allowedToolNames: mergedAllowed,
    toolNameList: [...mergedAllowed].sort().join(", "),
  };
}
