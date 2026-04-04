import fs from "fs/promises";

const MEMORY_FILE = "./memory_openclaw.json";

function normalizeUserId(userId) {
  if (!userId) return "current_user";
  if (userId === "demo-user" || userId === "user") return "current_user";
  return userId;
}

// Extract "I like X" items and deduplicate
function extractLikes(preferences) {
  const likePattern = /i like\s+([a-z0-9\s,&-]+)(?:\.|,|$)/gi;
  const likes = new Set();
  
  for (const pref of preferences) {
    const match = pref.match(likePattern);
    if (match) {
      match.forEach(m => {
        const item = m.replace(/^i like\s+/i, '').replace(/[.,;:$]/g, '').trim();
        if (item) likes.add(item.toLowerCase());
      });
    }
  }
  return Array.from(likes);
}

// Extract facts like "my name is X", "I am X"
function extractFacts(preferences) {
  const facts = {};
  const patterns = [
    { regex: /my name is\s+([a-z0-9\s]+)(?:\.|,|$)/i, key: 'name' },
    { regex: /i (?:am|'m)\s+([a-z0-9\s]+)(?:\.|,|$)/i, key: 'profession' },
    { regex: /i (?:work|study) (?:as|at)\s+([a-z0-9\s]+)(?:\.|,|$)/i, key: 'workplace' },
    { regex: /i live in\s+([a-z0-9\s]+)(?:\.|,|$)/i, key: 'location' }
  ];

  for (const pref of preferences) {
    for (const { regex, key } of patterns) {
      const match = pref.match(regex);
      if (match && !facts[key]) {
        facts[key] = match[1].trim();
      }
    }
  }
  return facts;
}

// Deduplicate preferences array
function deduplicatePreferences(preferences) {
  const seen = new Set();
  const normalized = [];
  
  for (const pref of preferences) {
    const lower = pref.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      normalized.push(pref);
    }
  }
  
  return normalized;
}

async function readMemoryFile() {
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeMemoryFile(data) {
  await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function savePreference(userId, preference) {
  const normalizedUserId = normalizeUserId(userId);
  const db = await readMemoryFile();
  if (!db[normalizedUserId]) db[normalizedUserId] = { preferences: [] };
  
  // Check for duplicates before saving
  const lower = preference.toLowerCase();
  const isDuplicate = db[normalizedUserId].preferences.some(p => p.toLowerCase() === lower);
  
  if (!isDuplicate) {
    db[normalizedUserId].preferences.push(preference);
  }
  
  await writeMemoryFile(db);
  return { ok: true, saved: preference, isDuplicate };
}

export async function getPreferences(userId) {
  const normalizedUserId = normalizeUserId(userId);
  const db = await readMemoryFile();
  if (db[normalizedUserId]?.preferences) {
    return deduplicatePreferences(db[normalizedUserId].preferences);
  }
  if (normalizedUserId !== "user" && db.user?.preferences) {
    return deduplicatePreferences(db.user.preferences);
  }
  return [];
}

export async function checkPreference(userId, item) {
  const preferences = await getPreferences(userId);
  const normalizedItem = item.toLowerCase();
  const matched = preferences.filter((pref) =>
    pref.toLowerCase().includes(normalizedItem)
  );

  return {
    ok: true,
    item,
    likes: matched.length > 0,
    matchedPreferences: matched,
    allPreferences: preferences
  };
}

export async function deletePreference(userId, searchTerm) {
  const normalizedUserId = normalizeUserId(userId);
  const db = await readMemoryFile();
  if (!db[normalizedUserId]) return { ok: false, error: "User not found" };

  const searchLower = searchTerm.toLowerCase();
  const originalLength = db[normalizedUserId].preferences.length;
  
  db[normalizedUserId].preferences = db[normalizedUserId].preferences.filter(
    p => !p.toLowerCase().includes(searchLower)
  );

  const deletedCount = originalLength - db[normalizedUserId].preferences.length;
  await writeMemoryFile(db);
  
  return { 
    ok: true, 
    deleted: deletedCount,
    message: `Deleted ${deletedCount} preference(s) containing "${searchTerm}"`
  };
}

export async function clearMemory(userId) {
  const normalizedUserId = normalizeUserId(userId);
  const db = await readMemoryFile();
  
  const hadPreferences = db[normalizedUserId]?.preferences?.length || 0;
  db[normalizedUserId] = { preferences: [] };
  
  await writeMemoryFile(db);
  
  return { 
    ok: true, 
    cleared: hadPreferences,
    message: `Cleared ${hadPreferences} preference(s)`
  };
}

export async function viewAllFacts(userId) {
  const preferences = await getPreferences(userId);
  const facts = extractFacts(preferences);
  const likes = extractLikes(preferences);
  
  return {
    ok: true,
    facts,
    likes,
    allPreferences: preferences,
    factCount: Object.keys(facts).length,
    likeCount: likes.length
  };
}