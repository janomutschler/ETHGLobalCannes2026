import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zerogDownloadUtf8, zerogUploadUtf8 } from "./storage-0g.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = process.env.MEMORY_DIR
  ? process.env.MEMORY_DIR
  : join(__dirname, "memory");

const SHORT_FILE = join(MEMORY_DIR, "short-term.txt");
const LONG_FILE = join(MEMORY_DIR, "long-term.txt");
const ZEROG_ROOTS_FILE = join(MEMORY_DIR, "zerog-roots.json");

const shortMaxChars = () =>
  Number(process.env.MEMORY_SHORT_MAX_CHARS || 8000);
const longMaxChars = () =>
  Number(process.env.MEMORY_LONG_MAX_CHARS || 6000);
const shortMaxBlocks = () =>
  Number(process.env.MEMORY_SHORT_MAX_BLOCKS || 12);
const longMaxEntries = () =>
  Number(process.env.MEMORY_LONG_MAX_ENTRIES || 32);

/** Max UTF-8 length to pull from 0G for one memory blob (generous vs prompt caps). */
const ZEROG_MEMORY_DOWNLOAD_CAP = Number(process.env.MEMORY_ZEROG_MAX_DOWNLOAD || 512_000);

function useZerogMemory() {
  const b = process.env.MEMORY_BACKEND?.trim().toLowerCase();
  return b === "zerog" || b === "0g";
}

let warnedZerogFallback = false;

function warnFallback(reason) {
  if (warnedZerogFallback) return;
  warnedZerogFallback = true;
  console.warn(`[memory] 0G backend: ${reason} — falling back to local files for this write/read.`);
}

/**
 * @returns {Promise<{ shortTermRoot?: string; longTermRoot?: string }>}
 */
async function readZerogRoots() {
  try {
    const raw = await readFile(ZEROG_ROOTS_FILE, "utf8");
    const j = JSON.parse(raw);
    return {
      shortTermRoot: typeof j.shortTermRoot === "string" ? j.shortTermRoot : undefined,
      longTermRoot: typeof j.longTermRoot === "string" ? j.longTermRoot : undefined,
    };
  } catch {
    return {};
  }
}

async function writeZerogRoots(roots) {
  await writeFile(ZEROG_ROOTS_FILE, JSON.stringify(roots, null, 2) + "\n", "utf8");
}

function trimShortBlocksString(raw, maxBlocks) {
  const parts = raw
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= maxBlocks) return parts.join("\n---\n") + (parts.length ? "\n" : "");
  const kept = parts.slice(-maxBlocks);
  return kept.join("\n---\n") + "\n";
}

/** @typedef {{ ts: string; fact: string }} LongEntry */

function parseLegacyLongTermLines(t) {
  const out = [];
  for (const line of t.split("\n")) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (m && m[2].trim()) {
      out.push({ ts: m[1], fact: m[2].replace(/\s+/g, " ").trim() });
    } else if (line.trim() && !/^\[[^\]]+\]\s*$/.test(line)) {
      out.push({ ts: "", fact: line.replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

function parseLongTermToEntries(raw) {
  const t = raw.replace(/\r/g, "").trim();
  if (!t) return [];
  const firstLine = t.split("\n")[0] || "";
  if (!t.includes("\n---\n") && /^\[[^\]]+\]/.test(firstLine)) {
    return parseLegacyLongTermLines(t);
  }
  const parts = t.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  const entries = [];
  for (const segment of parts) {
    const nl = segment.indexOf("\n");
    if (nl === -1) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(segment)) continue;
      entries.push({ ts: "", fact: segment.trim() });
      continue;
    }
    const first = segment.slice(0, nl).trim();
    const rest = segment.slice(nl + 1).trim().replace(/\s+/g, " ");
    if (!rest) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(first)) {
      entries.push({ ts: first, fact: rest });
    } else {
      entries.push({ ts: "", fact: segment.replace(/\s+/g, " ").trim() });
    }
  }
  return entries;
}

function serializeLongTermEntries(entries) {
  const blocks = [];
  for (const { ts, fact } of entries) {
    const f = fact.replace(/\s+/g, " ").trim();
    if (!f) continue;
    const time =
      ts && /^\d{4}-\d{2}-\d{2}T/.test(ts) ? ts : new Date().toISOString();
    blocks.push(`${time}\n${f}`);
  }
  return blocks.join("\n---\n") + (blocks.length ? "\n" : "");
}

function trimLongTermEntries(entries, maxEntries, maxChars) {
  let e =
    entries.length > maxEntries ? entries.slice(-maxEntries) : entries.slice();
  let s = serializeLongTermEntries(e);
  while (s.length > maxChars && e.length > 1) {
    e = e.slice(1);
    s = serializeLongTermEntries(e);
  }
  if (s.length > maxChars && e.length === 1) {
    const fact = e[0].fact;
    const budget = Math.max(0, maxChars - 64);
    e = [{ ...e[0], fact: fact.length > budget ? fact.slice(-budget) : fact }];
    s = serializeLongTermEntries(e);
  }
  return e;
}

function entriesToLongTermBullets(entries) {
  if (!entries.length) return "";
  return entries.map(({ fact }) => `- ${fact}`).join("\n");
}

async function fetchLongTermRaw() {
  if (!useZerogMemory()) {
    try {
      return await readFile(LONG_FILE, "utf8");
    } catch {
      return "";
    }
  }
  const roots = await readZerogRoots();
  if (!roots.longTermRoot) {
    try {
      return await readFile(LONG_FILE, "utf8");
    } catch {
      return "";
    }
  }
  const dl = await zerogDownloadUtf8(roots.longTermRoot, {
    maxChars: ZEROG_MEMORY_DOWNLOAD_CAP,
  });
  if (!dl.ok) {
    warnFallback(`long-term download: ${dl.error}`);
    try {
      return await readFile(LONG_FILE, "utf8");
    } catch {
      return "";
    }
  }
  return dl.text;
}

export async function ensureMemoryDir() {
  await mkdir(MEMORY_DIR, { recursive: true });
}

/**
 * Lines starting with !remember (after trim) → saved to long-term file.
 * Returns text to store, or null.
 */
export function parseRememberInstruction(text) {
  const t = text.trim();
  if (!t.toLowerCase().startsWith("!remember")) return null;
  const rest = t.slice("!remember".length).trim();
  return rest || null;
}

async function readShortTermFromFile() {
  const max = shortMaxChars();
  try {
    const raw = await readFile(SHORT_FILE, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(-max);
  } catch {
    return "";
  }
}

async function readShortTermFromZerog() {
  const max = shortMaxChars();
  const roots = await readZerogRoots();
  if (!roots.shortTermRoot) {
    return await readShortTermFromFile();
  }
  const dl = await zerogDownloadUtf8(roots.shortTermRoot, {
    maxChars: ZEROG_MEMORY_DOWNLOAD_CAP,
  });
  if (!dl.ok) {
    warnFallback(`short-term download: ${dl.error}`);
    return await readShortTermFromFile();
  }
  const trimmed = dl.text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(-max);
}

export async function readShortTerm() {
  if (!useZerogMemory()) {
    return readShortTermFromFile();
  }
  await ensureMemoryDir();
  return readShortTermFromZerog();
}

export async function readLongTerm() {
  await ensureMemoryDir();
  const raw = await fetchLongTermRaw();
  const entries = trimLongTermEntries(
    parseLongTermToEntries(raw),
    longMaxEntries(),
    longMaxChars(),
  );
  return entriesToLongTermBullets(entries);
}

export async function appendLongTerm(line) {
  const fact = line.replace(/\s+/g, " ").trim();
  if (!fact) return;

  await ensureMemoryDir();
  const raw = await fetchLongTermRaw();
  const entries = parseLongTermToEntries(raw);
  entries.push({ ts: new Date().toISOString(), fact });
  const next = serializeLongTermEntries(
    trimLongTermEntries(entries, longMaxEntries(), longMaxChars()),
  );

  if (!useZerogMemory()) {
    await writeFile(LONG_FILE, next, "utf8");
    return;
  }

  const up = await zerogUploadUtf8(next, "long-term-memory.txt");
  if (!up.ok) {
    warnFallback(`long-term upload: ${up.error}`);
    await writeFile(LONG_FILE, next, "utf8");
    return;
  }
  const latestRoots = await readZerogRoots();
  await writeZerogRoots({ ...latestRoots, longTermRoot: up.rootHash });
}

export async function appendShortTerm(userText, assistantText) {
  const ts = new Date().toISOString();
  const u = userText.replace(/\r/g, "").trim();
  const a = (assistantText || "").replace(/\r/g, "").trim().slice(0, 4000);
  const block = `---\n${ts}\nUser: ${u}\nAssistant: ${a}\n`;

  if (!useZerogMemory()) {
    await ensureMemoryDir();
    await appendFile(SHORT_FILE, block, "utf8");
    await trimShortTermBlocks();
    return;
  }

  await ensureMemoryDir();
  const roots = await readZerogRoots();
  let current = "";
  if (roots.shortTermRoot) {
    const dl = await zerogDownloadUtf8(roots.shortTermRoot, {
      maxChars: ZEROG_MEMORY_DOWNLOAD_CAP,
    });
    if (dl.ok) current = dl.text;
    else warnFallback(`short-term read before append: ${dl.error}`);
  }
  if (!current) {
    try {
      current = await readFile(SHORT_FILE, "utf8");
    } catch {
      /* empty */
    }
  }

  const merged = (current + block).replace(/\r/g, "");
  let next = trimShortBlocksString(merged, shortMaxBlocks());
  const cap = shortMaxChars();
  if (next.length > cap) {
    next = next.slice(-cap);
  }

  const up = await zerogUploadUtf8(next, "short-term-memory.txt");
  if (!up.ok) {
    warnFallback(`short-term upload: ${up.error}`);
    await appendFile(SHORT_FILE, block, "utf8");
    await trimShortTermBlocks();
    return;
  }
  const latestRoots = await readZerogRoots();
  await writeZerogRoots({ ...latestRoots, shortTermRoot: up.rootHash });
}

async function trimShortTermBlocks() {
  const max = shortMaxBlocks();
  let raw;
  try {
    raw = await readFile(SHORT_FILE, "utf8");
  } catch {
    return;
  }
  const next = trimShortBlocksString(raw, max);
  await writeFile(SHORT_FILE, next, "utf8");
}

export function formatMemoryForPrompt(shortText, longText) {
  const chunks = [];
  if (longText) {
    chunks.push("## Durable facts (from !remember — treat as authoritative)\n" + longText);
  }
  if (shortText) {
    chunks.push(
      "## Recent conversation (short-term — last questions & replies)\n" +
        shortText
    );
  }
  if (!chunks.length) return "";
  return (
    chunks.join("\n\n") +
    "\n\nRespect long-term durable facts. Short-term lines are past chat — they can be wrong or outdated. " +
      "If a later system section titled \"User wallet\" gives address/balance, prefer that over old assistant guesses in the excerpt above."
  );
}
