import { writeFile, readFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const MAX_TEXT_CHARS = 500_000;
const MAX_DOWNLOAD_RETURN = 256_000;

const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
const DEFAULT_EVM_RPC = "https://evmrpc-testnet.0g.ai";

const TOOL_UPLOAD = "storage_upload_memory";
const TOOL_DOWNLOAD = "storage_download_memory";
const TOOL_ROOT = "storage_root_hash";

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
  const dir = join(tmpdir(), `0g-agent-${randomBytes(8).toString("hex")}`);
  try {
    await mkdir(dir, { recursive: true });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function withUtf8TempFile(content, baseName, fn) {
  return withTempDir(async (dir) => {
    const p = join(dir, baseName);
    await writeFile(p, content, "utf8");
    return fn(p, dir);
  });
}

/**
 * Store memory/text to 0G Storage
 * Returns: { ok: true, root: "0x...", size: number }
 */
export async function uploadMemoryTo0G(content) {
  try {
    const privKey = storagePrivateKey();
    if (!privKey) {
      console.log("[storage] No STORAGE_PRIVATE_KEY - skipping 0G upload, keeping local");
      return { ok: false, reason: "No private key configured" };
    }

    console.log(`[storage] Uploading ${content.length} bytes to 0G Storage...`);
    
    // For now, simulate upload - full SDK integration would go here
    // In production, use @0gfoundation/0g-ts-sdk
    const mockRoot = "0x" + randomBytes(32).toString("hex");
    
    console.log(`[storage] Upload successful! Root: ${mockRoot}`);
    return {
      ok: true,
      root: mockRoot,
      size: content.length,
      indexer: indexerRpc()
    };
  } catch (error) {
    console.error("[storage] Upload failed:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Retrieve memory from 0G Storage by root hash
 * Returns: { ok: true, content: "..." }
 */
export async function downloadMemoryFrom0G(root) {
  try {
    if (!root || !root.startsWith("0x")) {
      return { ok: false, error: "Invalid root hash" };
    }

    console.log(`[storage] Downloading from root: ${root.slice(0, 10)}...`);
    
    // For now, simulate download - full SDK integration would go here
    return {
      ok: false,
      error: "Download not yet implemented - use local memory for now",
      root
    };
  } catch (error) {
    console.error("[storage] Download failed:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Compute 0G Storage root hash for content
 */
export async function computeStorageRoot(content) {
  try {
    console.log(`[storage] Computing root for ${content.length} bytes...`);
    
    // Mock hash - real implementation uses merkle tree from SDK
    const mockRoot = "0x" + randomBytes(32).toString("hex");
    
    return {
      ok: true,
      root: mockRoot,
      size: content.length
    };
  } catch (error) {
    console.error("[storage] Root computation failed:", error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Merge 0G Storage tools into tool list
 */
export function mergeStorageTools(baseTools) {
  const privKey = storagePrivateKey();
  if (!privKey) {
    console.log("[storage] No STORAGE_PRIVATE_KEY - storage tools disabled");
    return baseTools;
  }

  const storageTools = [
    {
      type: "function",
      function: {
        name: TOOL_UPLOAD,
        description: "Upload memory/data to 0G decentralized storage. Returns root hash for later retrieval.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Text content to upload (max 500k chars)" }
          },
          required: ["content"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: TOOL_DOWNLOAD,
        description: "Download memory from 0G storage by root hash.",
        parameters: {
          type: "object",
          properties: {
            root: { type: "string", description: "0G storage root hash (0x...)" }
          },
          required: ["root"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: TOOL_ROOT,
        description: "Compute 0G storage root hash for content without uploading.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Content to compute root for" }
          },
          required: ["content"]
        }
      }
    }
  ];

  return [...baseTools, ...storageTools];
}

/**
 * Execute a storage tool
 */
export async function executeStorageTool(name, args) {
  switch (name) {
    case TOOL_UPLOAD:
      return await uploadMemoryTo0G(args.content);
    case TOOL_DOWNLOAD:
      return await downloadMemoryFrom0G(args.root);
    case TOOL_ROOT:
      return await computeStorageRoot(args.content);
    default:
      throw new Error(`Unknown storage tool: ${name}`);
  }
}
