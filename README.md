# 0g-agent

A chat **agent for the 0G Network**: it answers with an LLM, calls **0G tools** over **MCP** (default `@0gfoundation/0g-cc`), and adds **0G Storage** operations (upload, download by root, local root hash) via the official TypeScript SDK. You can run it from the **terminal** or a **small web UI** with optional **MetaMask** context for wallet-aware replies.

---

## What it does

- **Chat** with tool use: the model only sees tools you actually register (MCP list + storage + optional RAG).
- **0G MCP**: spawned as a subprocess (`npx` or your `ZERO_G_MCP_COMMAND`); env vars are passed through for network and keys.
- **0G Storage (SDK)**: `storage_upload_text`, `storage_download_by_root`, `storage_root_hash_for_text` (testnet-friendly defaults; uploads need a funded key).
- **Memory**
  - **Short-term**: recent turns (file or, with `MEMORY_BACKEND=zerog`, 0G blob + `zerog-roots.json`).
  - **Long-term**: messages starting with **`!remember`** (structured blocks; optional 0G backend).
- **Digital twin RAG**: `twin_rag_ingest` / `twin_rag_search` and automatic retrieval into the system prompt (`memory/rag-store.json`), using OpenAI or Gemini **embeddings** (see `.env.example`).
- **Personality**: optional `soul.md` (or `SOUL_PATH`) injected into the system prompt.
- **Wallet UX (web)**: read-only snapshot in the prompt; the model may end with a **`<<WALLET_REQUEST>>`** block for the UI to send txs via the user’s wallet (no server-side private keys for users).
- **OpenClaw (optional)**: plugin in `plugins/openclaw-0g` exposes `zerog_agent_chat` → `POST /api/chat` on this server. See `OPENCLAW.md`.

---

## Tech stack

| Piece | Technology |
|--------|------------|
| Runtime | Node.js **ES modules** (`.mjs`) |
| LLM | **OpenAI-compatible** API (`openai` package) **or** **Google Gemini** (`@google/generative-ai`) — chosen from env |
| 0G tools (remote) | **MCP** — `@modelcontextprotocol/sdk`, stdio transport |
| 0G Storage (in-process) | `@0gfoundation/0g-ts-sdk`, **ethers** `6.13.1` |
| Web server | Node **`http`** (no Express): static UI + JSON API |
| Config | **`dotenv`** — copy `.env.example` → `.env` |

---

## How to run

### 1. Install

```bash
cd 0g-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` (minimum):

- **Either** `OPENAI_API_KEY` with a normal `sk-…` key **or** `GEMINI_API_KEY` for Gemini (see comments in `.env.example` for precedence and Groq/OpenRouter).

Optional but common:

- `STORAGE_PRIVATE_KEY` or `ZEROG_PRIVATE_KEY` — for **uploads** and gas on 0G Storage.
- `MEMORY_BACKEND=zerog` — persist memory blobs on 0G (same key requirement for writes).
- `UI_PORT` / `UI_HOST` — default chat UI at `http://127.0.0.1:3847`.

### 3. Preflight (recommended)

```bash
npm run preflight
```

Checks LLM keys, 0G SDK import, and prints the local URL / OpenClaw hint.

### 4. Start the web UI + API

```bash
npm run ui
```

Open **http://127.0.0.1:3847/** (or your `UI_HOST`:`UI_PORT`).

- **Health:** `GET /api/health`
- **Chat:** `POST /api/chat` with JSON `{ "prompt": "…", "wallet": { …optional } }` → `{ "reply": "…" }`

### 5. One-shot CLI (no HTTP server)

```bash
npm start
```

Runs `agent.mjs` with the prompt from command-line args (or a default demo prompt).

### Other scripts

| Command | Purpose |
|---------|---------|
| `npm run mcp-tools` | List tools from the MCP server |
| `npm run openclaw:install-plugin` | Install deps for `plugins/openclaw-0g` |

---

## Repository layout (short)

| Path | Role |
|------|------|
| `server.mjs` | HTTP server + `/api/chat` |
| `agent-core.mjs` | LLM context, MCP connect, tool merge, chat loop |
| `agent.mjs` | CLI entry |
| `storage-0g.mjs` | 0G Storage SDK tools |
| `memory.mjs` | Short/long memory; optional 0G |
| `rag.mjs` | Digital twin RAG store + tools |
| `soul.md` | Default personality markdown |
| `public/index.html` | Web UI |
| `plugins/openclaw-0g/` | OpenClaw bridge plugin |
| `OPENCLAW.md` | OpenClaw install / `OG_AGENT_BASE_URL` |

---

## Security notes

- Do **not** commit `.env`. `.env.example` is a template only.
- Never put user **seed phrases** or **private keys** in chat for the server to store; wallet signing is intended for the **browser** path.

### If an API key was committed (GitHub push blocked)

Fixing the file in your editor is **not enough**: the old key still lives inside **past commits**. `git rebase -i` only helps if you **mark the bad commit as `edit`**, replace the secret in `.env.example`, then `git add` + `git commit --amend` + `git rebase --continue`.

**Easiest fix** (one new history, no old blobs): from a clean working tree, run:

```bash
chmod +x scripts/git-orphan-rewrite.sh
./scripts/git-orphan-rewrite.sh
```

Then **force-push** (only if you are allowed to rewrite `main`):

```bash
git push -f origin main
```

**Rotate** the leaked OpenAI key in the provider dashboard — treat it as exposed.
