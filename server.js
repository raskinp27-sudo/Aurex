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
let YAHOO_SESSION = null;
let YAHOO_SESSION_PROMISE = null;

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

  async yahoo2Authed(pathname, params = {}) {
    const session = await getYahooSession();
    const url = new URL(pathname, "https://query2.finance.yahoo.com");
    Object.entries({ ...params, crumb: session.crumb }).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, { headers: { Cookie: session.cookie } });
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
    const [quote, history, news] = await Promise.all([
      this.getQuote(normalized),
      this.getHistory(normalized).catch((error) => {
        console.warn(`[Aurex provider warning] Yahoo history ${normalized}: ${userSafeError(error)}`);
        return [];
      }),
      this.getNews(normalized).catch((error) => {
        console.warn(`[Aurex provider warning] Yahoo news ${normalized}: ${userSafeError(error)}`);
        return [];
      })
    ]);
    const fundamentals = await this.getFundamentals(normalized, quote).catch((error) => {
      console.warn(`[Aurex provider warning] Yahoo fundamentals ${normalized}: ${userSafeError(error)}`);
      return { error: error.message };
    });
    const merged = deepMergeAsset(quote, fundamentals, {
      history,
      news,
      provider: this.name,
      live: Boolean(quote.price),
      sourceNote: "Live or delayed market quote from the active no-key provider. Fundamentals depend on provider availability; configure Finnhub or Alpha Vantage for deeper ratios."
    });
    merged.sources = mergeSources(
      merged.sources,
      history.length ? sourceMap("Yahoo chart history", ["history"]) : {},
      news.length ? sourceMap("Yahoo Finance news", ["news"]) : {}
    );
    return normalizeAsset(merged);
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
    } catch (error) {
      console.warn(`[Aurex provider warning] Yahoo quote ${symbol}: ${userSafeError(error)}. Trying chart quote.`);
      try {
        return await this.getChartQuote(symbol);
      } catch (chartError) {
        console.warn(`[Aurex provider warning] Yahoo chart quote ${symbol}: ${userSafeError(chartError)}. Trying Stooq.`);
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
      week52High: numberOrNull(meta.fiftyTwoWeekHigh),
      week52Low: numberOrNull(meta.fiftyTwoWeekLow),
      open: numberOrNull(opens.at(-1)),
      dayHigh: numberOrNull(highs.at(-1)),
      dayLow: numberOrNull(lows.at(-1)),
      volume: numberOrNull(meta.regularMarketVolume ?? volumes.at(-1)),
      averageVolume: volumes.length ? Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length) : null,
      lastUpdated: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      sources: sourceMap("Yahoo chart quote", [
        "price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow",
        "volume", "averageVolume", "exchange", "currency", "week52High", "week52Low"
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

  async getFundamentals(symbol, quote = {}) {
    let response;
    try {
      response = await this.yahoo2Authed(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
        modules: "assetProfile,summaryDetail,financialData,defaultKeyStatistics,price"
      });
    } catch (error) {
      console.warn(`[Aurex provider warning] Yahoo quoteSummary ${symbol}: ${userSafeError(error)}. Trying Yahoo fundamentals timeseries.`);
      return this.getTimeseriesFundamentals(symbol, quote);
    }
    const result = response.quoteSummary?.result?.[0] || {};
    const profile = result.assetProfile || {};
    const detail = result.summaryDetail || {};
    const financial = result.financialData || {};
    const stats = result.defaultKeyStatistics || {};
    const priceBlock = result.price || {};
    const catalog = CATALOG_BY_SYMBOL[symbol] || {};
    const mappings = {
      marketCap: candidateEntry([
        ["summaryDetail.marketCap", detail.marketCap],
        ["price.marketCap", priceBlock.marketCap]
      ]),
      peRatio: candidateEntry([
        ["summaryDetail.trailingPE", detail.trailingPE],
        ["defaultKeyStatistics.trailingPE", stats.trailingPE],
        ["defaultKeyStatistics.peRatio", stats.peRatio]
      ]),
      forwardPe: candidateEntry([
        ["defaultKeyStatistics.forwardPE", stats.forwardPE],
        ["summaryDetail.forwardPE", detail.forwardPE]
      ]),
      priceToBook: candidateEntry([
        ["defaultKeyStatistics.priceToBook", stats.priceToBook]
      ]),
      eps: candidateEntry([
        ["defaultKeyStatistics.trailingEps", stats.trailingEps],
        ["defaultKeyStatistics.forwardEps", stats.forwardEps]
      ]),
      beta: candidateEntry([
        ["defaultKeyStatistics.beta", stats.beta],
        ["summaryDetail.beta", detail.beta]
      ]),
      dividendYield: candidateEntry([
        ["summaryDetail.dividendYield", detail.dividendYield],
        ["summaryDetail.trailingAnnualDividendYield", detail.trailingAnnualDividendYield]
      ], percentRaw),
      week52High: candidateEntry([
        ["summaryDetail.fiftyTwoWeekHigh", detail.fiftyTwoWeekHigh]
      ]),
      week52Low: candidateEntry([
        ["summaryDetail.fiftyTwoWeekLow", detail.fiftyTwoWeekLow]
      ]),
      volume: candidateEntry([
        ["summaryDetail.volume", detail.volume],
        ["price.regularMarketVolume", priceBlock.regularMarketVolume]
      ]),
      averageVolume: candidateEntry([
        ["summaryDetail.averageVolume", detail.averageVolume],
        ["summaryDetail.averageDailyVolume10Day", detail.averageDailyVolume10Day],
        ["price.averageDailyVolume3Month", priceBlock.averageDailyVolume3Month]
      ]),
      revenueGrowth: candidateEntry([
        ["financialData.revenueGrowth", financial.revenueGrowth]
      ], percentRaw),
      earningsGrowth: candidateEntry([
        ["financialData.earningsGrowth", financial.earningsGrowth]
      ], percentRaw),
      profitMargin: candidateEntry([
        ["financialData.profitMargins", financial.profitMargins]
      ], percentRaw),
      operatingMargin: candidateEntry([
        ["financialData.operatingMargins", financial.operatingMargins]
      ], percentRaw),
      debtToEquity: candidateEntry([
        ["financialData.debtToEquity", financial.debtToEquity]
      ], normalizeDebt),
      returnOnEquity: candidateEntry([
        ["financialData.returnOnEquity", financial.returnOnEquity]
      ], percentRaw),
      currentRatio: candidateEntry([
        ["financialData.currentRatio", financial.currentRatio]
      ]),
      targetMeanPrice: candidateEntry([
        ["financialData.targetMeanPrice", financial.targetMeanPrice]
      ])
    };
    logMetricMappings("Yahoo fundamentals", symbol, mappings, {
      assetProfileFields: Object.keys(profile),
      summaryDetailFields: Object.keys(detail),
      financialDataFields: Object.keys(financial),
      defaultKeyStatisticsFields: Object.keys(stats),
      priceFields: Object.keys(priceBlock)
    });
    return {
      sector: profile.sector || catalog.sector || "Unknown",
      industry: profile.industry || catalog.industry || "Unknown",
      summary: profile.longBusinessSummary,
      profitMargin: mappings.profitMargin.value,
      revenueGrowth: mappings.revenueGrowth.value,
      earningsGrowth: mappings.earningsGrowth.value,
      debtToEquity: mappings.debtToEquity.value,
      currentRatio: mappings.currentRatio.value,
      beta: mappings.beta.value,
      forwardPe: mappings.forwardPe.value,
      priceToBook: mappings.priceToBook.value,
      eps: mappings.eps.value,
      dividendYield: mappings.dividendYield.value,
      averageVolume: mappings.averageVolume.value,
      analystRating: financial.recommendationKey || financial.recommendationMean?.fmt || null,
      targetMeanPrice: mappings.targetMeanPrice.value,
      week52High: mappings.week52High.value,
      week52Low: mappings.week52Low.value,
      marketCap: mappings.marketCap.value,
      peRatio: mappings.peRatio.value,
      volume: mappings.volume.value,
      sectorPe: SECTOR_PE[profile.sector || catalog.sector] ?? null,
      style: catalog.style || inferStyle(profile.sector, mappings.beta.value, mappings.peRatio.value),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sources: sourceMap("Yahoo fundamentals", [
        "sector", "industry", "summary", "profitMargin", "revenueGrowth", "earningsGrowth",
        "debtToEquity", "currentRatio", "beta", "forwardPe", "priceToBook", "eps",
        "dividendYield", "averageVolume", "targetMeanPrice", "week52High", "week52Low",
        "marketCap", "peRatio", "volume"
      ])
    };
  }

  async getTimeseriesFundamentals(symbol, quote = {}) {
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - 3 * 365 * 24 * 60 * 60;
    const period2 = now + 45 * 24 * 60 * 60;
    const types = [
      "trailingMarketCap",
      "marketCap",
      "trailingPeRatio",
      "annualDilutedEPS",
      "annualBasicEPS",
      "quarterlyDilutedEPS",
      "quarterlyBasicEPS",
      "quarterlyTotalRevenue",
      "quarterlyNetIncome",
      "quarterlyOperatingIncome",
      "quarterlyTotalDebt",
      "quarterlyStockholdersEquity",
      "trailingDividendYield"
    ];
    const response = await this.yahoo("/ws/fundamentals-timeseries/v1/finance/timeseries/" + encodeURIComponent(symbol), {
      symbol,
      type: types.join(","),
      period1,
      period2
    });
    const series = timeseriesMap(response);
    const marketCap = firstAvailableEntry([
      latestTimeseriesEntry(series, "trailingMarketCap"),
      latestTimeseriesEntry(series, "marketCap")
    ]);
    const trailingPe = latestTimeseriesEntry(series, "trailingPeRatio");
    const eps = trailingEpsEntry(series);
    const revenue = latestTimeseriesEntry(series, "quarterlyTotalRevenue");
    const netIncome = latestTimeseriesEntry(series, "quarterlyNetIncome");
    const operatingIncome = latestTimeseriesEntry(series, "quarterlyOperatingIncome");
    const debt = latestTimeseriesEntry(series, "quarterlyTotalDebt");
    const equity = latestTimeseriesEntry(series, "quarterlyStockholdersEquity");
    const price = numberOrNull(quote.price);
    const derivedPe = trailingPe.value !== null
      ? trailingPe
      : derivedMetricEntry("Yahoo price / Yahoo EPS", { price, eps: eps.value }, price !== null && eps.value > 0 ? price / eps.value : null);
    const mappings = {
      marketCap,
      peRatio: derivedPe,
      eps,
      dividendYield: latestTimeseriesEntry(series, "trailingDividendYield", percentMaybe),
      revenueGrowth: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyTotalRevenue YoY",
        latestSeriesPair(series, "quarterlyTotalRevenue", 4),
        growthFromSeries(series, "quarterlyTotalRevenue", 4)
      ),
      profitMargin: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyNetIncome / quarterlyTotalRevenue",
        { netIncome: netIncome.value, revenue: revenue.value },
        netIncome.value !== null && revenue.value ? (netIncome.value / revenue.value) * 100 : null
      ),
      operatingMargin: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyOperatingIncome / quarterlyTotalRevenue",
        { operatingIncome: operatingIncome.value, revenue: revenue.value },
        operatingIncome.value !== null && revenue.value ? (operatingIncome.value / revenue.value) * 100 : null
      ),
      debtToEquity: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyTotalDebt / quarterlyStockholdersEquity",
        { debt: debt.value, equity: equity.value },
        debt.value !== null && equity.value ? normalizeDebt(debt.value / equity.value) : null
      ),
      beta: { value: null, sourceField: null, rawValue: null },
      forwardPe: { value: null, sourceField: null, rawValue: null },
      priceToBook: { value: null, sourceField: null, rawValue: null },
      earningsGrowth: { value: null, sourceField: null, rawValue: null },
      returnOnEquity: { value: null, sourceField: null, rawValue: null },
      currentRatio: { value: null, sourceField: null, rawValue: null }
    };
    logMetricMappings("Yahoo fundamentals timeseries", symbol, mappings, {
      timeseriesTypes: Object.keys(series)
    });
    const values = Object.fromEntries(Object.entries(mappings).map(([field, entry]) => [field, entry.value]));
    const availableFields = Object.entries(values).filter(([, value]) => value !== null).map(([field]) => field);
    const sources = sourceMap("Yahoo fundamentals timeseries", availableFields);
    if (mappings.peRatio.sourceField === "Yahoo price / Yahoo EPS") sources.peRatio = "Derived from Yahoo price and EPS";
    if (mappings.profitMargin.value !== null) sources.profitMargin = "Derived from Yahoo fundamentals timeseries";
    if (mappings.operatingMargin.value !== null) sources.operatingMargin = "Derived from Yahoo fundamentals timeseries";
    if (mappings.debtToEquity.value !== null) sources.debtToEquity = "Derived from Yahoo fundamentals timeseries";
    if (mappings.revenueGrowth.value !== null) sources.revenueGrowth = "Derived from Yahoo fundamentals timeseries";
    const catalog = CATALOG_BY_SYMBOL[symbol] || SEARCH_METADATA.get(symbol) || {};
    return {
      sector: catalog.sector || quote.sector || "Unknown",
      industry: catalog.industry || quote.industry || "Unknown",
      ...values,
      sectorPe: SECTOR_PE[catalog.sector || quote.sector] ?? null,
      style: catalog.style || inferStyle(catalog.sector || quote.sector, values.beta, values.peRatio),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sources,
      sourceNote: "Yahoo quoteSummary was unavailable, so Aurex used Yahoo fundamentals timeseries where available. Derived ratios are calculated from returned provider fields."
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
    const mappings = buildFinnhubMetricMappings(profile, metrics);
    logMetricMappings("Finnhub quote/profile2/metric", normalized, mappings, {
      quoteFields: Object.keys(quote),
      profileFields: Object.keys(profile),
      metricFields: Object.keys(metrics)
    });
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
      marketCap: mappings.marketCap.value,
      peRatio: mappings.peRatio.value,
      forwardPe: mappings.forwardPe.value,
      priceToBook: mappings.priceToBook.value,
      eps: mappings.eps.value,
      dividendYield: mappings.dividendYield.value,
      week52High: mappings.week52High.value,
      week52Low: mappings.week52Low.value,
      averageVolume: mappings.averageVolume.value,
      revenueGrowth: mappings.revenueGrowth.value,
      earningsGrowth: mappings.earningsGrowth.value,
      profitMargin: mappings.profitMargin.value,
      operatingMargin: mappings.operatingMargin.value,
      debtToEquity: mappings.debtToEquity.value,
      returnOnEquity: mappings.returnOnEquity.value,
      currentRatio: mappings.currentRatio.value,
      beta: mappings.beta.value,
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
    const mappings = buildFinnhubMetricMappings(profile, metrics);
    mappings.volume = candidateEntry([
      ["stock/candle.v[last]", candles.s === "ok" ? candles.v?.at(-1) : null]
    ]);
    logMetricMappings("Finnhub full asset", normalized, mappings, {
      quoteFields: Object.keys(quote),
      profileFields: Object.keys(profile),
      metricFields: Object.keys(metrics),
      candleStatus: candles.s || "unknown"
    });
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
      marketCap: mappings.marketCap.value,
      peRatio: mappings.peRatio.value,
      forwardPe: mappings.forwardPe.value,
      priceToBook: mappings.priceToBook.value,
      eps: mappings.eps.value,
      dividendYield: mappings.dividendYield.value,
      week52High: mappings.week52High.value,
      week52Low: mappings.week52Low.value,
      volume: mappings.volume.value,
      averageVolume: mappings.averageVolume.value,
      revenueGrowth: mappings.revenueGrowth.value,
      earningsGrowth: mappings.earningsGrowth.value,
      profitMargin: mappings.profitMargin.value,
      operatingMargin: mappings.operatingMargin.value,
      debtToEquity: mappings.debtToEquity.value,
      returnOnEquity: mappings.returnOnEquity.value,
      currentRatio: mappings.currentRatio.value,
      beta: mappings.beta.value,
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
          "volume", "revenueGrowth", "earningsGrowth", "profitMargin", "operatingMargin", "debtToEquity",
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
  const assets = [];
  for (const symbol of symbols) {
    try {
      assets.push(await getAssetWithFallback(symbol));
    } catch (error) {
      assets.push(fallbackAsset(symbol, error?.message));
    }
  }
  return assets;
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

function candidateEntry(candidates, transform = numberOrNull) {
  for (const [sourceField, rawValue] of candidates) {
    const value = transform(rawValue);
    if (value !== null) return { value, sourceField, rawValue };
  }
  return { value: null, sourceField: null, rawValue: null };
}

function metricEntry(metrics, keys, transform = numberOrNull) {
  return candidateEntry(keys.map((key) => [`stock/metric.${key}`, metrics?.[key]]), transform);
}

function profileMarketCapEntry(profile, metrics) {
  const profileMarketCap = numberOrNull(profile?.marketCapitalization);
  if (profileMarketCap !== null) {
    return {
      value: profileMarketCap * 1_000_000,
      sourceField: "stock/profile2.marketCapitalization",
      rawValue: profile.marketCapitalization
    };
  }
  return metricEntry(metrics, ["marketCapitalization", "marketCap"]);
}

function buildFinnhubMetricMappings(profile, metrics) {
  return {
    marketCap: profileMarketCapEntry(profile, metrics),
    peRatio: metricEntry(metrics, ["peNormalizedAnnual", "peTTM", "peBasicExclExtraTTM", "peExclExtraAnnual", "peInclExtraTTM"]),
    forwardPe: metricEntry(metrics, ["forwardPE", "forwardPe", "peForwardAnnual"]),
    priceToBook: metricEntry(metrics, ["pbAnnual", "pbQuarterly", "pbTTM"]),
    eps: metricEntry(metrics, ["epsTTM", "epsBasicExclExtraItemsTTM", "epsDilutedExclExtraItemsTTM", "epsNormalizedAnnual", "epsInclExtraItemsTTM"]),
    dividendYield: metricEntry(metrics, ["dividendYieldIndicatedAnnual", "dividendYield5Y"], percentMaybe),
    week52High: metricEntry(metrics, ["52WeekHigh"]),
    week52Low: metricEntry(metrics, ["52WeekLow"]),
    averageVolume: metricEntry(metrics, ["10DayAverageTradingVolume", "3MonthAverageTradingVolume"], normalizeAverageVolume),
    revenueGrowth: metricEntry(metrics, ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy", "revenueGrowth3Y", "revenueGrowth5Y"], percentMaybe),
    earningsGrowth: metricEntry(metrics, ["epsGrowthTTMYoy", "epsGrowthQuarterlyYoy", "epsGrowth3Y", "epsGrowth5Y"], percentMaybe),
    profitMargin: metricEntry(metrics, ["netProfitMarginTTM", "netProfitMarginAnnual"], percentMaybe),
    operatingMargin: metricEntry(metrics, ["operatingMarginTTM", "operatingMarginAnnual"], percentMaybe),
    debtToEquity: metricEntry(metrics, ["totalDebt/totalEquityAnnual", "totalDebt/totalEquityQuarterly", "ltDebt/equityAnnual", "ltDebt/equityQuarterly"], normalizeDebt),
    returnOnEquity: metricEntry(metrics, ["roeTTM", "roeRfy", "roeAnnual"], percentMaybe),
    currentRatio: metricEntry(metrics, ["currentRatioAnnual", "currentRatioQuarterly"]),
    beta: metricEntry(metrics, ["beta", "beta3Y"])
  };
}

function timeseriesMap(response) {
  const result = response?.timeseries?.result || [];
  return Object.fromEntries(result.map((item) => {
    const type = item.meta?.type?.[0] || Object.keys(item).find((key) => !["meta", "timestamp"].includes(key));
    return [type, Array.isArray(item[type]) ? item[type] : []];
  }).filter(([type]) => Boolean(type)));
}

function latestTimeseriesEntry(series, type, transform = numberOrNull) {
  const rows = seriesRows(series, type);
  const row = rows.at(-1);
  const rawValue = row ? row.reportedValue ?? row.dataValue : null;
  const value = transform(rawValue);
  return value !== null
    ? { value, sourceField: `fundamentals-timeseries.${type}`, rawValue }
    : { value: null, sourceField: null, rawValue: null };
}

function trailingEpsEntry(series) {
  const dilutedRows = seriesRows(series, "quarterlyDilutedEPS");
  const dilutedTtm = sumLastSeriesValues(dilutedRows, 4);
  if (dilutedTtm !== null) {
    return derivedMetricEntry("fundamentals-timeseries.quarterlyDilutedEPS trailing four quarters", dilutedRows.slice(-4), dilutedTtm);
  }
  const basicRows = seriesRows(series, "quarterlyBasicEPS");
  const basicTtm = sumLastSeriesValues(basicRows, 4);
  if (basicTtm !== null) {
    return derivedMetricEntry("fundamentals-timeseries.quarterlyBasicEPS trailing four quarters", basicRows.slice(-4), basicTtm);
  }
  return firstAvailableEntry([
    latestTimeseriesEntry(series, "annualDilutedEPS"),
    latestTimeseriesEntry(series, "annualBasicEPS")
  ]);
}

function firstAvailableEntry(entries) {
  return entries.find((entry) => entry?.value !== null && entry?.value !== undefined) || { value: null, sourceField: null, rawValue: null };
}

function derivedMetricEntry(sourceField, rawValue, value) {
  const numeric = numberOrNull(value);
  return numeric !== null
    ? { value: numeric, sourceField, rawValue }
    : { value: null, sourceField: null, rawValue };
}

function seriesRows(series, type) {
  return (series[type] || []).filter((row) => numberOrNull(row.reportedValue ?? row.dataValue) !== null);
}

function seriesRowValue(row) {
  return numberOrNull(row?.reportedValue ?? row?.dataValue);
}

function sumLastSeriesValues(rows, count) {
  if (!Array.isArray(rows) || rows.length < count) return null;
  return rows.slice(-count).reduce((sum, row) => sum + seriesRowValue(row), 0);
}

function latestSeriesPair(series, type, lag = 4) {
  const rows = seriesRows(series, type);
  if (!rows.length) return null;
  const current = rows.at(-1);
  const prior = rows.length > lag ? rows.at(-1 - lag) : rows.length > 1 ? rows.at(-2) : null;
  return {
    current: current ? { date: current.asOfDate, value: seriesRowValue(current) } : null,
    prior: prior ? { date: prior.asOfDate, value: seriesRowValue(prior) } : null
  };
}

function growthFromSeries(series, type, lag = 4) {
  const pair = latestSeriesPair(series, type, lag);
  const current = numberOrNull(pair?.current?.value);
  const prior = numberOrNull(pair?.prior?.value);
  if (current === null || !prior) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function logMetricMappings(providerName, symbol, mappings, received = {}) {
  const mapped = Object.fromEntries(Object.entries(mappings).map(([uiField, entry]) => [uiField, {
    sourceField: entry.sourceField || "missing",
    rawValue: summarizeLogValue(entry.rawValue),
    mappedValue: entry.value
  }]));
  console.info(`[Aurex metric mapping] ${providerName} ${symbol}: ${JSON.stringify({ received, mapped })}`);
}

function summarizeLogValue(value) {
  if (value && typeof value === "object") {
    if ("raw" in value || "fmt" in value) return { raw: value.raw ?? null, fmt: value.fmt ?? null };
    return `[object keys: ${Object.keys(value).slice(0, 8).join(", ")}]`;
  }
  if (typeof value === "string" && value.length > 120) return `${value.slice(0, 120)}...`;
  return value ?? null;
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

async function getYahooSession() {
  if (YAHOO_SESSION && Date.now() - YAHOO_SESSION.createdAt < 45 * 60 * 1000) return YAHOO_SESSION;
  if (!YAHOO_SESSION_PROMISE) {
    YAHOO_SESSION_PROMISE = loadYahooSession().finally(() => {
      YAHOO_SESSION_PROMISE = null;
    });
  }
  return YAHOO_SESSION_PROMISE;
}

async function loadYahooSession() {
  const cookieResponse = await fetchText(new URL("https://fc.yahoo.com"), { allowStatuses: [404] });
  const cookie = cookieHeaderFromSetCookie(cookieResponse.headers.get("set-cookie"));
  if (!cookie) throw new Error("Yahoo session cookie unavailable.");
  const crumb = (await fetchText(new URL("https://query1.finance.yahoo.com/v1/test/getcrumb"), {
    headers: { Cookie: cookie }
  })).text.trim();
  if (!crumb || crumb.toLowerCase().includes("too many requests")) throw new Error("Yahoo crumb unavailable.");
  YAHOO_SESSION = { cookie, crumb, createdAt: Date.now() };
  return YAHOO_SESSION;
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  const allowedNames = ["A1", "A1S", "A3", "B", "GUC"];
  const parts = [];
  allowedNames.forEach((name) => {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
    if (match) parts.push(match[1]);
  });
  return parts.join("; ");
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  return {
    headers: response.headers,
    status: response.status,
    text: await response.text()
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, options);
  const json = await response.json();
  const providerError = json?.finance?.error || json?.quoteSummary?.error;
  if (providerError) throw new Error(providerError.description || providerError.code || "Provider returned an error.");
  return json;
}

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  try {
    const { headers = {}, allowStatuses = [], ...rest } = options;
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": "Aurex/1.0 educational market research platform",
        Accept: "application/json,text/plain,*/*",
        ...headers
      }
    });
    if (response.status === 429) throw new Error("Provider rate limit reached. Try again shortly.");
    if (!response.ok && !allowStatuses.includes(response.status)) throw new Error(`${url.hostname} temporarily unavailable.`);
    return response;
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
