import "dotenv/config";
import { connectMcp, createLlmContext, runChatLoop } from "./agent-core.mjs";

let llm;
try {
  llm = createLlmContext();
} catch (e) {
  console.error(
    e?.message ||
      "Set OPENAI_API_KEY or GEMINI_API_KEY in .env (see .env.example)."
  );
  process.exit(1);
}

const userPrompt =
  process.argv.slice(2).join(" ").trim() ||
  "Use the 0G MCP tools. Call compute_list_providers and summarize what you get in plain English.";

const conn = await connectMcp("0g-cli-agent");

try {
  const reply = await runChatLoop(
    { ...llm, ...conn },
    userPrompt,
    {
      onToolCall(name, args) {
        console.error(`[tool] ${name}(${JSON.stringify(args)})`);
      },
    }
  );
  console.log("\n--- Agent reply ---\n");
  console.log(reply);
} finally {
  await conn.dispose();
}
