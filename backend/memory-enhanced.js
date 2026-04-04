import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { uploadMemoryTo0G, downloadMemoryFrom0G } from "./storage-0g.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname, "../memory");
const SHORT_FILE = path.join(MEMORY_DIR, "short-term.json");
const LONG_FILE = path.join(MEMORY_DIR, "long-term.json");
const ROOTS_FILE = path.join(MEMORY_DIR, "storage-roots.json");

// Ensure memory directory exists
async function ensureMemoryDir() {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  } catch {}
}

function useZerogMemory() {
  const b = process.env.MEMORY_BACKEND?.trim().toLowerCase();
  return b === "zerog" || b === "0g";
}

/**
 * Short-term memory: recent conversation turns (12 max blocks)
 */
async function readShortTermMemory(userId) {
  try {
    await ensureMemoryDir();
    const raw = await fs.readFile(SHORT_FILE, "utf8");
    const data = JSON.parse(raw);
    return data[userId]?.turns || [];
  } catch {
    return [];
  }
}

async function appendShortTermMemory(userId, role, content) {
  try {
    await ensureMemoryDir();
    let data = {};
    try {
      const raw = await fs.readFile(SHORT_FILE, "utf8");
      data = JSON.parse(raw);
    } catch {}

    if (!data[userId]) data[userId] = { turns: [] };
    
    data[userId].turns.push({
      ts: new Date().toISOString(),
      role,
      content: content.substring(0, 1000) // Trim long responses
    });

    // Keep only last 12 turns
    if (data[userId].turns.length > 12) {
      data[userId].turns = data[userId].turns.slice(-12);
    }

    await fs.writeFile(SHORT_FILE, JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (error) {
    console.error("[memory] Short-term append failed:", error);
    return { ok: false, error: error.message };
  }
}

/**
 * Long-term memory: facts and preferences with timestamps
 */
async function readLongTermMemory(userId) {
  try {
    await ensureMemoryDir();
    const raw = await fs.readFile(LONG_FILE, "utf8");
    const data = JSON.parse(raw);
    return data[userId]?.facts || [];
  } catch {
    return [];
  }
}

async function appendLongTermMemory(userId, fact) {
  try {
    await ensureMemoryDir();
    let data = {};
    try {
      const raw = await fs.readFile(LONG_FILE, "utf8");
      data = JSON.parse(raw);
    } catch {}

    if (!data[userId]) data[userId] = { facts: [] };

    // Deduplicate
    const lowerFact = fact.toLowerCase();
    if (!data[userId].facts.some(f => f.fact.toLowerCase() === lowerFact)) {
      data[userId].facts.push({
        ts: new Date().toISOString(),
        fact
      });
    }

    // Keep only last 100 facts
    if (data[userId].facts.length > 100) {
      data[userId].facts = data[userId].facts.slice(-100);
    }

    await fs.writeFile(LONG_FILE, JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (error) {
    console.error("[memory] Long-term append failed:", error);
    return { ok: false, error: error.message };
  }
}

/**
 * Get full memory summary for context injection
 */
export async function getMemorySummary(userId) {
  await ensureMemoryDir();
  const shortTerm = await readShortTermMemory(userId);
  const longTerm = await readLongTermMemory(userId);

  let summary = "";
  
  if (longTerm.length > 0) {
    summary += "## About the user (long-term memory):\n";
    longTerm.forEach(entry => {
      summary += `- ${entry.fact}\n`;
    });
  }

  if (shortTerm.length > 0) {
    summary += "\n## Recent conversation:\n";
    shortTerm.slice(-5).forEach(turn => {
      summary += `[${turn.role}]: ${turn.content.substring(0, 100)}\n`;
    });
  }

  return summary || "(No memory yet)";
}

/**
 * Save preference (new fact)
 */
export async function savePreference(userId, preference) {
  await appendLongTermMemory(userId, preference);
  await appendShortTermMemory(userId, "system", `Remembered: ${preference}`);
  return { ok: true, saved: preference };
}

/**
 * Get all facts/preferences
 */
export async function getPreferences(userId) {
  const longTerm = await readLongTermMemory(userId);
  return longTerm.map(entry => entry.fact);
}

/**
 * Check if user likes something
 */
export async function checkPreference(userId, item) {
  const prefs = await getPreferences(userId);
  const normalizedItem = item.toLowerCase();
  const matched = prefs.filter(p => p.toLowerCase().includes(normalizedItem));
  return {
    ok: true,
    item,
    likes: matched.length > 0,
    matchedPreferences: matched
  };
}

/**
 * Delete a preference
 */
export async function deletePreference(userId, searchTerm) {
  try {
    await ensureMemoryDir();
    const raw = await fs.readFile(LONG_FILE, "utf8");
    const data = JSON.parse(raw);
    
    if (!data[userId]) return { ok: false, error: "User not found" };

    const searchLower = searchTerm.toLowerCase();
    const before = data[userId].facts.length;
    
    data[userId].facts = data[userId].facts.filter(
      f => !f.fact.toLowerCase().includes(searchLower)
    );

    const deleted = before - data[userId].facts.length;
    await fs.writeFile(LONG_FILE, JSON.stringify(data, null, 2));
    
    return { ok: true, deleted, message: `Deleted ${deleted} fact(s)` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Clear all memory
 */
export async function clearMemory(userId) {
  try {
    await ensureMemoryDir();
    
    // Clear both files
    let shortData = {};
    try {
      const raw = await fs.readFile(SHORT_FILE, "utf8");
      shortData = JSON.parse(raw);
    } catch {}
    delete shortData[userId];
    await fs.writeFile(SHORT_FILE, JSON.stringify(shortData, null, 2));

    let longData = {};
    try {
      const raw = await fs.readFile(LONG_FILE, "utf8");
      longData = JSON.parse(raw);
    } catch {}
    const cleared = longData[userId]?.facts?.length || 0;
    delete longData[userId];
    await fs.writeFile(LONG_FILE, JSON.stringify(longData, null, 2));

    return { ok: true, cleared, message: `Cleared ${cleared} fact(s)` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * View all facts organized
 */
export async function viewAllFacts(userId) {
  const facts = await getPreferences(userId);
  
  // Extract likes
  const likePattern = /i like\s+([a-z0-9\s,&-]+)(?:\.|,|$)/gi;
  const likes = new Set();
  facts.forEach(f => {
    const match = f.match(likePattern);
    if (match) {
      match.forEach(m => {
        const item = m.replace(/^i like\s+/i, '').replace(/[.,;:$]/g, '').trim();
        if (item) likes.add(item);
      });
    }
  });

  return {
    ok: true,
    facts,
    likes: Array.from(likes),
    factCount: facts.length,
    likeCount: likes.size
  };
}

/**
 * Record conversation turn
 */
export async function recordTurn(userId, role, content) {
  await appendShortTermMemory(userId, role, content);
  return { ok: true };
}
