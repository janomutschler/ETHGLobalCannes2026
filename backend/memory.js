import fs from "fs/promises";

const MEMORY_FILE = "./memory_openclaw.json";

function normalizeUserId(userId) {
  if (!userId) return "current_user";
  if (userId === "demo-user" || userId === "user") return "current_user";
  return userId;
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
  db[normalizedUserId].preferences.push(preference);
  await writeMemoryFile(db);
  return { ok: true, saved: preference };
}

export async function getPreferences(userId) {
  const normalizedUserId = normalizeUserId(userId);
  const db = await readMemoryFile();
  if (db[normalizedUserId]?.preferences) {
    return db[normalizedUserId].preferences;
  }
  if (normalizedUserId !== "user" && db.user?.preferences) {
    return db.user.preferences;
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