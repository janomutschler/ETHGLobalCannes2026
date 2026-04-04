# OpenClaw integration

The **0g-agent** app is a standalone HTTP + LLM + MCP service. To run it **inside the OpenClaw gateway** as a tool the model can call:

## 1. Install the plugin into OpenClaw

From the **0g-agent** repo:

```bash
npm run openclaw:install-plugin
```

Or from your OpenClaw environment:

```bash
openclaw plugins install /absolute/path/to/eth_cannes/0g-agent/plugins/openclaw-0g
```

Enable the plugin in OpenClaw config (`plugins.entries.openclaw-0g.enabled: true`) and optionally set:

```json
"config": {
  "baseUrl": "http://127.0.0.1:3847"
}
```

If `baseUrl` is omitted, the plugin uses **`OG_AGENT_BASE_URL`**, then defaults to `http://127.0.0.1:3847`.

## 2. Run the 0g-agent server

In another terminal, from this repo (with `.env` for the LLM and 0G keys as usual):

```bash
npm run ui
```

## 3. Use the tool from OpenClaw

The plugin registers **`zerog_agent_chat`** with a `prompt` argument (and optional `wallet` object). OpenClaw’s agent can call it to delegate a turn to 0g-agent, which uses its own model, MCP tools, and memory.

This is **hybrid**: OpenClaw owns channels and orchestration; **0g-agent** remains the process that talks to the 0G stack and your `memory/` files.
