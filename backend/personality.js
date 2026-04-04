import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOUL_PATH = path.join(__dirname, "../soul.md");

/**
 * Read personality/soul from file
 */
export async function readPersonality() {
  const soulPath = process.env.SOUL_PATH || DEFAULT_SOUL_PATH;
  
  try {
    const content = await fs.readFile(soulPath, "utf8");
    console.log(`[personality] Loaded from ${soulPath}`);
    return content;
  } catch (error) {
    console.log(`[personality] ${soulPath} not found, using default`);
    return getDefaultPersonality();
  }
}

/**
 * Get default personality
 */
function getDefaultPersonality() {
  return `You are a 0G agent with these core traits:
- You remember facts, preferences, and context about the user
- You can execute blockchain actions (send coins, log events)
- You think step-by-step through technical problems
- You're direct and practical, no unnecessary formality
- You prioritize transparency and verification`;
}

/**
 * Build enhanced system prompt with personality
 */
export async function buildSystemPrompt(basePrompt = "") {
  const personality = await readPersonality();
  
  return `${basePrompt}

## Your Personality & Core Values

${personality}

## Available Tools

You have access to:
- Memory tools: save/retrieve preferences and facts
- Storage tools: 0G decentralized storage
- Chain tools: on-chain logging and coin transfers
- Always explain what each tool does before using it`;
}

/**
 * Extract user directives from soul (e.g., language preferences)
 */
export async function extractPersonalityDirectives() {
  const personality = await readPersonality();
  
  const directives = {
    matchTone: personality.includes("Match my tone"),
    noFluff: personality.includes("No fluff"),
    useEmojis: personality.includes("emojis sparingly"),
    transparent: personality.includes("transparent")
  };

  return directives;
}
