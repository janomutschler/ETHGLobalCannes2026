import * as p from "@clack/prompts";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");

const REQUIRED_KEYS = [
  {
    key: "BYBIT_API_KEY",
    label: "Bybit API Key",
    hint: "Read-only key recommended — used for market data only",
  },
  {
    key: "BYBIT_SECRET",
    label: "Bybit API Secret",
    hint: "Paired with the API key above",
  },
  {
    key: "PRIVATE_KEY",
    label: "0G Web3 Wallet Private Key",
    hint: "Must hold testnet tokens for gas fees on 0G Storage uploads",
  },
  {
    key: "AI_API_KEY",
    label: "AI API Key (OpenClaw)",
    hint: "Used for the AI analyst agent reasoning",
  },
  {
    key: "NEWS_API_KEY",
    label: "News API Key (serper.dev)",
    hint: "For fetching recent crypto news headlines",
  },
] as const;

export async function runSetupWizard(): Promise<void> {
  if (existsSync(ENV_PATH)) {
    return;
  }

  p.intro("Trading Researcher — First-time Setup");

  p.note(
    "This wizard will create a local .env file with your API keys.\n" +
      "Keys are stored only on your machine and never transmitted.",
    "Security Notice",
  );

  const values: Record<string, string> = {};

  for (const { key, label, hint } of REQUIRED_KEYS) {
    const value = await p.password({
      message: `Enter your ${label}`,
      validate: (v) => {
        if (!v || v.trim().length === 0) return `${label} is required`;
      },
    });

    if (p.isCancel(value)) {
      p.cancel("Setup cancelled. Run the bot again to restart setup.");
      process.exit(0);
    }

    values[key] = value;
    p.log.success(`${label} saved (${hint})`);
  }

  const lines = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  writeFileSync(ENV_PATH, lines + "\n", { mode: 0o600 });

  p.outro("Setup complete — .env created. Starting the bot...");
}
