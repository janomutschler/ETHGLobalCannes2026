#!/usr/bin/env node
/**
 * Quick checks before `npm run ui` or OpenClaw bridge.
 * Does not print secret values.
 */
import "dotenv/config";

const errors = [];
const hints = [];

const gemini = process.env.GEMINI_API_KEY?.trim();
const openai = process.env.OPENAI_API_KEY?.trim();

if (!gemini && !openai) {
  errors.push("Set OPENAI_API_KEY (OpenAI) or GEMINI_API_KEY (Gemini) in .env (see .env.example).");
}

if (gemini && openai) {
  hints.push("GEMINI_API_KEY is set — it takes precedence; OpenAI vars are ignored for the LLM client.");
}

if (gemini) {
  hints.push("LLM: Gemini (GEMINI_API_KEY).");
} else if (openai) {
  if (openai.startsWith("AIza")) {
    hints.push(
      "OPENAI_API_KEY looks like a Google key — the agent will use the Gemini SDK, not OpenAI Chat Completions."
    );
  } else {
    hints.push("LLM: OpenAI-compatible (OPENAI_API_KEY). Use a sk-… key for api.openai.com.");
  }
}

try {
  await import("@0gfoundation/0g-ts-sdk");
  hints.push("0G Storage SDK import OK.");
} catch {
  hints.push("0G Storage SDK missing — run: npm install (needed for storage_* tools).");
}

for (const h of hints) {
  console.log(`• ${h}`);
}

if (errors.length) {
  console.error("\nFix these, then run:\n  npm run ui\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const port = process.env.UI_PORT || "3847";
const host = process.env.UI_HOST || "127.0.0.1";
console.log(`
Ready. Start the server:
  npm run ui

Then open:
  http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/

Health:
  curl http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/api/health

OpenClaw bridge (with gateway running): set OG_AGENT_BASE_URL=http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}
`);
