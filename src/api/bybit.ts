import { RestClientV5 } from "bybit-api";

export interface VolatilityResult {
  triggered: boolean;
  symbol: string;
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  direction: "pump" | "dump" | "stable";
}

const VOLATILITY_THRESHOLD = 5;
const LOOKBACK_INTERVAL = "15"; // 15-minute kline
const KLINE_LIMIT = 2; // current candle + previous candle

let client: RestClientV5 | null = null;

function getClient(): RestClientV5 {
  if (!client) {
    client = new RestClientV5({
      key: process.env.BYBIT_API_KEY,
      secret: process.env.BYBIT_SECRET,
    });
  }
  return client;
}

export async function checkPriceVolatility(
  symbol: string,
): Promise<VolatilityResult> {
  const api = getClient();

  const response = await api.getKline({
    category: "spot",
    symbol,
    interval: LOOKBACK_INTERVAL,
    limit: KLINE_LIMIT,
  });

  if (response.retCode !== 0) {
    throw new Error(
      `Bybit API error (${response.retCode}): ${response.retMsg}`,
    );
  }

  const candles = response.result.list;

  if (!candles || candles.length < KLINE_LIMIT) {
    throw new Error(`Insufficient kline data for ${symbol}`);
  }

  // Bybit returns candles newest-first: [0] = current, [1] = previous
  const currentClose = parseFloat(candles[0][4]);
  const previousOpen = parseFloat(candles[1][1]);

  const changePercent =
    ((currentClose - previousOpen) / previousOpen) * 100;
  const absChange = Math.abs(changePercent);

  let direction: VolatilityResult["direction"] = "stable";
  if (changePercent >= VOLATILITY_THRESHOLD) direction = "pump";
  else if (changePercent <= -VOLATILITY_THRESHOLD) direction = "dump";

  return {
    triggered: absChange >= VOLATILITY_THRESHOLD,
    symbol,
    currentPrice: currentClose,
    previousPrice: previousOpen,
    changePercent: parseFloat(changePercent.toFixed(2)),
    direction,
  };
}
