import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connectMcp, createLlmContext, runChatLoop } from "./agent-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let llm;
try {
  llm = createLlmContext();
} catch (e) {
  console.error(
    e?.message ||
      "Missing or invalid LLM config: set OPENAI_API_KEY (OpenAI) or GEMINI_API_KEY (Gemini) in .env — see .env.example"
  );
  process.exit(1);
}

const mcpPromise = connectMcp("0g-web-ui");

let queue = Promise.resolve();
function enqueue(fn) {
  const next = queue.then(() => fn());
  queue = next.catch(() => {});
  return next;
}

/**
 * @param {unknown} raw
 * @returns {{ address: string; chainId: number; chainName: string; balanceNative: string; symbol: string } | null}
 */
function normalizeWalletContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const address = typeof o.address === "string" ? o.address.trim() : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  const cidRaw = o.chainId;
  const chainId =
    typeof cidRaw === "number" && Number.isInteger(cidRaw) && cidRaw > 0
      ? cidRaw
      : typeof cidRaw === "string" && /^\d+$/.test(cidRaw)
        ? Number(cidRaw)
        : NaN;
  if (!Number.isFinite(chainId)) return null;
  const chainName =
    typeof o.chainName === "string" ? o.chainName.trim().slice(0, 80) : "unknown";
  const balanceNative =
    typeof o.balanceNative === "string" ? o.balanceNative.trim().slice(0, 80) : "";
  const symbol =
    typeof o.symbol === "string" ? o.symbol.trim().slice(0, 16) : "native";
  return { address, chainId, chainName, balanceNative, symbol };
}

async function chat(prompt, walletContext) {
  const conn = await mcpPromise;
  return runChatLoop({ ...llm, ...conn }, prompt, {
    ...(walletContext ? { walletContext } : {}),
  });
}

const server = createServer(async (req, res) => {
  const url = req.url?.split("?")[0] || "";

  if (req.method === "GET" && url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "0g-agent" }));
    return;
  }

  if (req.method === "GET" && url === "/") {
    try {
      const html = await readFile(join(__dirname, "public", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(e));
    }
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    try {
      const data = JSON.parse(body || "{}");
      const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Send a non-empty prompt." }));
        return;
      }
      const walletContext = normalizeWalletContext(data.wallet);
      const reply = await enqueue(() => chat(prompt, walletContext));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = Number(process.env.UI_PORT || 3847);
const HOST = process.env.UI_HOST?.trim() || "127.0.0.1";
server.listen(PORT, HOST, () => {
  const backend =
    llm.provider === "gemini" ? `Gemini (${llm.model})` : `OpenAI-compatible (${llm.model})`;
  console.log(`0G agent UI → http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/  ·  ${backend}`);
  if (HOST === "0.0.0.0") {
    console.log(`  (bound on 0.0.0.0:${PORT} — use 127.0.0.1 from this machine)`);
  }
});
