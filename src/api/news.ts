import axios from "axios";

export interface NewsArticle {
  title: string;
  snippet: string;
  source: string;
  link: string;
}

const SERPER_ENDPOINT = "https://google.serper.dev/news";
const MAX_ARTICLES = 5;

export async function fetchRecentNews(
  symbol: string,
): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    throw new Error("NEWS_API_KEY is not set in environment");
  }

  const cleanSymbol = symbol.replace(/USDT$|USD$|BUSD$/i, "");
  const query = `${cleanSymbol} crypto price news`;

  const response = await axios.post(
    SERPER_ENDPOINT,
    {
      q: query,
      num: MAX_ARTICLES,
      tbs: "qdr:d", // last 24 hours
    },
    {
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 10_000,
    },
  );

  const articles: NewsArticle[] = (response.data.news ?? [])
    .slice(0, MAX_ARTICLES)
    .map((item: Record<string, string>) => ({
      title: item.title ?? "Untitled",
      snippet: item.snippet ?? "",
      source: item.source ?? "Unknown",
      link: item.link ?? "",
    }));

  return articles;
}

export function formatNewsForPrompt(articles: NewsArticle[]): string {
  if (articles.length === 0) {
    return "No recent news articles were found for this token.";
  }

  return articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title}\n    Source: ${a.source}\n    ${a.snippet}`,
    )
    .join("\n\n");
}
