import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MAX_TEXT_CHARS = 500_000;
const MAX_DOWNLOAD_RETURN = 256_000;

const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
const DEFAULT_EVM_RPC = "https://evmrpc-testnet.0g.ai";

const TOOL_UPLOAD = "storage_upload_text";
const TOOL_DOWNLOAD = "storage_download_by_root";
const TOOL_ROOT = "storage_root_hash_for_text";

/** @type {Set<string>} */
export const STORAGE_TOOL_NAMES = new Set([TOOL_UPLOAD, TOOL_DOWNLOAD, TOOL_ROOT]);

function indexerRpc() {
  return process.env.STORAGE_INDEXER_RPC?.trim() || DEFAULT_INDEXER_RPC;
}

function evmRpc() {
  return process.env.STORAGE_EVM_RPC?.trim() || DEFAULT_EVM_RPC;
}

function storagePrivateKey() {
  return (
    process.env.STORAGE_PRIVATE_KEY?.trim() ||
    process.env.ZEROG_PRIVATE_KEY?.trim() ||
    ""
  );
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "0g-agent-storage-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withUtf8TempFile(content, baseName, fn) {
  return withTempDir(async (dir) => {
    const p = join(dir, baseName);
    await writeFile(p, content, "utf8");
    return fn(p, dir);
  });
}

async function loadSdk() {
  try {
    return await import("@0gfoundation/0g-ts-sdk");
  } catch {
    return null;
  }
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

/**
 * Build extra OpenAI-format tools for 0G Storage (merged with MCP tools).
 * @returns {{ openaiTools: object[], toolNames: string[] } | null}
 */
export async function buildStorageOpenAiTools() {
  const sdk = await loadSdk();
  if (!sdk) return null;

  const tools = [];
  const names = [];

  tools.push(
    openAiToolDef(
      TOOL_ROOT,
      "Compute the 0G Storage Merkle root hash for UTF-8 text locally (no gas, no upload).",
      {
        content: {
          type: "string",
          description: "UTF-8 text to hash (max " + MAX_TEXT_CHARS + " chars).",
        },
      },
      ["content"]
    )
  );
  names.push(TOOL_ROOT);

  tools.push(
    openAiToolDef(
      TOOL_DOWNLOAD,
      "Download a file from 0G Storage by root hash (reads UTF-8 back; large files are truncated in the response).",
      {
        root_hash: { type: "string", description: "Merkle root hash from a prior upload." },
        with_proof: {
          type: "boolean",
          description: "Request proof verification (default false).",
        },
      },
      ["root_hash"]
    )
  );
  names.push(TOOL_DOWNLOAD);

  if (storagePrivateKey()) {
    tools.push(
      openAiToolDef(
        TOOL_UPLOAD,
        "Upload UTF-8 text to 0G Storage via the configured indexer and EVM RPC. Requires STORAGE_PRIVATE_KEY or ZEROG_PRIVATE_KEY and gas on the wallet.",
        {
          content: {
            type: "string",
            description: "UTF-8 text to store (max " + MAX_TEXT_CHARS + " chars).",
          },
          filename_hint: {
            type: "string",
            description: "Optional file name for the temp blob (default upload.txt).",
          },
        },
        ["content"]
      )
    );
    names.push(TOOL_UPLOAD);
  }

  return { openaiTools: tools, toolNames: names };
}

/**
 * Download decoded UTF-8 from 0G Storage by root hash (for app logic, e.g. memory).
 * @param {string} rootHash
 * @param {{ withProof?: boolean; maxChars?: number }} [options]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function zerogDownloadUtf8(rootHash, options = {}) {
  const { withProof = false, maxChars = MAX_DOWNLOAD_RETURN } = options;
  const hash = typeof rootHash === "string" ? rootHash.trim() : "";
  if (!hash) return { ok: false, error: "root_hash is empty" };

  const sdk = await loadSdk();
  if (!sdk) {
    return { ok: false, error: "0g-ts-sdk not installed" };
  }

  const { Indexer } = sdk;
  try {
    const indexer = new Indexer(indexerRpc());
    return await withTempDir(async (dir) => {
      const outPath = join(dir, "download.out");
      const err = await indexer.download(hash, outPath, withProof);
      if (err != null) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const buf = await readFile(outPath);
      let text = buf.toString("utf8");
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
      }
      return { ok: true, text };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Upload UTF-8 text to 0G Storage (requires gas key).
 * @param {string} content
 * @param {string} [filenameHint]
 * @returns {Promise<{ ok: true, rootHash: string, txHash: string } | { ok: false, error: string }>}
 */
export async function zerogUploadUtf8(content, filenameHint = "upload.txt") {
  const pk = storagePrivateKey();
  if (!pk) {
    return { ok: false, error: "Set STORAGE_PRIVATE_KEY or ZEROG_PRIVATE_KEY for uploads" };
  }
  if (typeof content !== "string" || !content.length) {
    return { ok: false, error: "content is empty" };
  }
  if (content.length > MAX_TEXT_CHARS) {
    return { ok: false, error: `content exceeds ${MAX_TEXT_CHARS} characters` };
  }

  const sdk = await loadSdk();
  if (!sdk) {
    return { ok: false, error: "0g-ts-sdk not installed" };
  }

  const { Indexer, ZgFile } = sdk;
  const hint = filenameHint
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 64) || "upload.txt";

  try {
    const { JsonRpcProvider, Wallet } = await import("ethers");
    const provider = new JsonRpcProvider(evmRpc());
    const signer = new Wallet(pk, provider);
    const indexer = new Indexer(indexerRpc());
    const rpc = evmRpc();

    return await withUtf8TempFile(content, hint, async (path) => {
      const file = await ZgFile.fromFilePath(path);
      try {
        const [res, err] = await indexer.upload(file, rpc, signer);
        if (err != null) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (res && "txHash" in res && "rootHash" in res) {
          return { ok: true, rootHash: res.rootHash, txHash: res.txHash };
        }
        if (res && "txHashes" in res && "rootHashes" in res && res.rootHashes?.length) {
          return {
            ok: false,
            error: "Fragment upload not supported for this caller — reduce payload size",
          };
        }
        return { ok: false, error: "Unexpected upload response" };
      } finally {
        await file.close();
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function executeStorageTool(name, args) {
  const sdk = await loadSdk();
  if (!sdk) {
    return "Error: @0gfoundation/0g-ts-sdk is not installed. Run npm install in 0g-agent.";
  }

  const { Indexer, ZgFile } = sdk;

  try {
    if (name === TOOL_ROOT) {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.length) return "Error: content is required.";
      if (content.length > MAX_TEXT_CHARS) {
        return `Error: content exceeds ${MAX_TEXT_CHARS} characters.`;
      }
      return await withUtf8TempFile(content, "blob.txt", async (path) => {
        const file = await ZgFile.fromFilePath(path);
        try {
          const [tree, err] = await file.merkleTree();
          if (err != null) return `Error computing merkle tree: ${err.message || err}`;
          const rootHash = tree.rootHash();
          return JSON.stringify({ rootHash, note: "local only — not uploaded" });
        } finally {
          await file.close();
        }
      });
    }

    if (name === TOOL_DOWNLOAD) {
      const rootHash = typeof args.root_hash === "string" ? args.root_hash.trim() : "";
      if (!rootHash) return "Error: root_hash is required.";
      const proof = Boolean(args.with_proof);
      const dl = await zerogDownloadUtf8(rootHash, { withProof: proof, maxChars: MAX_DOWNLOAD_RETURN });
      if (!dl.ok) return `Error: download failed: ${dl.error}`;
      const text = dl.text;
      const truncated = text.length >= MAX_DOWNLOAD_RETURN;
      return JSON.stringify({
        root_hash: rootHash,
        utf8_length_returned: text.length,
        truncated,
        content: text,
      });
    }

    if (name === TOOL_UPLOAD) {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.length) return "Error: content is required.";
      const hint =
        typeof args.filename_hint === "string" && args.filename_hint.trim()
          ? args.filename_hint.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)
          : "upload.txt";
      const up = await zerogUploadUtf8(content, hint);
      if (!up.ok) return `Error: upload failed: ${up.error}`;
      return JSON.stringify({
        txHash: up.txHash,
        rootHash: up.rootHash,
        indexerRpc: indexerRpc(),
        evmRpc: evmRpc(),
      });
    }

    return `Error: unknown storage tool: ${name}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Merge 0G Storage SDK tools into the MCP client context.
 * @param {object} mcpCtx — return value of connectMcp() before merging
 */
export async function mergeStorageTools(mcpCtx) {
  const bundle = await buildStorageOpenAiTools();
  if (!bundle || !bundle.openaiTools.length) return mcpCtx;

  const mergedAllowed = new Set([...mcpCtx.allowedToolNames, ...bundle.toolNames]);
  return {
    ...mcpCtx,
    openaiTools: [...bundle.openaiTools, ...mcpCtx.openaiTools],
    allowedToolNames: mergedAllowed,
    toolNameList: [...mergedAllowed].sort().join(", "),
  };
}
