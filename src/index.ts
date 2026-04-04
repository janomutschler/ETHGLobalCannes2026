import "dotenv/config";
import { runSetupWizard } from "./setup.js";
import {
  checkPriceVolatility,
  type VolatilityResult,
} from "./api/bybit.js";
import { fetchRecentNews, formatNewsForPrompt } from "./api/news.js";
import { ANALYST_SYSTEM_PROMPT } from "./agent/prompt.js";
import {
  logAnalysisTool,
  executeLogAnalysisTool,
  LOG_ANALYSIS_TOOL_NAME,
} from "./agent/tools.js";
import { createClient } from "openclaw-sdk";

const WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function runAgentAnalysis(
  volatility: VolatilityResult,
  newsText: string,
): Promise<void> {
  const client = createClient({
    url: process.env.OPENCLAW_GATEWAY_URL ?? "wss://gateway.openclaw.ai",
    credentials: {
      apiKey: process.env.AI_API_KEY!,
    },
  });

  await client.connect();

  try {
    const userMessage = [
      `TOKEN: ${volatility.symbol}`,
      `PRICE CHANGE: ${volatility.changePercent}% (${volatility.direction})`,
      `CURRENT PRICE: $${volatility.currentPrice}`,
      `PREVIOUS PRICE (15min ago): $${volatility.previousPrice}`,
      "",
      "RECENT NEWS:",
      newsText,
    ].join("\n");

    const response = await client.chat({
      model: "default",
      system: ANALYST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          name: logAnalysisTool.name,
          description: logAnalysisTool.description,
          parameters: logAnalysisTool.parameters,
        },
      ],
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const call of response.toolCalls) {
        if (call.name === LOG_ANALYSIS_TOOL_NAME) {
          const result = await executeLogAnalysisTool(call.arguments as { summary: string });
          console.log(`  [0G] ${result.content[0].text}`);
        }
      }
    }

    if (response.content) {
      console.log(`  [AI] ${response.content}`);
    }
  } finally {
    await client.disconnect();
  }
}

async function scanOnce(): Promise<void> {
  console.log(`\n[${new Date().toISOString()}] Scanning ${WATCHLIST.length} tokens...`);

  for (const symbol of WATCHLIST) {
    try {
      const volatility = await checkPriceVolatility(symbol);

      if (!volatility.triggered) {
        console.log(
          `  ${symbol}: ${volatility.changePercent > 0 ? "+" : ""}${volatility.changePercent}% — stable`,
        );
        continue;
      }

      console.log(
        `  ${symbol}: ${volatility.changePercent > 0 ? "+" : ""}${volatility.changePercent}% — VOLATILITY DETECTED (${volatility.direction})`,
      );

      let newsText: string;
      try {
        const articles = await fetchRecentNews(symbol);
        newsText = formatNewsForPrompt(articles);
      } catch (newsErr) {
        const msg =
          newsErr instanceof Error ? newsErr.message : "Unknown news error";
        console.error(`  [NEWS ERROR] ${msg} — proceeding with no news context`);
        newsText = "News fetch failed. Analyze based on price action alone.";
      }

      try {
        await runAgentAnalysis(volatility, newsText);
      } catch (agentErr) {
        const msg =
          agentErr instanceof Error ? agentErr.message : "Unknown agent error";
        console.error(`  [AGENT ERROR] ${msg}`);
      }
    } catch (priceErr) {
      const msg =
        priceErr instanceof Error ? priceErr.message : "Unknown price error";
      console.error(`  [BYBIT ERROR] ${symbol}: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  await runSetupWizard();

  console.log("Trading Researcher Bot — Online");
  console.log(`Monitoring: ${WATCHLIST.join(", ")}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`Volatility threshold: ±5%`);
  console.log("─".repeat(50));

  await scanOnce();

  setInterval(async () => {
    try {
      await scanOnce();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown loop error";
      console.error(`[LOOP ERROR] ${msg}`);
    }
  }, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
