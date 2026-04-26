const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const MARKET_PROVIDER = (process.env.MARKET_PROVIDER || "auto").toLowerCase();
const SEARCH_METADATA = new Map();
const API_CACHE = new Map();
const QUOTE_TTL_MS = 45_000;
const SEARCH_TTL_MS = 90_000;
const FUNDAMENTAL_TTL_MS = 6 * 60 * 60 * 1000;

const CATALOG = [
  ["AAPL", "Apple Inc.", "EQUITY", "NASDAQ", "Technology", "Consumer Electronics", "Quality Growth"],
  ["MSFT", "Microsoft Corporation", "EQUITY", "NASDAQ", "Technology", "Software Infrastructure", "Quality Growth"],
  ["NVDA", "NVIDIA Corporation", "EQUITY", "NASDAQ", "Technology", "Semiconductors", "High Growth"],
  ["AMZN", "Amazon.com, Inc.", "EQUITY", "NASDAQ", "Consumer Cyclical", "Internet Retail", "Growth"],
  ["GOOGL", "Alphabet Inc.", "EQUITY", "NASDAQ", "Communication Services", "Internet Content and Information", "Growth at Reasonable Price"],
  ["META", "Meta Platforms, Inc.", "EQUITY", "NASDAQ", "Communication Services", "Internet Content and Information", "Growth"],
  ["TSLA", "Tesla, Inc.", "EQUITY", "NASDAQ", "Consumer Cyclical", "Auto Manufacturers", "High Growth"],
  ["NFLX", "Netflix, Inc.", "EQUITY", "NASDAQ", "Communication Services", "Entertainment", "Growth"],
  ["AMD", "Advanced Micro Devices, Inc.", "EQUITY", "NASDAQ", "Technology", "Semiconductors", "High Growth"],
  ["INTC", "Intel Corporation", "EQUITY", "NASDAQ", "Technology", "Semiconductors", "Value Cyclical"],
  ["JPM", "JPMorgan Chase & Co.", "EQUITY", "NYSE", "Financial Services", "Banks Diversified", "Value"],
  ["BAC", "Bank of America Corporation", "EQUITY", "NYSE", "Financial Services", "Banks Diversified", "Value"],
  ["V", "Visa Inc.", "EQUITY", "NYSE", "Financial Services", "Credit Services", "Quality Growth"],
  ["MA", "Mastercard Incorporated", "EQUITY", "NYSE", "Financial Services", "Credit Services", "Quality Growth"],
  ["JNJ", "Johnson & Johnson", "EQUITY", "NYSE", "Healthcare", "Drug Manufacturers General", "Defensive"],
  ["UNH", "UnitedHealth Group Incorporated", "EQUITY", "NYSE", "Healthcare", "Healthcare Plans", "Defensive Growth"],
  ["LLY", "Eli Lilly and Company", "EQUITY", "NYSE", "Healthcare", "Drug Manufacturers General", "High Growth"],
  ["PFE", "Pfizer Inc.", "EQUITY", "NYSE", "Healthcare", "Drug Manufacturers General", "Defensive Value"],
  ["WMT", "Walmart Inc.", "EQUITY", "NYSE", "Consumer Defensive", "Discount Stores", "Defensive"],
  ["COST", "Costco Wholesale Corporation", "EQUITY", "NASDAQ", "Consumer Defensive", "Discount Stores", "Quality Growth"],
  ["KO", "The Coca-Cola Company", "EQUITY", "NYSE", "Consumer Defensive", "Beverages Non-Alcoholic", "Defensive"],
  ["PEP", "PepsiCo, Inc.", "EQUITY", "NASDAQ", "Consumer Defensive", "Beverages Non-Alcoholic", "Defensive"],
  ["XOM", "Exxon Mobil Corporation", "EQUITY", "NYSE", "Energy", "Oil and Gas Integrated", "Value Cyclical"],
  ["CVX", "Chevron Corporation", "EQUITY", "NYSE", "Energy", "Oil and Gas Integrated", "Value Cyclical"],
  ["BA", "The Boeing Company", "EQUITY", "NYSE", "Industrials", "Aerospace and Defense", "Cyclical"],
  ["LMT", "Lockheed Martin Corporation", "EQUITY", "NYSE", "Industrials", "Aerospace and Defense", "Defensive"],
  ["DIS", "The Walt Disney Company", "EQUITY", "NYSE", "Communication Services", "Entertainment", "Cyclical"],
  ["NKE", "NIKE, Inc.", "EQUITY", "NYSE", "Consumer Cyclical", "Footwear and Accessories", "Cyclical Growth"],
  ["MCD", "McDonald's Corporation", "EQUITY", "NYSE", "Consumer Cyclical", "Restaurants", "Defensive Growth"],
  ["SPY", "SPDR S&P 500 ETF Trust", "ETF", "NYSE Arca", "Broad Market", "Large Blend ETF", "Index"],
  ["QQQ", "Invesco QQQ Trust", "ETF", "NASDAQ", "Technology Tilt", "Large Growth ETF", "Index Growth"],
  ["VTI", "Vanguard Total Stock Market ETF", "ETF", "NYSE Arca", "Broad Market", "Total Market ETF", "Index"],
  ["VNQ", "Vanguard Real Estate ETF", "ETF", "NYSE Arca", "Real Estate", "REIT ETF", "REIT"],
  ["GLD", "SPDR Gold Shares", "ETF", "NYSE Arca", "Commodities", "Gold ETF", "Defensive"],
  ["SLV", "iShares Silver Trust", "ETF", "NYSE Arca", "Commodities", "Silver ETF", "Commodity"],
  ["BTC-USD", "Bitcoin USD", "CRYPTOCURRENCY", "CCC", "Crypto", "Digital Asset", "High Risk"],
  ["ETH-USD", "Ethereum USD", "CRYPTOCURRENCY", "CCC", "Crypto", "Digital Asset", "High Risk"]
].map(([symbol, name, assetType, exchange, sector, industry, style]) => ({
  symbol,
  name,
  assetType,
  exchange,
  sector,
  industry,
  style
}));

const CATALOG_BY_SYMBOL = Object.fromEntries(CATALOG.map((asset) => [asset.symbol, asset]));
const SECTOR_PE = {
  Technology: 30,
  "Communication Services": 22,
  "Consumer Cyclical": 24,
  "Financial Services": 13,
  Healthcare: 21,
  "Consumer Defensive": 23,
  Energy: 12,
  Industrials: 20,
  "Real Estate": 18,
  "Broad Market": 22,
  Commodities: null,
  Crypto: null
};

const SECTOR_BENCHMARKS = {
  Technology: { pe: 30, profitMargin: 22, beta: 1.15 },
  "Communication Services": { pe: 22, profitMargin: 16, beta: 1.05 },
  "Consumer Cyclical": { pe: 24, profitMargin: 9, beta: 1.15 },
  "Financial Services": { pe: 13, profitMargin: 24, beta: 1.05 },
  Healthcare: { pe: 21, profitMargin: 14, beta: 0.9 },
  "Consumer Defensive": { pe: 23, profitMargin: 8, beta: 0.75 },
  Energy: { pe: 12, profitMargin: 10, beta: 0.95 },
  Industrials: { pe: 20, profitMargin: 9, beta: 1.05 },
  "Real Estate": { pe: 18, profitMargin: 18, beta: 0.95 },
  "Broad Market": { pe: 22, profitMargin: 11, beta: 1 },
  Crypto: { pe: null, profitMargin: null, beta: 1.8 }
};

class MarketProvider {
  constructor(name) {
    this.name = name;
  }

  async search() {
    throw new Error("search not implemented");
  }

  async getAsset() {
    throw new Error("getAsset not implemented");
  }

  async getBatch(symbols) {
    return Promise.all(symbols.map((symbol) => this.getAsset(symbol)));
  }
}

class HybridMarketProvider extends MarketProvider {
  constructor(finnhubKey) {
    super(finnhubKey ? "Finnhub market data + Yahoo fallback" : "Yahoo Search + Stooq delayed quote");
    this.quoteProvider = new YahooFinanceProvider();
    this.finnhubProvider = finnhubKey ? new FinnhubProvider(finnhubKey) : null;
    this.lastWarning = "";
  }

  async search(query, filters = {}) {
    this.lastWarning = "";
    if (this.finnhubProvider) {
      try {
        return this.finnhubProvider.search(query, filters);
      } catch (error) {
        this.lastWarning = userSafeError(error);
      }
    }
    try {
      return await this.quoteProvider.search(query, filters);
    } catch (error) {
      this.lastWarning = userSafeError(error);
      return filterResults(fallbackSearch(query), filters).slice(0, 24);
    }
  }

  async getAsset(symbol) {
    const normalized = normalizeSymbol(symbol);
    const quoteAsset = await this.quoteProvider.getAsset(normalized);
    if (!this.finnhubProvider || quoteAsset.assetType === "CRYPTOCURRENCY") {
      return normalizeAsset({
        ...quoteAsset,
        provider: this.name,
        sourceNote: quoteAsset.sourceNote
      });
    }
    const fundamentals = await cached(`finnhub-market-overlay:${normalized}`, FUNDAMENTAL_TTL_MS, () => {
      return this.finnhubProvider.getMarketOverlay(normalized);
    }).catch((error) => ({
      sourceNote: `Finnhub data unavailable. ${userSafeError(error)}`
    }));
    return normalizeAsset(deepMergeAsset(quoteAsset, fundamentals, {
      provider: this.name,
      live: fundamentals.price ? true : quoteAsset.live,
      lastUpdated: fundamentals.lastUpdated || quoteAsset.lastUpdated,
      sourceNote: fundamentals.sourceNote
        ? `${quoteAsset.sourceNote} ${fundamentals.sourceNote}`
        : "Yahoo-compatible data is used as fallback; Finnhub quote/profile/basic financials are primary when returned."
    }));
  }
}

class YahooFinanceProvider extends MarketProvider {
  constructor() {
    super("Yahoo Search + Stooq delayed quote");
  }

  async yahoo(pathname, params = {}) {
    const url = new URL(pathname, "https://query1.finance.yahoo.com");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url);
  }

  async yahoo2(pathname, params = {}) {
    const url = new URL(pathname, "https://query2.finance.yahoo.com");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url);
  }

  async search(query, filters = {}) {
    const response = await this.yahoo2("/v1/finance/search", {
      q: query || "market",
      quotesCount: "20",
      newsCount: "0",
      enableFuzzyQuery: "true",
      quotesQueryId: "tss_match_phrase_query"
    });
    const liveResults = (response.quotes || [])
      .filter((quote) => quote.symbol && quote.quoteType)
      .map((quote) => enrichSearchResult({
        symbol: quote.symbol,
        name: quote.longname || quote.shortname || quote.name || quote.symbol,
        assetType: normalizeType(quote.quoteType || quote.typeDisp),
        exchange: quote.exchDisp || quote.exchange || "Unknown",
        sector: quote.sector,
        industry: quote.industry,
        provider: this.name,
        isLiveSearch: true
      }));
    const results = filterResults(mergeSearchResults(liveResults, fallbackSearch(query)), filters).slice(0, 24);
    results.forEach((asset) => SEARCH_METADATA.set(asset.symbol, asset));
    return results;
  }

  async getAsset(symbol) {
    const normalized = normalizeSymbol(symbol);
    const [quote, fundamentals, history, news] = await Promise.all([
      this.getQuote(normalized),
      this.getFundamentals(normalized).catch((error) => ({ error: error.message })),
      this.getHistory(normalized).catch(() => []),
      this.getNews(normalized).catch(() => [])
    ]);
    return normalizeAsset({
      ...quote,
      ...fundamentals,
      history,
      news,
      sources: mergeSources(
        quote.sources,
        fundamentals.sources,
        history.length ? sourceMap("Yahoo chart history", ["history"]) : {},
        news.length ? sourceMap("Yahoo Finance news", ["news"]) : {}
      ),
      provider: this.name,
      live: Boolean(quote.price),
      sourceNote: "Live or delayed market quote from the active no-key provider. Fundamentals depend on provider availability; configure Finnhub or Alpha Vantage for deeper ratios."
    });
  }

  async getQuote(symbol) {
    try {
      const response = await this.yahoo("/v7/finance/quote", { symbols: symbol });
      const quote = response.quoteResponse?.result?.[0];
      if (!quote) throw new Error(`No live quote returned for ${symbol}`);
      const catalog = CATALOG_BY_SYMBOL[symbol] || SEARCH_METADATA.get(symbol) || {};
      return {
        symbol: quote.symbol || symbol,
        name: quote.longName || quote.shortName || catalog.name || symbol,
        assetType: normalizeType(quote.quoteType || catalog.assetType),
        exchange: quote.fullExchangeName || quote.exchange || catalog.exchange || "Unknown",
        currency: quote.currency || "USD",
        marketState: quote.marketState,
        price: numberOrNull(quote.regularMarketPrice ?? quote.postMarketPrice ?? quote.preMarketPrice),
        previousClose: numberOrNull(quote.regularMarketPreviousClose ?? quote.regularMarketOpen),
        change: numberOrNull(quote.regularMarketChange),
        changePercent: numberOrNull(quote.regularMarketChangePercent),
        marketCap: numberOrNull(quote.marketCap),
        peRatio: numberOrNull(quote.trailingPE ?? quote.forwardPE),
        forwardPe: numberOrNull(quote.forwardPE),
        eps: numberOrNull(quote.epsTrailingTwelveMonths ?? quote.epsForward),
        dividendYield: percentMaybe(quote.trailingAnnualDividendYield ?? quote.dividendYield),
        week52High: numberOrNull(quote.fiftyTwoWeekHigh),
        week52Low: numberOrNull(quote.fiftyTwoWeekLow),
        open: numberOrNull(quote.regularMarketOpen),
        dayHigh: numberOrNull(quote.regularMarketDayHigh),
        dayLow: numberOrNull(quote.regularMarketDayLow),
        volume: numberOrNull(quote.regularMarketVolume ?? quote.averageDailyVolume3Month),
        averageVolume: numberOrNull(quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day),
        lastUpdated: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
        sources: sourceMap("Yahoo quote", [
          "price", "previousClose", "change", "changePercent", "marketCap", "peRatio", "forwardPe",
          "eps", "dividendYield", "week52High", "week52Low", "open", "dayHigh", "dayLow",
          "volume", "averageVolume", "exchange", "currency"
        ])
      };
    } catch {
      try {
        return await this.getChartQuote(symbol);
      } catch {
        return this.getStooqQuote(symbol);
      }
    }
  }

  async getChartQuote(symbol) {
    const response = await this.yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      range: "5d",
      interval: "1d",
      includePrePost: "false"
    });
    const result = response.chart?.result?.[0];
    const meta = result?.meta || {};
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = (quote.close || []).filter((value) => numberOrNull(value) !== null);
    const opens = (quote.open || []).filter((value) => numberOrNull(value) !== null);
    const highs = (quote.high || []).filter((value) => numberOrNull(value) !== null);
    const lows = (quote.low || []).filter((value) => numberOrNull(value) !== null);
    const volumes = (quote.volume || []).filter((value) => numberOrNull(value) !== null);
    const price = numberOrNull(meta.regularMarketPrice ?? closes.at(-1));
    const previousClose = numberOrNull(closes.at(-2) ?? meta.previousClose ?? meta.chartPreviousClose);
    if (price === null) throw new Error(`No chart quote returned for ${symbol}`);
    const catalog = CATALOG_BY_SYMBOL[symbol] || SEARCH_METADATA.get(symbol) || {};
    const change = previousClose !== null ? price - previousClose : null;
    return {
      symbol,
      name: meta.longName || meta.shortName || catalog.name || symbol,
      assetType: normalizeType(meta.instrumentType || catalog.assetType),
      exchange: meta.fullExchangeName || meta.exchangeName || catalog.exchange || "Unknown",
      sector: catalog.sector,
      industry: catalog.industry,
      currency: meta.currency || "USD",
      marketState: meta.currentTradingPeriod ? "Chart quote" : "Delayed quote",
      price,
      previousClose,
      change,
      changePercent: previousClose ? (change / previousClose) * 100 : null,
      marketCap: null,
      peRatio: null,
      week52High: null,
      week52Low: null,
      open: numberOrNull(opens.at(-1)),
      dayHigh: numberOrNull(highs.at(-1)),
      dayLow: numberOrNull(lows.at(-1)),
      volume: numberOrNull(meta.regularMarketVolume ?? volumes.at(-1)),
      averageVolume: volumes.length ? Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length) : null,
      lastUpdated: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      sources: sourceMap("Yahoo chart quote", [
        "price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow",
        "volume", "averageVolume", "exchange", "currency"
      ])
    };
  }

  async getStooqQuote(symbol) {
    const stooqSymbol = toStooqSymbol(symbol);
    const url = new URL("https://stooq.com/q/l/");
    url.searchParams.set("s", stooqSymbol);
    url.searchParams.set("f", "sd2t2ohlcvp");
    url.searchParams.set("h", "");
    url.searchParams.set("e", "json");
    const response = await fetchJson(url);
    const row = response.symbols?.[0];
    const close = numberOrNull(row?.close);
    if (!row || close === null) throw new Error(`No delayed quote returned for ${symbol}`);
    const previousClose = numberOrNull(row.previous);
    const open = numberOrNull(row.open);
    const change = previousClose !== null ? close - previousClose : open !== null ? close - open : null;
    const changePercent = previousClose ? (change / previousClose) * 100 : open ? (change / open) * 100 : null;
    const catalog = CATALOG_BY_SYMBOL[symbol] || SEARCH_METADATA.get(symbol) || {};
    return {
      symbol,
      name: catalog.name || symbol,
      assetType: normalizeType(catalog.assetType),
      exchange: catalog.exchange || "Unknown",
      sector: catalog.sector,
      industry: catalog.industry,
      currency: "USD",
      marketState: "Delayed quote",
      price: close,
      previousClose,
      change,
      changePercent,
      marketCap: null,
      peRatio: null,
      week52High: null,
      week52Low: null,
      open,
      dayHigh: numberOrNull(row.high),
      dayLow: numberOrNull(row.low),
      volume: numberOrNull(row.volume),
      lastUpdated: row.date && row.time ? new Date(`${row.date}T${row.time}Z`).toISOString() : new Date().toISOString(),
      sources: sourceMap("Stooq delayed quote", [
        "price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow", "volume"
      ])
    };
  }

  async getFundamentals(symbol) {
    const response = await this.yahoo2(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
      modules: "assetProfile,summaryDetail,financialData,defaultKeyStatistics,price"
    });
    const result = response.quoteSummary?.result?.[0] || {};
    const profile = result.assetProfile || {};
    const detail = result.summaryDetail || {};
    const financial = result.financialData || {};
    const stats = result.defaultKeyStatistics || {};
    const catalog = CATALOG_BY_SYMBOL[symbol] || {};
    return {
      sector: profile.sector || catalog.sector || "Unknown",
      industry: profile.industry || catalog.industry || "Unknown",
      summary: profile.longBusinessSummary,
      profitMargin: raw(financial.profitMargins),
      revenueGrowth: percentRaw(financial.revenueGrowth),
      earningsGrowth: percentRaw(financial.earningsGrowth),
      debtToEquity: normalizeDebt(raw(financial.debtToEquity)),
      currentRatio: raw(financial.currentRatio),
      beta: raw(stats.beta),
      forwardPe: raw(stats.forwardPE),
      priceToBook: raw(stats.priceToBook),
      eps: raw(stats.trailingEps ?? stats.forwardEps),
      dividendYield: percentRaw(detail.dividendYield),
      averageVolume: raw(detail.averageVolume ?? detail.averageDailyVolume10Day),
      analystRating: financial.recommendationKey || financial.recommendationMean?.fmt || null,
      targetMeanPrice: raw(financial.targetMeanPrice),
      week52High: raw(detail.fiftyTwoWeekHigh),
      week52Low: raw(detail.fiftyTwoWeekLow),
      marketCap: raw(detail.marketCap),
      peRatio: raw(detail.trailingPE),
      volume: raw(detail.volume),
      sectorPe: SECTOR_PE[profile.sector || catalog.sector] ?? null,
      style: catalog.style || inferStyle(profile.sector, raw(stats.beta), raw(detail.trailingPE)),
      sources: sourceMap("Yahoo fundamentals", [
        "sector", "industry", "summary", "profitMargin", "revenueGrowth", "earningsGrowth",
        "debtToEquity", "currentRatio", "beta", "forwardPe", "priceToBook", "eps",
        "dividendYield", "averageVolume", "targetMeanPrice", "week52High", "week52Low",
        "marketCap", "peRatio", "volume"
      ])
    };
  }

  async getHistory(symbol) {
    const response = await this.yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      range: "1y",
      interval: "1d",
      includePrePost: "false",
      events: "history"
    });
    const result = response.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    return timestamps.map((time, index) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      close: numberOrNull(closes[index])
    })).filter((point) => point.close);
  }

  async getNews(symbol) {
    const response = await this.yahoo2("/v1/finance/search", {
      q: symbol,
      quotesCount: "0",
      newsCount: "5"
    });
    return (response.news || []).slice(0, 5).map((item) => normalizeNews({
      headline: item.title,
      source: item.publisher,
      date: item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toISOString() : null,
      summary: item.summary || item.title,
      url: item.link
    }));
  }
}

class FinnhubProvider extends MarketProvider {
  constructor(apiKey) {
    super("Finnhub");
    this.apiKey = apiKey;
  }

  async request(pathname, params = {}) {
    if (!this.apiKey) throw new Error("FINNHUB_API_KEY is not configured");
    const url = new URL(pathname, "https://finnhub.io/api/v1/");
    Object.entries({ ...params, token: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url);
  }

  async search(query, filters = {}) {
    const response = await this.request("search", { q: query || "market" });
    const results = (response.result || []).map((item) => enrichSearchResult({
      symbol: item.symbol,
      name: item.description || item.displaySymbol || item.symbol,
      assetType: "EQUITY",
      exchange: item.type || "Unknown",
      provider: this.name,
      isLiveSearch: true
    }));
    return filterResults(mergeSearchResults(results, fallbackSearch(query)), filters).slice(0, 24);
  }

  async getFundamentalOverlay(symbol) {
    return this.getMarketOverlay(symbol);
  }

  async getMarketOverlay(symbol) {
    const normalized = normalizeSymbol(symbol);
    const today = new Date();
    const future = new Date(today);
    future.setDate(today.getDate() + 120);
    const [quote, profile, metric, earningsHistory, earningsCalendar] = await Promise.all([
      this.request("quote", { symbol: normalized }).catch(() => ({})),
      this.request("stock/profile2", { symbol: normalized }).catch(() => ({})),
      this.request("stock/metric", { symbol: normalized, metric: "all" }).catch(() => ({ metric: {} })),
      this.request("stock/earnings", { symbol: normalized, limit: "4" }).catch(() => []),
      this.request("calendar/earnings", {
        symbol: normalized,
        from: today.toISOString().slice(0, 10),
        to: future.toISOString().slice(0, 10)
      }).catch(() => ({ earningsCalendar: [] }))
    ]);
    const catalog = CATALOG_BY_SYMBOL[normalized] || {};
    const metrics = metric.metric || {};
    const recentEarnings = Array.isArray(earningsHistory) ? earningsHistory[0] : null;
    const nextEarnings = earningsCalendar.earningsCalendar?.[0] || null;
    const currentPrice = numberOrNull(quote.c);
    return {
      symbol: normalized,
      name: profile.name || catalog.name || normalized,
      exchange: profile.exchange || catalog.exchange || "Unknown",
      sector: catalog.sector || profile.finnhubIndustry || "Unknown",
      industry: profile.finnhubIndustry || catalog.industry || "Unknown",
      logo: profile.logo || "",
      currency: profile.currency || "USD",
      price: currentPrice,
      previousClose: numberOrNull(quote.pc),
      change: numberOrNull(quote.d),
      changePercent: numberOrNull(quote.dp),
      open: numberOrNull(quote.o),
      dayHigh: numberOrNull(quote.h),
      dayLow: numberOrNull(quote.l),
      marketCap: profile.marketCapitalization ? profile.marketCapitalization * 1_000_000 : firstMetric(metrics, ["marketCapitalization"]),
      peRatio: firstMetric(metrics, ["peNormalizedAnnual", "peTTM"]),
      forwardPe: firstMetric(metrics, ["forwardPE"]),
      priceToBook: firstMetric(metrics, ["pbAnnual", "pbQuarterly"]),
      eps: firstMetric(metrics, ["epsTTM", "epsNormalizedAnnual", "epsInclExtraItemsTTM"]),
      dividendYield: percentMaybe(firstMetric(metrics, ["dividendYieldIndicatedAnnual", "dividendYield5Y"])),
      week52High: firstMetric(metrics, ["52WeekHigh"]),
      week52Low: firstMetric(metrics, ["52WeekLow"]),
      averageVolume: normalizeAverageVolume(firstMetric(metrics, ["10DayAverageTradingVolume", "3MonthAverageTradingVolume"])),
      revenueGrowth: percentMaybe(firstMetric(metrics, ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"])),
      earningsGrowth: percentMaybe(firstMetric(metrics, ["epsGrowthTTMYoy", "epsGrowthQuarterlyYoy"])),
      profitMargin: percentMaybe(firstMetric(metrics, ["netProfitMarginTTM", "netProfitMarginAnnual"])),
      operatingMargin: percentMaybe(firstMetric(metrics, ["operatingMarginTTM", "operatingMarginAnnual"])),
      debtToEquity: normalizeDebt(firstMetric(metrics, ["totalDebt/totalEquityAnnual", "totalDebt/totalEquityQuarterly"])),
      returnOnEquity: percentMaybe(firstMetric(metrics, ["roeTTM", "roeRfy"])),
      currentRatio: firstMetric(metrics, ["currentRatioAnnual", "currentRatioQuarterly"]),
      beta: firstMetric(metrics, ["beta"]),
      nextEarningsDate: nextEarnings?.date || null,
      earningsSurprise: recentEarnings && numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise) !== null
        ? numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise)
        : null,
      recentEarningsPeriod: recentEarnings?.period || null,
      sectorPe: SECTOR_PE[catalog.sector || profile.finnhubIndustry] ?? null,
      style: catalog.style || "Unknown",
      live: Boolean(currentPrice),
      lastUpdated: quote.t ? new Date(quote.t * 1000).toISOString() : null,
      sources: mergeSources(
        sourceMap("Finnhub", ["price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow", "lastUpdated"]),
        sourceMap("Finnhub", [
        "name", "exchange", "sector", "industry", "logo", "currency", "marketCap", "peRatio", "forwardPe",
        "priceToBook", "eps", "dividendYield", "week52High", "week52Low", "averageVolume",
        "revenueGrowth", "earningsGrowth", "profitMargin", "operatingMargin", "debtToEquity",
        "returnOnEquity", "currentRatio", "beta", "nextEarningsDate", "earningsSurprise",
        "recentEarningsPeriod"
        ])
      ),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sourceNote: "Finnhub quote, profile, and basic financials returned the available fields. Fundamental metrics may lag quarterly filings even when quote data is intraday."
    };
  }

  async getAsset(symbol) {
    const normalized = normalizeSymbol(symbol);
    const to = Math.floor(Date.now() / 1000);
    const from = to - 365 * 24 * 60 * 60;
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 21);
    const [quote, profile, metric, candles, news, earningsHistory, earningsCalendar] = await Promise.all([
      this.request("quote", { symbol: normalized }),
      this.request("stock/profile2", { symbol: normalized }).catch(() => ({})),
      this.request("stock/metric", { symbol: normalized, metric: "all" }).catch(() => ({ metric: {} })),
      this.request("stock/candle", { symbol: normalized, resolution: "D", from, to }).catch(() => ({ s: "no_data" })),
      this.request("company-news", {
        symbol: normalized,
        from: start.toISOString().slice(0, 10),
        to: today.toISOString().slice(0, 10)
      }).catch(() => []),
      this.request("stock/earnings", { symbol: normalized, limit: "4" }).catch(() => []),
      this.request("calendar/earnings", {
        symbol: normalized,
        from: today.toISOString().slice(0, 10),
        to: new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      }).catch(() => ({ earningsCalendar: [] }))
    ]);
    const catalog = CATALOG_BY_SYMBOL[normalized] || {};
    const metrics = metric.metric || {};
    const recentEarnings = Array.isArray(earningsHistory) ? earningsHistory[0] : null;
    const nextEarnings = earningsCalendar.earningsCalendar?.[0] || null;
    return normalizeAsset({
      symbol: normalized,
      name: profile.name || catalog.name || normalized,
      assetType: catalog.assetType || "EQUITY",
      exchange: profile.exchange || catalog.exchange || "Unknown",
      sector: catalog.sector || profile.finnhubIndustry || "Unknown",
      industry: profile.finnhubIndustry || catalog.industry || "Unknown",
      logo: profile.logo || "",
      currency: profile.currency || "USD",
      price: numberOrNull(quote.c),
      previousClose: numberOrNull(quote.pc),
      change: numberOrNull(quote.d),
      changePercent: numberOrNull(quote.dp),
      open: numberOrNull(quote.o),
      dayHigh: numberOrNull(quote.h),
      dayLow: numberOrNull(quote.l),
      marketCap: profile.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null,
      peRatio: numberOrNull(metrics.peNormalizedAnnual ?? metrics.peTTM),
      forwardPe: numberOrNull(metrics.forwardPE),
      priceToBook: numberOrNull(metrics.pbAnnual ?? metrics.pbQuarterly),
      eps: numberOrNull(metrics.epsTTM ?? metrics.epsNormalizedAnnual ?? metrics.epsInclExtraItemsTTM),
      dividendYield: percentMaybe(metrics.dividendYieldIndicatedAnnual),
      week52High: numberOrNull(metrics["52WeekHigh"]),
      week52Low: numberOrNull(metrics["52WeekLow"]),
      volume: null,
      averageVolume: normalizeAverageVolume(metrics["10DayAverageTradingVolume"] ?? metrics["3MonthAverageTradingVolume"]),
      revenueGrowth: percentMaybe(metrics.revenueGrowthTTMYoy),
      earningsGrowth: percentMaybe(metrics.epsGrowthTTMYoy),
      profitMargin: percentMaybe(metrics.netProfitMarginTTM ?? metrics.netProfitMarginAnnual),
      operatingMargin: percentMaybe(metrics.operatingMarginTTM ?? metrics.operatingMarginAnnual),
      debtToEquity: normalizeDebt(metrics["totalDebt/totalEquityAnnual"] ?? metrics["totalDebt/totalEquityQuarterly"]),
      returnOnEquity: percentMaybe(metrics.roeTTM ?? metrics.roeRfy),
      currentRatio: numberOrNull(metrics.currentRatioAnnual ?? metrics.currentRatioQuarterly),
      beta: numberOrNull(metrics.beta),
      nextEarningsDate: nextEarnings?.date || null,
      earningsSurprise: recentEarnings && numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise) !== null
        ? numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise)
        : null,
      recentEarningsPeriod: recentEarnings?.period || null,
      sectorPe: SECTOR_PE[catalog.sector] ?? null,
      style: catalog.style || "Unknown",
      history: candles.s === "ok" ? candles.t.map((time, index) => ({
        date: new Date(time * 1000).toISOString().slice(0, 10),
        close: numberOrNull(candles.c[index])
      })).filter((point) => point.close) : [],
      news: news.slice(0, 5).map((item) => normalizeNews({
        headline: item.headline,
        source: item.source,
        date: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
        summary: item.summary,
        url: item.url
      })),
      provider: this.name,
      live: Boolean(quote.c),
      lastUpdated: quote.t ? new Date(quote.t * 1000).toISOString() : new Date().toISOString(),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sources: mergeSources(
        sourceMap("Finnhub", ["price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow", "lastUpdated"]),
        sourceMap("Finnhub", [
          "name", "exchange", "sector", "industry", "logo", "currency", "marketCap", "peRatio", "forwardPe",
          "priceToBook", "eps", "dividendYield", "week52High", "week52Low", "averageVolume",
          "revenueGrowth", "earningsGrowth", "profitMargin", "operatingMargin", "debtToEquity",
          "returnOnEquity", "currentRatio", "beta", "nextEarningsDate", "earningsSurprise",
          "recentEarningsPeriod"
        ]),
        candles.s === "ok" ? sourceMap("Finnhub price history", ["history"]) : {},
        news.length ? sourceMap("Finnhub news", ["news"]) : {}
      ),
      sourceNote: "Live quote and news from Finnhub. Fundamentals use Finnhub company metrics where available."
    });
  }
}

class AlphaVantageProvider extends MarketProvider {
  constructor(apiKey) {
    super("Alpha Vantage");
    this.apiKey = apiKey;
  }

  async request(params) {
    if (!this.apiKey) throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
    const url = new URL("https://www.alphavantage.co/query");
    Object.entries({ ...params, apikey: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const json = await fetchJson(url);
    if (json.Note || json.Information) throw new Error(json.Note || json.Information);
    return json;
  }

  async search(query, filters = {}) {
    const response = await this.request({ function: "SYMBOL_SEARCH", keywords: query || "market" });
    const results = (response.bestMatches || []).map((match) => enrichSearchResult({
      symbol: match["1. symbol"],
      name: match["2. name"],
      assetType: match["3. type"] || "EQUITY",
      exchange: match["4. region"] || "Unknown",
      provider: this.name,
      isLiveSearch: true
    }));
    return filterResults(mergeSearchResults(results, fallbackSearch(query)), filters).slice(0, 24);
  }

  async getAsset(symbol) {
    const normalized = normalizeSymbol(symbol);
    const [quoteResponse, overview, historyResponse, newsResponse] = await Promise.all([
      this.request({ function: "GLOBAL_QUOTE", symbol: normalized }),
      this.request({ function: "OVERVIEW", symbol: normalized }).catch(() => ({})),
      this.request({ function: "TIME_SERIES_DAILY_ADJUSTED", symbol: normalized, outputsize: "compact" }).catch(() => ({})),
      this.request({ function: "NEWS_SENTIMENT", tickers: normalized, limit: "5" }).catch(() => ({ feed: [] }))
    ]);
    const quote = quoteResponse["Global Quote"] || {};
    const catalog = CATALOG_BY_SYMBOL[normalized] || {};
    const history = Object.entries(historyResponse["Time Series (Daily)"] || {}).slice(0, 100).reverse().map(([date, row]) => ({
      date,
      close: numberOrNull(row["4. close"])
    })).filter((point) => point.close);
    return normalizeAsset({
      symbol: normalized,
      name: overview.Name || catalog.name || normalized,
      assetType: overview.AssetType || catalog.assetType || "EQUITY",
      exchange: overview.Exchange || catalog.exchange || "Unknown",
      sector: overview.Sector || catalog.sector || "Unknown",
      industry: overview.Industry || catalog.industry || "Unknown",
      currency: overview.Currency || "USD",
      price: numberOrNull(quote["05. price"]),
      previousClose: numberOrNull(quote["08. previous close"]),
      change: numberOrNull(quote["09. change"]),
      changePercent: parsePercent(quote["10. change percent"]),
      marketCap: numberOrNull(overview.MarketCapitalization),
      peRatio: numberOrNull(overview.PERatio),
      forwardPe: numberOrNull(overview.ForwardPE),
      priceToBook: numberOrNull(overview.PriceToBookRatio),
      eps: numberOrNull(overview.EPS),
      dividendYield: percentMaybe(overview.DividendYield),
      week52High: numberOrNull(overview["52WeekHigh"]),
      week52Low: numberOrNull(overview["52WeekLow"]),
      volume: numberOrNull(quote["06. volume"]),
      averageVolume: null,
      revenueGrowth: null,
      earningsGrowth: numberOrNull(overview.QuarterlyEarningsGrowthYOY) ? Number(overview.QuarterlyEarningsGrowthYOY) * 100 : null,
      profitMargin: numberOrNull(overview.ProfitMargin) ? Number(overview.ProfitMargin) * 100 : null,
      operatingMargin: numberOrNull(overview.OperatingMarginTTM) ? Number(overview.OperatingMarginTTM) * 100 : null,
      debtToEquity: null,
      returnOnEquity: numberOrNull(overview.ReturnOnEquityTTM) ? Number(overview.ReturnOnEquityTTM) * 100 : null,
      beta: numberOrNull(overview.Beta),
      analystRating: overview.AnalystRatingStrongBuy ? "analyst data available" : null,
      sectorPe: SECTOR_PE[overview.Sector || catalog.sector] ?? null,
      style: catalog.style || inferStyle(overview.Sector, numberOrNull(overview.Beta), numberOrNull(overview.PERatio)),
      history,
      news: (newsResponse.feed || []).slice(0, 5).map((item) => normalizeNews({
        headline: item.title,
        source: item.source,
        date: item.time_published ? alphaDate(item.time_published) : null,
        summary: item.summary,
        url: item.url,
        sentiment: normalizeSentiment(item.overall_sentiment_label)
      })),
      provider: this.name,
      live: Boolean(quote["05. price"]),
      lastUpdated: new Date().toISOString(),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sources: mergeSources(
        sourceMap("Alpha Vantage quote", ["price", "previousClose", "change", "changePercent", "volume"]),
        sourceMap("Alpha Vantage overview", [
          "name", "assetType", "exchange", "sector", "industry", "currency", "marketCap", "peRatio",
          "forwardPe", "priceToBook", "eps", "dividendYield", "week52High", "week52Low",
          "earningsGrowth", "profitMargin", "operatingMargin", "returnOnEquity", "beta"
        ]),
        history.length ? sourceMap("Alpha Vantage history", ["history"]) : {},
        newsResponse.feed?.length ? sourceMap("Alpha Vantage news", ["news"]) : {}
      ),
      sourceNote: "Quote, overview, history, and news from Alpha Vantage."
    });
  }
}

function createProvider() {
  if (MARKET_PROVIDER === "auto") return new HybridMarketProvider(process.env.FINNHUB_API_KEY);
  if (MARKET_PROVIDER === "finnhub") return new HybridMarketProvider(process.env.FINNHUB_API_KEY);
  if (MARKET_PROVIDER === "alphavantage") return new AlphaVantageProvider(process.env.ALPHA_VANTAGE_API_KEY);
  return new YahooFinanceProvider();
}

const provider = createProvider();

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "OPTIONS") return send(response, 204, "");
    if (url.pathname === "/api/health") {
      return json(response, {
        ok: true,
        provider: provider.name,
        configuredProvider: MARKET_PROVIDER,
        status: provider.name.includes("Stooq") ? "live-or-delayed" : "live-when-provider-available",
        timestamp: new Date().toISOString(),
        fallbackCatalogSize: CATALOG.length,
        env: {
          finnhubConfigured: Boolean(process.env.FINNHUB_API_KEY),
          alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
          polygonConfigured: Boolean(process.env.POLYGON_API_KEY),
          twelveDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY)
        }
      });
    }
    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const filters = {
        type: url.searchParams.get("type") || "",
        sector: url.searchParams.get("sector") || "",
        industry: url.searchParams.get("industry") || "",
        exchange: url.searchParams.get("exchange") || ""
      };
      provider.lastWarning = "";
      const results = await cached(`search:${provider.name}:${query}:${JSON.stringify(filters)}`, SEARCH_TTL_MS, () => provider.search(query, filters));
      return json(response, {
        provider: provider.name,
        query,
        results,
        warning: provider.lastWarning || "",
        timestamp: new Date().toISOString()
      });
    }
    if (url.pathname === "/api/assets") {
      const symbols = (url.searchParams.get("symbols") || "").split(",").map(normalizeSymbol).filter(Boolean).slice(0, 12);
      if (!symbols.length) return json(response, { assets: [] });
      const assets = await settleAssets(symbols);
      return json(response, { provider: provider.name, assets, timestamp: new Date().toISOString() });
    }
    if (url.pathname.startsWith("/api/asset/")) {
      const symbol = decodeURIComponent(url.pathname.replace("/api/asset/", ""));
      if (!normalizeSymbol(symbol)) {
        return json(response, 400, structuredError("Enter a valid ticker or asset symbol.", "invalid_symbol"));
      }
      const asset = await getAssetWithFallback(symbol);
      return json(response, { provider: provider.name, asset, timestamp: new Date().toISOString() });
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    json(response, 500, structuredError(userSafeError(error), "provider_error"));
  }
}

if (require.main === module) {
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`Aurex server running at http://localhost:${PORT}`);
    console.log(`Market provider: ${provider.name}`);
  });
}

module.exports = handleRequest;

async function settleAssets(symbols) {
  const settled = await Promise.allSettled(symbols.map((symbol) => getAssetWithFallback(symbol)));
  return settled.map((result, index) => result.status === "fulfilled" ? result.value : fallbackAsset(symbols[index], result.reason?.message));
}

async function cached(key, ttlMs, loader) {
  const cachedEntry = API_CACHE.get(key);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < ttlMs) return cachedEntry.value;
  const value = await loader();
  API_CACHE.set(key, { value, timestamp: Date.now() });
  return value;
}

async function getAssetWithFallback(symbol) {
  const normalized = normalizeSymbol(symbol);
  return cached(`asset:${provider.name}:${normalized}`, QUOTE_TTL_MS, async () => {
    try {
      return await provider.getAsset(normalized);
    } catch (error) {
      return fallbackAsset(normalized, error.message);
    }
  });
}

function fallbackAsset(symbol, reason) {
  const normalized = normalizeSymbol(symbol);
  const catalog = CATALOG_BY_SYMBOL[normalized] || {
    symbol: normalized,
    name: normalized,
    assetType: "Unknown",
    exchange: "Unknown",
    sector: "Unknown",
    industry: "Unknown",
    style: "Unknown"
  };
  return normalizeAsset({
    ...catalog,
    price: null,
    change: null,
    changePercent: null,
    marketCap: null,
    peRatio: null,
    week52High: null,
    week52Low: null,
    open: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    averageVolume: null,
    eps: null,
    dividendYield: null,
    operatingMargin: null,
    returnOnEquity: null,
    nextEarningsDate: null,
    earningsSurprise: null,
    recentEarningsPeriod: null,
    history: [],
    news: [],
    provider: "Fallback metadata",
    live: false,
    lastUpdated: new Date().toISOString(),
    sourceNote: `Live market data unavailable. ${reason || "No provider response."}`
  });
}

function deepMergeAsset(base, overlay = {}, extra = {}) {
  const merged = { ...base };
  Object.entries(overlay).forEach(([key, value]) => {
    if (key === "sources") return;
    if (value !== null && value !== undefined && value !== "") merged[key] = value;
  });
  Object.entries(extra).forEach(([key, value]) => {
    if (key === "sources") return;
    if (value !== null && value !== undefined && value !== "") merged[key] = value;
  });
  merged.sources = mergeSources(base.sources, overlay.sources, extra.sources);
  return merged;
}

function sourceMap(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source]));
}

function mergeSources(...maps) {
  return Object.assign({}, ...maps.filter(Boolean));
}

function normalizeSources(sources, context = {}) {
  const normalized = { ...sources };
  if (!normalized.lastUpdated) normalized.lastUpdated = "Provider timestamp";
  if (!normalized.sectorPe && context.sector) normalized.sectorPe = "Estimated sector benchmark";
  if (!normalized.sectorBenchmark && context.sector) normalized.sectorBenchmark = "Estimated sector benchmark";
  if (!normalized.week52High && context.historyHigh !== null) normalized.week52High = "Derived from price history";
  if (!normalized.week52Low && context.historyLow !== null) normalized.week52Low = "Derived from price history";
  return normalized;
}

function missingReasons(sources, asset) {
  const fields = [
    "price", "change", "changePercent", "marketCap", "peRatio", "forwardPe", "eps", "beta",
    "dividendYield", "week52High", "week52Low", "volume", "averageVolume", "revenueGrowth",
    "earningsGrowth", "profitMargin", "operatingMargin", "debtToEquity", "returnOnEquity",
    "nextEarningsDate", "earningsSurprise", "open", "dayHigh", "dayLow"
  ];
  return Object.fromEntries(fields.filter((field) => {
    return asset[field] === null || asset[field] === undefined || asset[field] === "";
  }).map((field) => [field, "Unavailable from current provider."]));
}

function estimatedBenchmarks(sector) {
  const benchmark = SECTOR_BENCHMARKS[sector] || { pe: SECTOR_PE[sector] ?? null, profitMargin: 10, beta: 1 };
  return {
    pe: benchmark.pe,
    profitMargin: benchmark.profitMargin,
    beta: benchmark.beta,
    source: "Estimated sector benchmark"
  };
}

function normalizeAsset(asset) {
  const catalog = CATALOG_BY_SYMBOL[asset.symbol] || {};
  const change = numberOrNull(asset.change);
  const previousClose = numberOrNull(asset.previousClose);
  const price = numberOrNull(asset.price);
  const changePercent = numberOrNull(asset.changePercent ?? (previousClose && price ? ((price - previousClose) / previousClose) * 100 : null));
  const history = Array.isArray(asset.history) ? asset.history : [];
  const historyValues = history.map((point) => numberOrNull(point.close)).filter((value) => value !== null);
  const historyHigh = historyValues.length ? Math.max(...historyValues) : null;
  const historyLow = historyValues.length ? Math.min(...historyValues) : null;
  const sector = asset.sector || catalog.sector || "Unknown";
  const benchmarks = estimatedBenchmarks(sector);
  const sources = normalizeSources(asset.sources || {}, {
    historyHigh,
    historyLow,
    sector
  });
  const generatedAt = new Date().toISOString();
  return {
    symbol: asset.symbol,
    name: asset.name || catalog.name || asset.symbol,
    assetType: normalizeType(asset.assetType || catalog.assetType),
    exchange: asset.exchange || catalog.exchange || "Unknown",
    sector,
    industry: asset.industry || catalog.industry || "Unknown",
    logo: asset.logo || "",
    currency: asset.currency || "USD",
    price,
    previousClose,
    change,
    changePercent,
    marketCap: numberOrNull(asset.marketCap),
    peRatio: numberOrNull(asset.peRatio),
    forwardPe: numberOrNull(asset.forwardPe),
    priceToBook: numberOrNull(asset.priceToBook),
    eps: numberOrNull(asset.eps),
    dividendYield: numberOrNull(asset.dividendYield),
    week52High: numberOrNull(asset.week52High) ?? historyHigh,
    week52Low: numberOrNull(asset.week52Low) ?? historyLow,
    open: numberOrNull(asset.open),
    dayHigh: numberOrNull(asset.dayHigh),
    dayLow: numberOrNull(asset.dayLow),
    volume: numberOrNull(asset.volume),
    averageVolume: numberOrNull(asset.averageVolume),
    revenueGrowth: numberOrNull(asset.revenueGrowth),
    earningsGrowth: numberOrNull(asset.earningsGrowth),
    profitMargin: numberOrNull(asset.profitMargin),
    operatingMargin: numberOrNull(asset.operatingMargin),
    debtToEquity: numberOrNull(asset.debtToEquity),
    returnOnEquity: numberOrNull(asset.returnOnEquity),
    currentRatio: numberOrNull(asset.currentRatio),
    beta: numberOrNull(asset.beta),
    analystRating: asset.analystRating || null,
    targetMeanPrice: numberOrNull(asset.targetMeanPrice),
    sectorPe: numberOrNull(asset.sectorPe ?? benchmarks.pe),
    sectorBenchmark: benchmarks,
    benchmarkSource: "Estimated sector benchmark",
    nextEarningsDate: asset.nextEarningsDate || null,
    earningsSurprise: numberOrNull(asset.earningsSurprise),
    recentEarningsPeriod: asset.recentEarningsPeriod || null,
    style: asset.style || catalog.style || inferStyle(asset.sector, asset.beta, asset.peRatio),
    summary: asset.summary || "",
    marketState: asset.marketState || "Unknown",
    history,
    news: Array.isArray(asset.news) ? asset.news : [],
    provider: asset.provider,
    live: Boolean(asset.live && price),
    lastUpdated: asset.lastUpdated || new Date().toISOString(),
    fundamentalsUpdatedAt: asset.fundamentalsUpdatedAt || null,
    analysisGeneratedAt: generatedAt,
    freshness: {
      priceData: asset.lastUpdated || generatedAt,
      fundamentals: asset.fundamentalsUpdatedAt || null,
      analysisGenerated: generatedAt,
      note: "Price data can update intraday. Fundamental metrics may lag quarterly filings even when price data is live."
    },
    sources,
    missingReasons: missingReasons(sources, asset),
    sourceNote: asset.sourceNote || ""
  };
}

function enrichSearchResult(result) {
  const catalog = CATALOG_BY_SYMBOL[result.symbol] || {};
  return {
    symbol: result.symbol,
    name: result.name || catalog.name || result.symbol,
    assetType: normalizeType(result.assetType || catalog.assetType),
    exchange: result.exchange || catalog.exchange || "Unknown",
    sector: result.sector || catalog.sector || "Unknown",
    industry: result.industry || catalog.industry || "Unknown",
    provider: result.provider || "Fallback catalog",
    isLiveSearch: Boolean(result.isLiveSearch)
  };
}

function fallbackSearch(query) {
  const normalized = (query || "").toLowerCase();
  return CATALOG.filter((asset) => {
    if (!normalized) return true;
    return [asset.symbol, asset.name, asset.assetType, asset.sector, asset.industry, asset.exchange].some((value) => {
      return String(value || "").toLowerCase().includes(normalized);
    });
  }).map((asset) => enrichSearchResult({ ...asset, provider: "Fallback catalog", isLiveSearch: false }));
}

function mergeSearchResults(primary, fallback) {
  const seen = new Set();
  return [...primary, ...fallback].filter((asset) => {
    if (seen.has(asset.symbol)) return false;
    seen.add(asset.symbol);
    return true;
  });
}

function filterResults(results, filters) {
  return results.filter((asset) => {
    return matches(asset.assetType, filters.type)
      && matches(asset.sector, filters.sector)
      && matches(asset.industry, filters.industry)
      && matches(asset.exchange, filters.exchange);
  });
}

function matches(value, filter) {
  if (!filter) return true;
  return String(value || "").toLowerCase().includes(String(filter).toLowerCase());
}

function normalizeNews(item) {
  const summary = item.summary || "";
  return {
    headline: item.headline || "Recent market news",
    source: item.source || "Unknown source",
    date: item.date || new Date().toISOString(),
    summary,
    url: item.url || "",
    sentiment: item.sentiment || scoreTextSentiment(`${item.headline || ""} ${summary}`)
  };
}

function scoreTextSentiment(text) {
  const value = String(text || "").toLowerCase();
  const positive = ["beat", "beats", "growth", "raises", "strong", "record", "expands", "upgrade", "profit", "surge", "higher"].some((word) => value.includes(word));
  const negative = ["miss", "misses", "falls", "probe", "lawsuit", "cuts", "weak", "risk", "downgrade", "lower", "drop"].some((word) => value.includes(word));
  if (positive && !negative) return "positive";
  if (negative && !positive) return "negative";
  return "neutral";
}

function normalizeSentiment(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("bullish") || text.includes("positive")) return "positive";
  if (text.includes("bearish") || text.includes("negative")) return "negative";
  return "neutral";
}

function normalizeType(value) {
  const text = String(value || "").toUpperCase().replace(/\s+/g, "");
  if (text.includes("ETF")) return "ETF";
  if (text.includes("MUTUAL")) return "MUTUALFUND";
  if (text.includes("CRYPTO")) return "CRYPTOCURRENCY";
  if (text.includes("REIT")) return "REIT";
  if (text.includes("INDEX")) return "INDEX";
  if (text.includes("EQUITY") || text.includes("STOCK")) return "EQUITY";
  return text || "Unknown";
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function toStooqSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (normalized.endsWith("-USD")) return normalized.replace("-USD", "USD").toLowerCase();
  if (normalized.includes(".")) return normalized.toLowerCase();
  return `${normalized}.us`.toLowerCase();
}

function numberOrNull(value) {
  if (value && typeof value === "object" && "raw" in value) return numberOrNull(value.raw);
  if (value === null || value === undefined || value === "" || value === "None") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstMetric(metrics, keys) {
  for (const key of keys) {
    const value = numberOrNull(metrics[key]);
    if (value !== null) return value;
  }
  return null;
}

function raw(value) {
  return numberOrNull(value);
}

function percentRaw(value) {
  const number = raw(value);
  return number === null ? null : number * 100;
}

function percentMaybe(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function normalizeAverageVolume(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.abs(number) < 10_000 ? Math.round(number * 1_000_000) : Math.round(number);
}

function parsePercent(value) {
  if (!value) return null;
  return numberOrNull(String(value).replace("%", ""));
}

function normalizeDebt(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return number > 10 ? number / 100 : number;
}

function inferStyle(sector, beta, pe) {
  if (sector === "Healthcare" || sector === "Consumer Defensive") return "Defensive";
  if (beta && beta > 1.3) return "High Growth";
  if (pe && pe < 16) return "Value";
  return "Core";
}

function alphaDate(value) {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11) || "00"}:${text.slice(11, 13) || "00"}:00Z`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Aurex/1.0 educational market research platform",
        Accept: "application/json,text/plain,*/*"
      }
    });
    if (response.status === 429) throw new Error("Provider rate limit reached. Try again shortly.");
    if (!response.ok) throw new Error(`${url.hostname} temporarily unavailable.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function userSafeError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("429") || message.toLowerCase().includes("rate limit")) return "Provider rate limit reached. Try again shortly.";
  if (message.toLowerCase().includes("abort")) return "Market data provider timed out. Some data is temporarily unavailable.";
  if (message.toLowerCase().includes("api_key") || message.toLowerCase().includes("token")) return "Provider key is not configured for this data source.";
  if (message.toLowerCase().includes("not configured")) return message;
  return message || "Some data is temporarily unavailable.";
}

function structuredError(message, code = "provider_error") {
  return {
    error: message,
    code,
    provider: provider.name,
    timestamp: new Date().toISOString()
  };
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname === "/app" ? "app.html" : pathname.slice(1);
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT)) return send(response, 403, "Forbidden");
  try {
    const body = await fs.readFile(filePath);
    send(response, 200, body, contentType(filePath));
  } catch {
    send(response, 404, "Not found");
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}

function json(response, statusOrBody, maybeBody) {
  if (typeof statusOrBody === "number") {
    return send(response, statusOrBody, JSON.stringify(maybeBody), "application/json; charset=utf-8");
  }
  return send(response, 200, JSON.stringify(statusOrBody), "application/json; charset=utf-8");
}

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(body);
}
