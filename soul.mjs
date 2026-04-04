import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const soulPath = () =>
  process.env.SOUL_PATH
    ? process.env.SOUL_PATH
    : join(__dirname, "soul.md");

/**
 * @returns {Promise<string>} trimmed markdown, or "" if missing / unreadable
 */
export async function readSoul() {
  try {
    const text = await readFile(soulPath(), "utf8");
    return text.trim();
  } catch {
    return "";
  }
}
