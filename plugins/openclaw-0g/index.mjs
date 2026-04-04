import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

function resolveBaseUrl(api) {
  const cfg = api.pluginConfig ?? {};
  const fromCfg = typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim() : "";
  if (fromCfg) return fromCfg.replace(/\/$/, "");
  const env = process.env.OG_AGENT_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return "http://127.0.0.1:3847";
}

export default definePluginEntry({
  id: "openclaw-0g",
  name: "0G Agent bridge",
  description:
    "Chat with the standalone 0g-agent server (LLM + 0G MCP tools + file memory). Start it with npm run ui in the 0g-agent repo.",
  register(api) {
    api.registerTool({
      name: "zerog_agent_chat",
      label: "0G Agent chat",
      description:
        "Send a user message to the 0g-agent HTTP API. The agent runs its own model and tools. Optionally pass wallet for the User wallet system section.",
      parameters: Type.Object({
        prompt: Type.String({
          description: "Message to send to 0g-agent (same as the web UI).",
        }),
        wallet: Type.Optional(
          Type.Any({
            description:
              "Optional MetaMask-style snapshot: { address, chainId, chainName?, balanceNative?, symbol? }.",
          })
        ),
      }),
      async execute(_id, params) {
        const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
        if (!prompt) throw new Error("prompt is required");

        const base = resolveBaseUrl(api);
        const url = `${base}/api/chat`;
        const body = { prompt };
        if (params.wallet != null && typeof params.wallet === "object") {
          body.wallet = params.wallet;
        }

        let res;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `zerog_agent_chat: cannot reach ${url} — is npm run ui running? (${msg})`
          );
        }

        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            `zerog_agent_chat: non-JSON response (${res.status}): ${rawText.slice(0, 300)}`
          );
        }

        if (!res.ok) {
          const err = typeof data.error === "string" ? data.error : rawText.slice(0, 300);
          throw new Error(`zerog_agent_chat: ${err}`);
        }

        const reply = typeof data.reply === "string" ? data.reply : JSON.stringify(data);
        return {
          content: [{ type: "text", text: reply }],
        };
      },
    });
  },
});
