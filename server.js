const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const MARKET_PROVIDER = String(process.env.MARKET_PROVIDER || "auto").trim().toLowerCase();
const FINNHUB_API_KEY = String(process.env.FINNHUB_API_KEY || "").trim();
const ALPHA_VANTAGE_API_KEY = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();
const FMP_API_KEY = String(process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || "").trim();
const POLYGON_API_KEY = String(process.env.POLYGON_API_KEY || "").trim();
const SEARCH_METADATA = new Map();
const API_CACHE = new Map();
const CACHE_INFLIGHT = new Map();
const QUOTE_TTL_MS = 60_000;
const SEARCH_TTL_MS = 90_000;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const FUNDAMENTAL_TTL_MS = 24 * 60 * 60 * 1000;
const NEWS_TTL_MS = 15 * 60 * 1000;
const HISTORY_TTL_MS = 15 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_STATS = {
  hits: 0,
  negativeHits: 0,
  misses: 0,
  coalesced: 0,
  writes: 0,
  errors: 0,
  byNamespace: {}
};
const PROVIDER_HEALTH = {
  finnhub: providerHealthState(Boolean(FINNHUB_API_KEY)),
  yahoo: providerHealthState(true),
  alphaVantage: providerHealthState(Boolean(ALPHA_VANTAGE_API_KEY)),
  fmp: providerHealthState(Boolean(FMP_API_KEY)),
  polygon: providerHealthState(Boolean(POLYGON_API_KEY))
};
const FUNDAMENTAL_FIELDS = [
  "marketCap", "peRatio", "forwardPe", "pegRatio", "priceToBook", "evToEbitda", "evToSales",
  "eps", "dividendYield", "payoutRatio", "week52High", "week52Low", "volume", "averageVolume",
  "revenueGrowth", "earningsGrowth", "freeCashFlowGrowth", "grossMargin", "profitMargin",
  "operatingMargin", "debtToEquity", "returnOnEquity", "returnOnAssets", "currentRatio",
  "quickRatio", "cashPerShare", "beta", "volatility", "institutionalOwnership", "shortInterest",
  "analystRating", "recommendationTrend", "targetMeanPrice", "nextEarningsDate", "earningsSurprise"
];
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
  constructor(finnhubKey, configuredMode = "auto") {
    super(finnhubKey ? "Finnhub primary + field-level enrichment" : "Yahoo primary + field-level enrichment");
    this.configuredMode = configuredMode;
    this.quoteProvider = new YahooFinanceProvider();
    this.finnhubProvider = finnhubKey ? new FinnhubProvider(finnhubKey) : null;
    this.alphaVantageProvider = ALPHA_VANTAGE_API_KEY ? new AlphaVantageProvider(ALPHA_VANTAGE_API_KEY) : null;
    this.fmpProvider = FMP_API_KEY ? new FinancialModelingPrepProvider(FMP_API_KEY) : null;
    this.polygonProvider = POLYGON_API_KEY ? new PolygonFundamentalsProvider(POLYGON_API_KEY) : null;
    this.lastWarning = "";
  }

  async search(query, filters = {}) {
    this.lastWarning = "";
    if (this.finnhubProvider) {
      try {
        return this.finnhubProvider.search(query, filters);
      } catch (error) {
        this.lastWarning = userSafeError(error);
        console.warn(`[Aurex] Finnhub search unavailable: ${this.lastWarning}. Using Yahoo fallback search.`);
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
    const attempts = [];
    let asset = null;

    if (this.finnhubProvider) {
      try {
        asset = await this.finnhubProvider.getAsset(normalized);
        if (!isUsableQuote(asset)) {
          throw providerError("Finnhub", "quote", "invalid_response", null, `Finnhub returned an empty quote for ${normalized}.`);
        }
        attempts.push(providerAttempt("Finnhub", "success", asset));
        console.info(`[Aurex] Using Finnhub quote for ${normalized}`);
      } catch (error) {
        attempts.push(providerAttempt("Finnhub", "error", null, error));
        this.lastWarning = userSafeError(error);
        console.warn(`[Aurex] Finnhub unavailable for ${normalized}: ${this.lastWarning}`);
      }
    } else if (this.configuredMode === "finnhub") {
      attempts.push(providerAttempt("Finnhub", "not_configured"));
      console.error(`[Aurex] MARKET_PROVIDER=finnhub but FINNHUB_API_KEY was not detected.`);
    } else {
      attempts.push(providerAttempt("Finnhub", "not_configured"));
    }

    if (!asset) {
      console.info(`[Aurex] Using Yahoo fallback for ${normalized}`);
      try {
        asset = await this.quoteProvider.getAsset(normalized);
        attempts.push(providerAttempt("Yahoo", "success", asset));
      } catch (error) {
        attempts.push(providerAttempt("Yahoo", "error", null, error));
        console.error(`[Aurex] Yahoo fallback failed for ${normalized}: ${userSafeError(error)}`);
        throw error;
      }
    } else {
      const yahooAttempt = await runEnricher("Yahoo", true, () => this.quoteProvider.getFundamentals(normalized, asset));
      attempts.push(yahooAttempt);
      asset = mergeMissingAssetFields(asset, yahooAttempt.overlay);
    }

    const optionalEnrichers = [
      ["Alpha Vantage", Boolean(this.alphaVantageProvider), () => this.alphaVantageProvider.getFundamentalOverlay(normalized)],
      ["Financial Modeling Prep", Boolean(this.fmpProvider), () => this.fmpProvider.getFundamentalOverlay(normalized)],
      ["Polygon", Boolean(this.polygonProvider), () => this.polygonProvider.getFundamentalOverlay(normalized, asset)]
    ];
    const optionalAttempts = await Promise.all(optionalEnrichers.map(([name, configured, loader]) => {
      return runEnricher(name, configured, loader);
    }));
    optionalAttempts.forEach((attempt) => {
      attempts.push(attempt);
      asset = mergeMissingAssetFields(asset, attempt.overlay);
    });

    return finalizeAssetCoverage(asset, attempts);
  }
}

class YahooFinanceProvider extends MarketProvider {
  constructor() {
    super("Yahoo Search + Stooq delayed quote");
  }

  async yahoo(pathname, params = {}, requestOptions = {}) {
    const url = new URL(pathname, "https://query1.finance.yahoo.com");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, { providerName: "Yahoo", operation: pathname, ...requestOptions });
  }

  async yahoo2(pathname, params = {}, requestOptions = {}) {
    const url = new URL(pathname, "https://query2.finance.yahoo.com");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, { providerName: "Yahoo", operation: pathname, ...requestOptions });
  }

  async yahoo2Authed(pathname, params = {}) {
    const session = await getYahooSession();
    const url = new URL(pathname, "https://query2.finance.yahoo.com");
    Object.entries({ ...params, crumb: session.crumb }).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, { headers: { Cookie: session.cookie }, providerName: "Yahoo", operation: pathname });
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
    return cached(`yahoo-quote:${symbol}`, QUOTE_TTL_MS, () => this.fetchQuote(symbol));
  }

  async fetchQuote(symbol) {
    try {
      const response = await this.yahoo("/v7/finance/quote", { symbols: symbol }, { healthCritical: true });
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
    }, { healthCritical: true });
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
    return cached(`yahoo-fundamentals:${symbol}`, FUNDAMENTAL_TTL_MS, () => this.fetchFundamentals(symbol, quote));
  }

  async fetchFundamentals(symbol, quote = {}) {
    let response;
    try {
      response = await this.yahoo2Authed(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
        modules: [
          "assetProfile", "summaryDetail", "financialData", "defaultKeyStatistics", "price",
          "recommendationTrend", "earningsTrend", "earningsHistory", "majorHoldersBreakdown"
        ].join(",")
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
    const recommendation = result.recommendationTrend?.trend?.[0] || {};
    const earningsHistory = result.earningsHistory?.history?.[0] || {};
    const holders = result.majorHoldersBreakdown || {};
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
      pegRatio: candidateEntry([
        ["defaultKeyStatistics.pegRatio", stats.pegRatio],
        ["defaultKeyStatistics.trailingPegRatio", stats.trailingPegRatio]
      ]),
      evToEbitda: candidateEntry([
        ["defaultKeyStatistics.enterpriseToEbitda", stats.enterpriseToEbitda]
      ]),
      evToSales: candidateEntry([
        ["defaultKeyStatistics.enterpriseToRevenue", stats.enterpriseToRevenue]
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
      grossMargin: candidateEntry([
        ["financialData.grossMargins", financial.grossMargins]
      ], percentRaw),
      debtToEquity: candidateEntry([
        ["financialData.debtToEquity", financial.debtToEquity]
      ], normalizeDebt),
      returnOnEquity: candidateEntry([
        ["financialData.returnOnEquity", financial.returnOnEquity]
      ], percentRaw),
      returnOnAssets: candidateEntry([
        ["financialData.returnOnAssets", financial.returnOnAssets]
      ], percentRaw),
      currentRatio: candidateEntry([
        ["financialData.currentRatio", financial.currentRatio]
      ]),
      quickRatio: candidateEntry([
        ["financialData.quickRatio", financial.quickRatio]
      ]),
      cashPerShare: candidateEntry([
        ["financialData.totalCashPerShare", financial.totalCashPerShare]
      ]),
      institutionalOwnership: candidateEntry([
        ["majorHoldersBreakdown.institutionsPercentHeld", holders.institutionsPercentHeld],
        ["defaultKeyStatistics.heldPercentInstitutions", stats.heldPercentInstitutions]
      ], percentRaw),
      shortInterest: candidateEntry([
        ["defaultKeyStatistics.shortPercentOfFloat", stats.shortPercentOfFloat],
        ["defaultKeyStatistics.sharesPercentSharesOut", stats.sharesPercentSharesOut]
      ], percentRaw),
      payoutRatio: candidateEntry([
        ["summaryDetail.payoutRatio", detail.payoutRatio]
      ], percentRaw),
      targetMeanPrice: candidateEntry([
        ["financialData.targetMeanPrice", financial.targetMeanPrice]
      ]),
      earningsSurprise: candidateEntry([
        ["earningsHistory.history[0].surprisePercent", earningsHistory.surprisePercent]
      ], percentMaybe)
    };
    const recommendationTrend = {
      period: recommendation.period || null,
      strongBuy: numberOrNull(recommendation.strongBuy),
      buy: numberOrNull(recommendation.buy),
      hold: numberOrNull(recommendation.hold),
      sell: numberOrNull(recommendation.sell),
      strongSell: numberOrNull(recommendation.strongSell)
    };
    const hasRecommendationTrend = Object.entries(recommendationTrend)
      .some(([key, value]) => key !== "period" && value !== null);
    if (!hasRecommendationTrend) {
      Object.keys(recommendationTrend).forEach((key) => delete recommendationTrend[key]);
    }
    logMetricMappings("Yahoo fundamentals", symbol, mappings, {
      assetProfileFields: Object.keys(profile),
      summaryDetailFields: Object.keys(detail),
      financialDataFields: Object.keys(financial),
      defaultKeyStatisticsFields: Object.keys(stats),
      priceFields: Object.keys(priceBlock),
      recommendationTrendFields: Object.keys(recommendation),
      earningsHistoryFields: Object.keys(earningsHistory),
      majorHoldersFields: Object.keys(holders)
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
      quickRatio: mappings.quickRatio.value,
      cashPerShare: mappings.cashPerShare.value,
      beta: mappings.beta.value,
      forwardPe: mappings.forwardPe.value,
      priceToBook: mappings.priceToBook.value,
      pegRatio: mappings.pegRatio.value,
      evToEbitda: mappings.evToEbitda.value,
      evToSales: mappings.evToSales.value,
      eps: mappings.eps.value,
      dividendYield: mappings.dividendYield.value,
      payoutRatio: mappings.payoutRatio.value,
      averageVolume: mappings.averageVolume.value,
      analystRating: financial.recommendationKey || financial.recommendationMean?.fmt || null,
      recommendationTrend: hasRecommendationTrend ? recommendationTrend : null,
      targetMeanPrice: mappings.targetMeanPrice.value,
      earningsSurprise: mappings.earningsSurprise.value,
      week52High: mappings.week52High.value,
      week52Low: mappings.week52Low.value,
      marketCap: mappings.marketCap.value,
      peRatio: mappings.peRatio.value,
      volume: mappings.volume.value,
      grossMargin: mappings.grossMargin.value,
      returnOnAssets: mappings.returnOnAssets.value,
      institutionalOwnership: mappings.institutionalOwnership.value,
      shortInterest: mappings.shortInterest.value,
      sectorPe: SECTOR_PE[profile.sector || catalog.sector] ?? null,
      style: catalog.style || inferStyle(profile.sector, mappings.beta.value, mappings.peRatio.value),
      fundamentalsUpdatedAt: new Date().toISOString(),
      sources: sourceMap("Yahoo fundamentals", [
        "sector", "industry", "summary", "profitMargin", "revenueGrowth", "earningsGrowth",
        "grossMargin", "debtToEquity", "currentRatio", "quickRatio", "cashPerShare",
        "returnOnAssets", "returnOnEquity", "beta", "forwardPe", "priceToBook", "pegRatio",
        "evToEbitda", "evToSales", "eps", "dividendYield", "payoutRatio", "averageVolume",
        "institutionalOwnership", "shortInterest", "analystRating", "recommendationTrend",
        "targetMeanPrice", "earningsSurprise", "week52High", "week52Low", "marketCap",
        "peRatio", "volume"
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
      "quarterlyGrossProfit",
      "quarterlyFreeCashFlow",
      "quarterlyEBITDA",
      "quarterlyTotalDebt",
      "quarterlyStockholdersEquity",
      "quarterlyTotalAssets",
      "quarterlyCurrentAssets",
      "quarterlyCurrentLiabilities",
      "quarterlyInventory",
      "quarterlyCashCashEquivalentsAndShortTermInvestments",
      "quarterlyCashDividendsPaid",
      "beta",
      "trailingBeta",
      "trailingForwardPeRatio",
      "trailingPegRatio",
      "trailingPbRatio",
      "trailingPayoutRatio",
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
    const grossProfit = latestTimeseriesEntry(series, "quarterlyGrossProfit");
    const freeCashFlow = latestTimeseriesEntry(series, "quarterlyFreeCashFlow");
    const ebitda = latestTimeseriesEntry(series, "quarterlyEBITDA");
    const debt = latestTimeseriesEntry(series, "quarterlyTotalDebt");
    const equity = latestTimeseriesEntry(series, "quarterlyStockholdersEquity");
    const totalAssets = latestTimeseriesEntry(series, "quarterlyTotalAssets");
    const currentAssets = latestTimeseriesEntry(series, "quarterlyCurrentAssets");
    const currentLiabilities = latestTimeseriesEntry(series, "quarterlyCurrentLiabilities");
    const inventory = latestTimeseriesEntry(series, "quarterlyInventory");
    const cash = latestTimeseriesEntry(series, "quarterlyCashCashEquivalentsAndShortTermInvestments");
    const revenueTtm = sumLastSeriesValues(seriesRows(series, "quarterlyTotalRevenue"), 4);
    const netIncomeTtm = sumLastSeriesValues(seriesRows(series, "quarterlyNetIncome"), 4);
    const operatingIncomeTtm = sumLastSeriesValues(seriesRows(series, "quarterlyOperatingIncome"), 4);
    const grossProfitTtm = sumLastSeriesValues(seriesRows(series, "quarterlyGrossProfit"), 4);
    const ebitdaTtm = sumLastSeriesValues(seriesRows(series, "quarterlyEBITDA"), 4);
    const dividendsPaidTtm = sumLastSeriesValues(seriesRows(series, "quarterlyCashDividendsPaid"), 4);
    const price = numberOrNull(quote.price);
    const enterpriseValue = marketCap.value !== null
      ? marketCap.value + (debt.value || 0) - (cash.value || 0)
      : null;
    const derivedPe = trailingPe.value !== null
      ? trailingPe
      : derivedMetricEntry("Yahoo price / Yahoo EPS", { price, eps: eps.value }, price !== null && eps.value > 0 ? price / eps.value : null);
    const mappings = {
      marketCap,
      peRatio: derivedPe,
      forwardPe: latestTimeseriesEntry(series, "trailingForwardPeRatio"),
      pegRatio: firstAvailableEntry([
        latestTimeseriesEntry(series, "trailingPegRatio"),
        derivedMetricEntry(
          "Yahoo P/E / derived EPS growth",
          { pe: derivedPe.value, earningsGrowth: rollingGrowthFromSeries(series, "quarterlyDilutedEPS") },
          derivedPe.value !== null && rollingGrowthFromSeries(series, "quarterlyDilutedEPS") > 0
            ? derivedPe.value / rollingGrowthFromSeries(series, "quarterlyDilutedEPS")
            : null
        )
      ]),
      priceToBook: firstAvailableEntry([
        latestTimeseriesEntry(series, "trailingPbRatio"),
        derivedMetricEntry(
          "Yahoo market cap / stockholders equity",
          { marketCap: marketCap.value, equity: equity.value },
          marketCap.value !== null && equity.value ? marketCap.value / equity.value : null
        )
      ]),
      evToEbitda: derivedMetricEntry(
        "Yahoo derived enterprise value / TTM EBITDA",
        { enterpriseValue, ebitdaTtm },
        enterpriseValue !== null && ebitdaTtm ? enterpriseValue / ebitdaTtm : null
      ),
      evToSales: derivedMetricEntry(
        "Yahoo derived enterprise value / TTM revenue",
        { enterpriseValue, revenueTtm },
        enterpriseValue !== null && revenueTtm ? enterpriseValue / revenueTtm : null
      ),
      eps,
      dividendYield: latestTimeseriesEntry(series, "trailingDividendYield", percentMaybe),
      revenueGrowth: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyTotalRevenue YoY",
        latestSeriesPair(series, "quarterlyTotalRevenue", 4),
        growthFromSeries(series, "quarterlyTotalRevenue", 4)
      ),
      profitMargin: derivedMetricEntry(
        "fundamentals-timeseries.TTM net income / TTM revenue",
        { netIncomeTtm, revenueTtm },
        netIncomeTtm !== null && revenueTtm ? (netIncomeTtm / revenueTtm) * 100 : null
      ),
      operatingMargin: derivedMetricEntry(
        "fundamentals-timeseries.TTM operating income / TTM revenue",
        { operatingIncomeTtm, revenueTtm },
        operatingIncomeTtm !== null && revenueTtm ? (operatingIncomeTtm / revenueTtm) * 100 : null
      ),
      grossMargin: derivedMetricEntry(
        "fundamentals-timeseries.TTM gross profit / TTM revenue",
        { grossProfitTtm, revenueTtm },
        grossProfitTtm !== null && revenueTtm ? (grossProfitTtm / revenueTtm) * 100 : null
      ),
      freeCashFlowGrowth: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyFreeCashFlow YoY",
        latestSeriesPair(series, "quarterlyFreeCashFlow", 4),
        growthFromSeries(series, "quarterlyFreeCashFlow", 4)
      ),
      debtToEquity: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyTotalDebt / quarterlyStockholdersEquity",
        { debt: debt.value, equity: equity.value },
        debt.value !== null && equity.value ? normalizeDebt(debt.value / equity.value) : null
      ),
      beta: firstAvailableEntry([
        latestTimeseriesEntry(series, "beta"),
        latestTimeseriesEntry(series, "trailingBeta")
      ]),
      earningsGrowth: derivedMetricEntry(
        "fundamentals-timeseries.trailing EPS growth",
        {
          dilutedEpsGrowth: rollingGrowthFromSeries(series, "quarterlyDilutedEPS"),
          netIncomeGrowth: rollingGrowthFromSeries(series, "quarterlyNetIncome")
        },
        rollingGrowthFromSeries(series, "quarterlyDilutedEPS")
          ?? rollingGrowthFromSeries(series, "quarterlyNetIncome")
      ),
      returnOnEquity: derivedMetricEntry(
        "fundamentals-timeseries.TTM net income / stockholders equity",
        { netIncomeTtm, equity: equity.value },
        netIncomeTtm !== null && equity.value ? (netIncomeTtm / equity.value) * 100 : null
      ),
      returnOnAssets: derivedMetricEntry(
        "fundamentals-timeseries.TTM net income / total assets",
        { netIncomeTtm, totalAssets: totalAssets.value },
        netIncomeTtm !== null && totalAssets.value ? (netIncomeTtm / totalAssets.value) * 100 : null
      ),
      currentRatio: derivedMetricEntry(
        "fundamentals-timeseries.quarterlyCurrentAssets / quarterlyCurrentLiabilities",
        { currentAssets: currentAssets.value, currentLiabilities: currentLiabilities.value },
        currentAssets.value !== null && currentLiabilities.value ? currentAssets.value / currentLiabilities.value : null
      ),
      quickRatio: derivedMetricEntry(
        "fundamentals-timeseries.(current assets - inventory) / current liabilities",
        { currentAssets: currentAssets.value, inventory: inventory.value, currentLiabilities: currentLiabilities.value },
        currentAssets.value !== null && currentLiabilities.value
          ? (currentAssets.value - (inventory.value || 0)) / currentLiabilities.value
          : null
      ),
      cashPerShare: derivedMetricEntry(
        "fundamentals-timeseries.cash / inferred shares",
        { cash: cash.value, marketCap: marketCap.value, price },
        cash.value !== null && marketCap.value && price ? cash.value / (marketCap.value / price) : null
      ),
      payoutRatio: firstAvailableEntry([
        latestTimeseriesEntry(series, "trailingPayoutRatio", percentMaybe),
        derivedMetricEntry(
          "fundamentals-timeseries.TTM dividends paid / TTM net income",
          { dividendsPaidTtm, netIncomeTtm },
          dividendsPaidTtm !== null && netIncomeTtm ? (Math.abs(dividendsPaidTtm) / Math.abs(netIncomeTtm)) * 100 : null
        )
      ])
    };
    logMetricMappings("Yahoo fundamentals timeseries", symbol, mappings, {
      timeseriesTypes: Object.keys(series)
    });
    const values = Object.fromEntries(Object.entries(mappings).map(([field, entry]) => [field, entry.value]));
    const availableFields = Object.entries(values).filter(([, value]) => value !== null).map(([field]) => field);
    const sources = sourceMap("Yahoo fundamentals timeseries", availableFields);
    if (mappings.peRatio.sourceField === "Yahoo price / Yahoo EPS") sources.peRatio = "Derived from Yahoo price and EPS";
    ["pegRatio", "priceToBook", "evToEbitda", "evToSales", "earningsGrowth", "returnOnEquity",
      "returnOnAssets", "currentRatio", "quickRatio", "cashPerShare", "payoutRatio"].forEach((field) => {
      if (mappings[field]?.sourceField?.startsWith("Yahoo") || mappings[field]?.sourceField?.startsWith("fundamentals-timeseries.")) {
        sources[field] = "Derived from Yahoo fundamentals timeseries";
      }
    });
    if (mappings.profitMargin.value !== null) sources.profitMargin = "Derived from Yahoo fundamentals timeseries";
    if (mappings.operatingMargin.value !== null) sources.operatingMargin = "Derived from Yahoo fundamentals timeseries";
    if (mappings.grossMargin.value !== null) sources.grossMargin = "Derived from Yahoo fundamentals timeseries";
    if (mappings.debtToEquity.value !== null) sources.debtToEquity = "Derived from Yahoo fundamentals timeseries";
    if (mappings.revenueGrowth.value !== null) sources.revenueGrowth = "Derived from Yahoo fundamentals timeseries";
    if (mappings.freeCashFlowGrowth.value !== null) sources.freeCashFlowGrowth = "Derived from Yahoo fundamentals timeseries";
    if (mappings.returnOnAssets.value !== null) sources.returnOnAssets = "Derived from Yahoo fundamentals timeseries";
    if (mappings.currentRatio.value !== null) sources.currentRatio = "Derived from Yahoo fundamentals timeseries";
    if (mappings.cashPerShare.value !== null) sources.cashPerShare = "Derived from Yahoo fundamentals timeseries";
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
    return cached(`yahoo-history:${symbol}`, HISTORY_TTL_MS, () => this.fetchHistory(symbol));
  }

  async fetchHistory(symbol) {
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
    return cached(`yahoo-news:${symbol}`, NEWS_TTL_MS, () => this.fetchNews(symbol));
  }

  async fetchNews(symbol) {
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
    this.apiKey = String(apiKey || "").trim();
  }

  async request(pathname, params = {}, options = {}) {
    if (!this.apiKey) throw new Error("FINNHUB_API_KEY is not configured");
    const url = new URL(pathname, "https://finnhub.io/api/v1/");
    Object.entries({ ...params, token: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, {
      providerName: "Finnhub",
      operation: options.operation || pathname,
      healthCritical: Boolean(options.healthCritical)
    });
  }

  async search(query, filters = {}) {
    const response = await this.request("search", { q: query || "market" }, {
      operation: "symbol search",
      healthCritical: true
    });
    if (!Array.isArray(response.result) || !response.result.length) {
      throw providerError("Finnhub", "symbol search", "invalid_response", null, "Finnhub returned no search results.");
    }
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

  async getQuote(symbol) {
    return cached(`finnhub-quote:${symbol}`, QUOTE_TTL_MS, async () => {
      const quote = await this.request("quote", { symbol }, {
        operation: `quote ${symbol}`,
        healthCritical: true
      });
      if (!isValidFinnhubQuote(quote)) {
        const error = providerError("Finnhub", `quote ${symbol}`, "invalid_response", null, `Finnhub returned an empty or invalid quote for ${symbol}.`);
        recordProviderFailure("Finnhub", `quote ${symbol}`, error, true);
        console.warn(`[Aurex] Finnhub quote ${symbol} failed: ${providerFailureDescription(error)}`);
        error.logged = true;
        throw error;
      }
      return quote;
    });
  }

  async getProfile(symbol) {
    return cached(`finnhub-profile:${symbol}`, PROFILE_TTL_MS, async () => {
      // Finnhub calls this "Company Profile 2"; the API route is stock/profile2.
      const profile = await this.request("stock/profile2", { symbol }, {
        operation: `company profile2 ${symbol}`
      });
      if (!profile || typeof profile !== "object" || !Object.keys(profile).length) {
        throw providerError("Finnhub", `company profile2 ${symbol}`, "invalid_response", null, `Finnhub returned an empty company profile for ${symbol}.`);
      }
      return profile;
    });
  }

  async getMetrics(symbol) {
    return cached(`finnhub-fundamentals:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const response = await this.request("stock/metric", { symbol, metric: "all" }, {
        operation: `stock metric all ${symbol}`
      });
      const metrics = response?.metric;
      if (!metrics || typeof metrics !== "object" || !Object.keys(metrics).length) {
        throw providerError("Finnhub", `stock metric all ${symbol}`, "invalid_response", null, `Finnhub returned empty basic financials for ${symbol}.`);
      }
      return metrics;
    });
  }

  async getHistory(symbol) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 365 * 24 * 60 * 60;
    return cached(`finnhub-history:${symbol}`, HISTORY_TTL_MS, async () => {
      const candles = await this.request("stock/candle", { symbol, resolution: "D", from, to }, {
        operation: `price history ${symbol}`
      });
      if (candles?.s !== "ok" || !Array.isArray(candles.t)) return { history: [], volume: null };
      const history = candles.t.map((time, index) => ({
        date: new Date(time * 1000).toISOString().slice(0, 10),
        close: numberOrNull(candles.c?.[index])
      })).filter((point) => point.close !== null);
      return {
        history,
        volume: numberOrNull(candles.v?.at(-1))
      };
    });
  }

  async getNews(symbol) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 21);
    return cached(`finnhub-news:${symbol}`, NEWS_TTL_MS, async () => {
      const news = await this.request("company-news", {
        symbol,
        from: start.toISOString().slice(0, 10),
        to: today.toISOString().slice(0, 10)
      }, { operation: `company news ${symbol}` });
      if (!Array.isArray(news)) {
        throw providerError("Finnhub", `company news ${symbol}`, "invalid_response", null, `Finnhub returned invalid news for ${symbol}.`);
      }
      return news.slice(0, 5).map((item) => normalizeNews({
        headline: item.headline,
        source: item.source,
        date: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
        summary: item.summary,
        url: item.url
      }));
    });
  }

  async getEarnings(symbol) {
    const today = new Date();
    return cached(`finnhub-earnings:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const [earningsHistory, earningsCalendar] = await Promise.all([
        this.request("stock/earnings", { symbol, limit: "4" }, {
          operation: `earnings history ${symbol}`
        }),
        this.request("calendar/earnings", {
          symbol,
          from: today.toISOString().slice(0, 10),
          to: new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        }, { operation: `earnings calendar ${symbol}` })
      ]);
      return {
        recent: Array.isArray(earningsHistory) ? earningsHistory[0] || null : null,
        next: earningsCalendar?.earningsCalendar?.[0] || null
      };
    });
  }

  async getSupplementalFundamentals(symbol) {
    return cached(`finnhub-supplemental:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const requests = [
        ["recommendation", this.request("stock/recommendation", { symbol }, { operation: `recommendation trends ${symbol}` })],
        ["priceTarget", this.request("stock/price-target", { symbol }, { operation: `price target ${symbol}` })],
        ["ownership", this.request("stock/ownership", { symbol, limit: "1" }, { operation: `institutional ownership ${symbol}` })],
        ["shortInterest", this.request("stock/short-interest", { symbol }, { operation: `short interest ${symbol}` })]
      ];
      const settled = await Promise.allSettled(requests.map(([, request]) => request));
      return Object.fromEntries(requests.map(([key], index) => {
        const result = settled[index];
        return [key, result.status === "fulfilled" ? result.value : null];
      }));
    });
  }

  async getAsset(symbol) {
    const normalized = normalizeSymbol(symbol);
    const quote = await this.getQuote(normalized);
    const [profile, metrics, historyResult, news, earnings, supplemental] = await Promise.all([
      optionalProviderData("Finnhub", `company profile2 ${normalized}`, () => this.getProfile(normalized), {}),
      optionalProviderData("Finnhub", `stock metric all ${normalized}`, () => this.getMetrics(normalized), {}),
      optionalProviderData("Finnhub", `price history ${normalized}`, () => this.getHistory(normalized), { history: [], volume: null }),
      optionalProviderData("Finnhub", `company news ${normalized}`, () => this.getNews(normalized), []),
      optionalProviderData("Finnhub", `earnings ${normalized}`, () => this.getEarnings(normalized), { recent: null, next: null }),
      optionalProviderData("Finnhub", `supplemental fundamentals ${normalized}`, () => this.getSupplementalFundamentals(normalized), {})
    ]);
    const catalog = CATALOG_BY_SYMBOL[normalized] || {};
    const mappings = buildFinnhubMetricMappings(profile, metrics);
    const recommendation = Array.isArray(supplemental.recommendation) ? supplemental.recommendation[0] || {} : {};
    const priceTarget = supplemental.priceTarget || {};
    const ownershipRows = supplemental.ownership?.ownership || supplemental.ownership?.data || [];
    const ownership = Array.isArray(ownershipRows) ? ownershipRows[0] || {} : {};
    const shortRows = supplemental.shortInterest?.data || supplemental.shortInterest?.shortInterest || [];
    const shortInterest = Array.isArray(shortRows) ? shortRows[0] || {} : supplemental.shortInterest || {};
    mappings.institutionalOwnership = candidateEntry([
      ["stock/ownership.percentage", ownership.percentage],
      ["stock/ownership.ownershipPercent", ownership.ownershipPercent],
      ["stock/ownership.institutionalOwnership", ownership.institutionalOwnership]
    ], percentMaybe);
    mappings.shortInterest = candidateEntry([
      ["stock/short-interest.shortInterestPercent", shortInterest.shortInterestPercent],
      ["stock/short-interest.shortPercentOfFloat", shortInterest.shortPercentOfFloat],
      ["stock/short-interest.percentFloat", shortInterest.percentFloat]
    ], percentMaybe);
    mappings.targetMeanPrice = candidateEntry([
      ["stock/price-target.targetMean", priceTarget.targetMean],
      ["stock/price-target.targetMedian", priceTarget.targetMedian]
    ]);
    mappings.volume = candidateEntry([
      ["stock/candle.v[last]", historyResult.volume]
    ]);
    logMetricMappings("Finnhub quote/profile2/metric", normalized, mappings, {
      quoteFields: Object.keys(quote),
      profileFields: Object.keys(profile),
      metricFields: Object.keys(metrics),
      historyPoints: historyResult.history.length,
      newsItems: news.length,
      recommendationFields: Object.keys(recommendation),
      priceTargetFields: Object.keys(priceTarget),
      ownershipFields: Object.keys(ownership),
      shortInterestFields: Object.keys(shortInterest)
    });
    const currentPrice = numberOrNull(quote.c);
    const recentEarnings = earnings.recent;
    const nextEarnings = earnings.next;
    const fundamentalFields = [
      "marketCap", "peRatio", "forwardPe", "priceToBook", "eps", "dividendYield",
      "week52High", "week52Low", "averageVolume", "revenueGrowth", "earningsGrowth",
      "profitMargin", "operatingMargin", "grossMargin", "debtToEquity", "returnOnEquity",
      "returnOnAssets", "currentRatio", "quickRatio", "cashPerShare", "beta", "pegRatio",
      "evToEbitda", "evToSales", "freeCashFlowGrowth", "payoutRatio", "institutionalOwnership",
      "shortInterest", "targetMeanPrice"
    ];
    const fundamentalSources = Object.fromEntries(fundamentalFields
      .filter((field) => mappings[field]?.value !== null)
      .map((field) => [field, "Finnhub"]));
    const profileSources = sourceMap("Finnhub", [
      "name", "exchange", "sector", "industry", "logo", "currency"
    ].filter((field) => {
      const value = field === "sector" || field === "industry" ? profile.finnhubIndustry : profile[field];
      return value !== null && value !== undefined && value !== "";
    }));
    if (mappings.volume.value !== null) fundamentalSources.volume = "Finnhub price history";
    const optionalMissing = [];
    if (!Object.keys(profile).length) optionalMissing.push("company profile");
    if (!Object.keys(metrics).length) optionalMissing.push("basic financials");
    if (!historyResult.history.length) optionalMissing.push("price history/volume");
    if (!news.length) optionalMissing.push("news");

    return normalizeAsset({
      symbol: normalized,
      name: profile.name || catalog.name || normalized,
      assetType: catalog.assetType || "EQUITY",
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
      pegRatio: mappings.pegRatio.value,
      evToEbitda: mappings.evToEbitda.value,
      evToSales: mappings.evToSales.value,
      eps: mappings.eps.value,
      dividendYield: mappings.dividendYield.value,
      payoutRatio: mappings.payoutRatio.value,
      week52High: mappings.week52High.value,
      week52Low: mappings.week52Low.value,
      volume: mappings.volume.value,
      averageVolume: mappings.averageVolume.value,
      revenueGrowth: mappings.revenueGrowth.value,
      earningsGrowth: mappings.earningsGrowth.value,
      freeCashFlowGrowth: mappings.freeCashFlowGrowth.value,
      grossMargin: mappings.grossMargin.value,
      profitMargin: mappings.profitMargin.value,
      operatingMargin: mappings.operatingMargin.value,
      debtToEquity: mappings.debtToEquity.value,
      returnOnEquity: mappings.returnOnEquity.value,
      returnOnAssets: mappings.returnOnAssets.value,
      currentRatio: mappings.currentRatio.value,
      quickRatio: mappings.quickRatio.value,
      cashPerShare: mappings.cashPerShare.value,
      beta: mappings.beta.value,
      institutionalOwnership: mappings.institutionalOwnership.value,
      shortInterest: mappings.shortInterest.value,
      analystRating: recommendationToLabel(recommendation),
      recommendationTrend: Object.keys(recommendation).length ? recommendation : null,
      targetMeanPrice: mappings.targetMeanPrice.value,
      nextEarningsDate: nextEarnings?.date || null,
      earningsSurprise: recentEarnings && numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise) !== null
        ? numberOrNull(recentEarnings.surprisePercent ?? recentEarnings.surprise)
        : null,
      recentEarningsPeriod: recentEarnings?.period || null,
      sectorPe: SECTOR_PE[catalog.sector || profile.finnhubIndustry] ?? null,
      style: catalog.style || "Unknown",
      summary: profile.description || "",
      marketState: "Finnhub quote",
      history: historyResult.history,
      news,
      provider: "Finnhub",
      live: currentPrice !== null,
      lastUpdated: quote.t ? new Date(quote.t * 1000).toISOString() : new Date().toISOString(),
      fundamentalsUpdatedAt: Object.keys(metrics).length || Object.keys(profile).length ? new Date().toISOString() : null,
      sources: mergeSources(
        sourceMap("Finnhub", ["price", "previousClose", "change", "changePercent", "open", "dayHigh", "dayLow", "lastUpdated"]),
        profileSources,
        fundamentalSources,
        historyResult.history.length ? sourceMap("Finnhub price history", ["history"]) : {},
        news.length ? sourceMap("Finnhub news", ["news"]) : {},
        nextEarnings || recentEarnings ? sourceMap("Finnhub", ["nextEarningsDate", "earningsSurprise", "recentEarningsPeriod"]) : {},
        Object.keys(recommendation).length ? sourceMap("Finnhub", ["analystRating", "recommendationTrend"]) : {}
      ),
      sourceNote: optionalMissing.length
        ? `Finnhub supplied the live quote. Optional Finnhub data unavailable: ${optionalMissing.join(", ")}. Secondary providers may fill missing fields.`
        : "Finnhub supplied the quote, company profile, basic financials, history, and news."
    });
  }
}

class AlphaVantageProvider extends MarketProvider {
  constructor(apiKey) {
    super("Alpha Vantage");
    this.apiKey = String(apiKey || "").trim();
  }

  async request(params) {
    if (!this.apiKey) throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
    const url = new URL("https://www.alphavantage.co/query");
    Object.entries({ ...params, apikey: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const operation = String(params.function || "request");
    const json = await fetchJson(url, { providerName: "Alpha Vantage", operation });
    if (json.Note || json.Information) {
      throw providerError("Alpha Vantage", operation, "rate_limit", 429, json.Note || json.Information);
    }
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

  async getFundamentalOverlay(symbol) {
    return cached(`alphavantage-fundamentals:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const [overviewResult, earningsResult] = await Promise.allSettled([
        this.request({ function: "OVERVIEW", symbol }),
        this.request({ function: "EARNINGS", symbol })
      ]);
      if (overviewResult.status === "rejected" && earningsResult.status === "rejected") {
        throw overviewResult.reason;
      }
      const overview = overviewResult.status === "fulfilled" ? overviewResult.value : {};
      const earnings = earningsResult.status === "fulfilled" ? earningsResult.value : {};
      const latestEarnings = earnings.quarterlyEarnings?.[0] || {};
      const mappings = {
        marketCap: candidateEntry([["OVERVIEW.MarketCapitalization", overview.MarketCapitalization]]),
        peRatio: candidateEntry([["OVERVIEW.PERatio", overview.PERatio]]),
        forwardPe: candidateEntry([["OVERVIEW.ForwardPE", overview.ForwardPE]]),
        pegRatio: candidateEntry([["OVERVIEW.PEGRatio", overview.PEGRatio]]),
        priceToBook: candidateEntry([["OVERVIEW.PriceToBookRatio", overview.PriceToBookRatio]]),
        evToEbitda: candidateEntry([["OVERVIEW.EVToEBITDA", overview.EVToEBITDA]]),
        evToSales: candidateEntry([["OVERVIEW.EVToRevenue", overview.EVToRevenue]]),
        eps: candidateEntry([["OVERVIEW.EPS", overview.EPS]]),
        dividendYield: candidateEntry([["OVERVIEW.DividendYield", overview.DividendYield]], percentMaybe),
        payoutRatio: candidateEntry([["OVERVIEW.PayoutRatio", overview.PayoutRatio]], percentMaybe),
        revenueGrowth: candidateEntry([["OVERVIEW.QuarterlyRevenueGrowthYOY", overview.QuarterlyRevenueGrowthYOY]], percentMaybe),
        earningsGrowth: candidateEntry([["OVERVIEW.QuarterlyEarningsGrowthYOY", overview.QuarterlyEarningsGrowthYOY]], percentMaybe),
        profitMargin: candidateEntry([["OVERVIEW.ProfitMargin", overview.ProfitMargin]], percentMaybe),
        operatingMargin: candidateEntry([["OVERVIEW.OperatingMarginTTM", overview.OperatingMarginTTM]], percentMaybe),
        returnOnEquity: candidateEntry([["OVERVIEW.ReturnOnEquityTTM", overview.ReturnOnEquityTTM]], percentMaybe),
        returnOnAssets: candidateEntry([["OVERVIEW.ReturnOnAssetsTTM", overview.ReturnOnAssetsTTM]], percentMaybe),
        beta: candidateEntry([["OVERVIEW.Beta", overview.Beta]]),
        targetMeanPrice: candidateEntry([["OVERVIEW.AnalystTargetPrice", overview.AnalystTargetPrice]]),
        week52High: candidateEntry([["OVERVIEW.52WeekHigh", overview["52WeekHigh"]]]),
        week52Low: candidateEntry([["OVERVIEW.52WeekLow", overview["52WeekLow"]]]),
        earningsSurprise: candidateEntry([["EARNINGS.quarterlyEarnings[0].surprisePercentage", latestEarnings.surprisePercentage]], percentMaybe)
      };
      logMetricMappings("Alpha Vantage overview/earnings", symbol, mappings, {
        overviewFields: Object.keys(overview),
        earningsFields: Object.keys(latestEarnings)
      });
      const values = mappingValues(mappings);
      const analystRating = alphaAnalystRating(overview);
      return {
        ...values,
        name: overview.Name || null,
        assetType: overview.AssetType || null,
        exchange: overview.Exchange || null,
        sector: overview.Sector || null,
        industry: overview.Industry || null,
        currency: overview.Currency || null,
        analystRating,
        recommendationTrend: alphaRecommendationTrend(overview),
        recentEarningsPeriod: latestEarnings.fiscalDateEnding || null,
        fundamentalsUpdatedAt: new Date().toISOString(),
        sources: sourceMapForAvailable("Alpha Vantage", {
          ...values,
          analystRating,
          recommendationTrend: alphaRecommendationTrend(overview),
          recentEarningsPeriod: latestEarnings.fiscalDateEnding || null
        })
      };
    });
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

class FinancialModelingPrepProvider extends MarketProvider {
  constructor(apiKey) {
    super("Financial Modeling Prep");
    this.apiKey = String(apiKey || "").trim();
  }

  async request(pathname, params = {}) {
    if (!this.apiKey) throw new Error("FMP_API_KEY is not configured");
    const url = new URL(pathname, "https://financialmodelingprep.com/stable/");
    Object.entries({ ...params, apikey: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const json = await fetchJson(url, {
      providerName: "Financial Modeling Prep",
      operation: pathname
    });
    if (json?.["Error Message"] || json?.error) {
      throw providerError(
        "Financial Modeling Prep",
        pathname,
        /limit/i.test(json["Error Message"] || json.error) ? "rate_limit" : "invalid_response",
        null,
        json["Error Message"] || json.error
      );
    }
    return json;
  }

  async getFundamentalOverlay(symbol) {
    return cached(`fmp-fundamentals:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const endpoints = [
        ["profile", "profile"],
        ["ratios", "ratios-ttm"],
        ["keyMetrics", "key-metrics-ttm"],
        ["growth", "financial-growth"],
        ["estimates", "analyst-estimates"],
        ["consensus", "grades-consensus"]
      ];
      const settled = await Promise.allSettled(endpoints.map(([, endpoint]) => {
        return this.request(endpoint, { symbol, limit: "5" });
      }));
      const payloads = Object.fromEntries(endpoints.map(([key], index) => {
        return [key, settled[index].status === "fulfilled" ? firstObject(settled[index].value) : {}];
      }));
      if (settled.every((result) => result.status === "rejected")) throw settled[0].reason;
      const { profile, ratios, keyMetrics, growth, estimates, consensus } = payloads;
      const mappings = {
        marketCap: candidateEntry([["profile.marketCap", profile.marketCap], ["key-metrics-ttm.marketCapTTM", keyMetrics.marketCapTTM]]),
        peRatio: candidateEntry([["ratios-ttm.priceToEarningsRatioTTM", ratios.priceToEarningsRatioTTM], ["ratios-ttm.peRatioTTM", ratios.peRatioTTM]]),
        forwardPe: candidateEntry([["analyst-estimates.estimatedEpsAvg/current price", estimates.estimatedEpsAvg && profile.price ? profile.price / estimates.estimatedEpsAvg : null]]),
        pegRatio: candidateEntry([["ratios-ttm.priceToEarningsGrowthRatioTTM", ratios.priceToEarningsGrowthRatioTTM], ["ratios-ttm.pegRatioTTM", ratios.pegRatioTTM]]),
        priceToBook: candidateEntry([["ratios-ttm.priceToBookRatioTTM", ratios.priceToBookRatioTTM]]),
        evToEbitda: candidateEntry([["key-metrics-ttm.enterpriseValueOverEBITDATTM", keyMetrics.enterpriseValueOverEBITDATTM], ["ratios-ttm.enterpriseValueMultipleTTM", ratios.enterpriseValueMultipleTTM]]),
        evToSales: candidateEntry([["key-metrics-ttm.evToSalesTTM", keyMetrics.evToSalesTTM], ["ratios-ttm.enterpriseValueToSalesRatioTTM", ratios.enterpriseValueToSalesRatioTTM]]),
        dividendYield: candidateEntry([["ratios-ttm.dividendYieldTTM", ratios.dividendYieldTTM]], percentMaybe),
        payoutRatio: candidateEntry([["ratios-ttm.payoutRatioTTM", ratios.payoutRatioTTM]], percentMaybe),
        revenueGrowth: candidateEntry([["financial-growth.revenueGrowth", growth.revenueGrowth]], percentMaybe),
        earningsGrowth: candidateEntry([["financial-growth.epsgrowth", growth.epsgrowth], ["financial-growth.epsGrowth", growth.epsGrowth]], percentMaybe),
        freeCashFlowGrowth: candidateEntry([["financial-growth.freeCashFlowGrowth", growth.freeCashFlowGrowth]], percentMaybe),
        grossMargin: candidateEntry([["ratios-ttm.grossProfitMarginTTM", ratios.grossProfitMarginTTM]], percentMaybe),
        operatingMargin: candidateEntry([["ratios-ttm.operatingProfitMarginTTM", ratios.operatingProfitMarginTTM]], percentMaybe),
        profitMargin: candidateEntry([["ratios-ttm.netProfitMarginTTM", ratios.netProfitMarginTTM]], percentMaybe),
        debtToEquity: candidateEntry([["ratios-ttm.debtToEquityRatioTTM", ratios.debtToEquityRatioTTM]], normalizeDebt),
        returnOnEquity: candidateEntry([["ratios-ttm.returnOnEquityTTM", ratios.returnOnEquityTTM]], percentMaybe),
        returnOnAssets: candidateEntry([["ratios-ttm.returnOnAssetsTTM", ratios.returnOnAssetsTTM]], percentMaybe),
        currentRatio: candidateEntry([["ratios-ttm.currentRatioTTM", ratios.currentRatioTTM]]),
        quickRatio: candidateEntry([["ratios-ttm.quickRatioTTM", ratios.quickRatioTTM]]),
        cashPerShare: candidateEntry([["key-metrics-ttm.cashPerShareTTM", keyMetrics.cashPerShareTTM]]),
        targetMeanPrice: candidateEntry([["analyst-estimates.estimatedPriceTargetAvg", estimates.estimatedPriceTargetAvg], ["analyst-estimates.estimatedPriceAvg", estimates.estimatedPriceAvg]]),
        beta: candidateEntry([["profile.beta", profile.beta]])
      };
      logMetricMappings("Financial Modeling Prep", symbol, mappings, {
        profileFields: Object.keys(profile),
        ratioFields: Object.keys(ratios),
        keyMetricFields: Object.keys(keyMetrics),
        growthFields: Object.keys(growth),
        estimateFields: Object.keys(estimates),
        consensusFields: Object.keys(consensus)
      });
      const values = mappingValues(mappings);
      const analystRating = consensus.consensus || consensus.rating || null;
      const recommendationTrend = fmpRecommendationTrend(consensus);
      return {
        ...values,
        name: profile.companyName || null,
        exchange: profile.exchangeShortName || profile.exchange || null,
        sector: profile.sector || null,
        industry: profile.industry || null,
        currency: profile.currency || null,
        analystRating,
        recommendationTrend,
        fundamentalsUpdatedAt: new Date().toISOString(),
        sources: sourceMapForAvailable("Financial Modeling Prep", {
          ...values,
          analystRating,
          recommendationTrend
        })
      };
    });
  }
}

class PolygonFundamentalsProvider extends MarketProvider {
  constructor(apiKey) {
    super("Polygon");
    this.apiKey = String(apiKey || "").trim();
  }

  async request(pathname, params = {}) {
    if (!this.apiKey) throw new Error("POLYGON_API_KEY is not configured");
    const url = new URL(pathname, "https://api.polygon.io/");
    Object.entries({ ...params, apiKey: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url, { providerName: "Polygon", operation: pathname });
  }

  async getFundamentalOverlay(symbol, asset = {}) {
    return cached(`polygon-fundamentals:${symbol}`, FUNDAMENTAL_TTL_MS, async () => {
      const [detailsResult, financialsResult] = await Promise.allSettled([
        this.request(`v3/reference/tickers/${encodeURIComponent(symbol)}`),
        this.request("vX/reference/financials", {
          ticker: symbol,
          timeframe: "ttm",
          order: "desc",
          sort: "filing_date",
          limit: "2"
        })
      ]);
      if (detailsResult.status === "rejected" && financialsResult.status === "rejected") {
        throw detailsResult.reason;
      }
      const details = detailsResult.status === "fulfilled" ? detailsResult.value?.results || {} : {};
      const financialRows = financialsResult.status === "fulfilled" ? financialsResult.value?.results || [] : [];
      const latest = financialRows[0]?.financials || {};
      const previous = financialRows[1]?.financials || {};
      const income = latest.income_statement || {};
      const balance = latest.balance_sheet || {};
      const cashFlow = latest.cash_flow_statement || {};
      const previousIncome = previous.income_statement || {};
      const previousCashFlow = previous.cash_flow_statement || {};
      const revenue = polygonValue(income, ["revenues", "revenue"]);
      const netIncome = polygonValue(income, ["net_income_loss", "net_income"]);
      const grossProfit = polygonValue(income, ["gross_profit"]);
      const operatingIncome = polygonValue(income, ["operating_income_loss", "operating_income"]);
      const equity = polygonValue(balance, ["equity", "stockholders_equity"]);
      const assets = polygonValue(balance, ["assets"]);
      const currentAssets = polygonValue(balance, ["current_assets"]);
      const currentLiabilities = polygonValue(balance, ["current_liabilities"]);
      const debt = sumNumbers([
        polygonValue(balance, ["long_term_debt"]),
        polygonValue(balance, ["current_debt"])
      ]);
      const cash = polygonValue(balance, ["cash_and_cash_equivalents", "cash"]);
      const eps = polygonValue(income, ["diluted_earnings_per_share", "basic_earnings_per_share"]);
      const marketCap = numberOrNull(details.market_cap);
      const price = numberOrNull(asset.price);
      const shares = numberOrNull(details.share_class_shares_outstanding ?? details.weighted_shares_outstanding);
      const freeCashFlow = polygonFreeCashFlow(cashFlow);
      const priorFreeCashFlow = polygonFreeCashFlow(previousCashFlow);
      const priorRevenue = polygonValue(previousIncome, ["revenues", "revenue"]);
      const mappings = {
        marketCap: candidateEntry([["ticker-details.market_cap", marketCap]]),
        peRatio: derivedMetricEntry("Polygon price / diluted EPS", { price, eps }, price !== null && eps > 0 ? price / eps : null),
        priceToBook: derivedMetricEntry("Polygon market cap / equity", { marketCap, equity }, marketCap !== null && equity > 0 ? marketCap / equity : null),
        eps: candidateEntry([["financials.diluted_earnings_per_share", eps]]),
        revenueGrowth: derivedMetricEntry("Polygon TTM revenue growth", { revenue, priorRevenue }, revenue !== null && priorRevenue ? ((revenue - priorRevenue) / Math.abs(priorRevenue)) * 100 : null),
        freeCashFlowGrowth: derivedMetricEntry("Polygon TTM free cash flow growth", { freeCashFlow, priorFreeCashFlow }, freeCashFlow !== null && priorFreeCashFlow ? ((freeCashFlow - priorFreeCashFlow) / Math.abs(priorFreeCashFlow)) * 100 : null),
        grossMargin: derivedMetricEntry("Polygon gross profit / revenue", { grossProfit, revenue }, grossProfit !== null && revenue ? (grossProfit / revenue) * 100 : null),
        operatingMargin: derivedMetricEntry("Polygon operating income / revenue", { operatingIncome, revenue }, operatingIncome !== null && revenue ? (operatingIncome / revenue) * 100 : null),
        profitMargin: derivedMetricEntry("Polygon net income / revenue", { netIncome, revenue }, netIncome !== null && revenue ? (netIncome / revenue) * 100 : null),
        debtToEquity: derivedMetricEntry("Polygon debt / equity", { debt, equity }, debt !== null && equity ? normalizeDebt(debt / equity) : null),
        returnOnEquity: derivedMetricEntry("Polygon net income / equity", { netIncome, equity }, netIncome !== null && equity ? (netIncome / equity) * 100 : null),
        returnOnAssets: derivedMetricEntry("Polygon net income / assets", { netIncome, assets }, netIncome !== null && assets ? (netIncome / assets) * 100 : null),
        currentRatio: derivedMetricEntry("Polygon current assets / current liabilities", { currentAssets, currentLiabilities }, currentAssets !== null && currentLiabilities ? currentAssets / currentLiabilities : null),
        cashPerShare: derivedMetricEntry("Polygon cash / shares outstanding", { cash, shares }, cash !== null && shares ? cash / shares : null)
      };
      logMetricMappings("Polygon reference/financials", symbol, mappings, {
        detailFields: Object.keys(details),
        incomeFields: Object.keys(income),
        balanceSheetFields: Object.keys(balance),
        cashFlowFields: Object.keys(cashFlow)
      });
      const values = mappingValues(mappings);
      return {
        ...values,
        name: details.name || null,
        assetType: details.type || null,
        exchange: details.primary_exchange || null,
        currency: details.currency_name?.toUpperCase() || null,
        industry: details.sic_description || null,
        fundamentalsUpdatedAt: new Date().toISOString(),
        sources: sourceMapForAvailable("Polygon", values)
      };
    });
  }
}

function createProvider() {
  if (MARKET_PROVIDER === "auto") return new HybridMarketProvider(FINNHUB_API_KEY, MARKET_PROVIDER);
  if (MARKET_PROVIDER === "finnhub") return new HybridMarketProvider(FINNHUB_API_KEY, MARKET_PROVIDER);
  if (MARKET_PROVIDER === "alphavantage") return new AlphaVantageProvider(ALPHA_VANTAGE_API_KEY);
  return new HybridMarketProvider("", MARKET_PROVIDER);
}

const provider = createProvider();

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "OPTIONS") return send(response, 204, "");
    if (url.pathname === "/api/provider-status") {
      await probeConfiguredProvider();
      return json(response, providerStatusSnapshot());
    }
    if (url.pathname === "/api/health") {
      return json(response, {
        ok: true,
        provider: provider.name,
        configuredProvider: MARKET_PROVIDER,
        status: provider.name.includes("Stooq") ? "live-or-delayed" : "live-when-provider-available",
        timestamp: new Date().toISOString(),
        fallbackCatalogSize: CATALOG.length,
        env: {
          finnhubConfigured: Boolean(FINNHUB_API_KEY),
          alphaVantageConfigured: Boolean(ALPHA_VANTAGE_API_KEY),
          financialModelingPrepConfigured: Boolean(FMP_API_KEY),
          polygonConfigured: Boolean(POLYGON_API_KEY),
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
    console.log(`[Aurex] Market provider: ${provider.name} (MARKET_PROVIDER=${MARKET_PROVIDER})`);
    console.log(`[Aurex] Finnhub key detected: ${Boolean(FINNHUB_API_KEY)}`);
    console.log(`[Aurex] Optional fundamentals: Alpha Vantage=${Boolean(ALPHA_VANTAGE_API_KEY)}, FMP=${Boolean(FMP_API_KEY)}, Polygon=${Boolean(POLYGON_API_KEY)}`);
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
  const namespace = cacheNamespace(key);
  const namespaceStats = CACHE_STATS.byNamespace[namespace] || {
    hits: 0,
    negativeHits: 0,
    misses: 0,
    coalesced: 0,
    writes: 0,
    errors: 0
  };
  CACHE_STATS.byNamespace[namespace] = namespaceStats;
  const cachedEntry = API_CACHE.get(key);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    CACHE_STATS.hits += 1;
    namespaceStats.hits += 1;
    if (cachedEntry.error) {
      CACHE_STATS.negativeHits += 1;
      namespaceStats.negativeHits += 1;
      throw cachedEntry.error;
    }
    return cachedEntry.value;
  }
  if (cachedEntry) API_CACHE.delete(key);
  if (CACHE_INFLIGHT.has(key)) {
    CACHE_STATS.coalesced += 1;
    namespaceStats.coalesced += 1;
    return CACHE_INFLIGHT.get(key);
  }
  CACHE_STATS.misses += 1;
  namespaceStats.misses += 1;
  const pending = Promise.resolve()
    .then(loader)
    .then((value) => {
      API_CACHE.set(key, {
        value,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttlMs
      });
      CACHE_STATS.writes += 1;
      namespaceStats.writes += 1;
      return value;
    })
    .catch((error) => {
      API_CACHE.set(key, {
        error,
        timestamp: Date.now(),
        expiresAt: Date.now() + Math.min(ttlMs, NEGATIVE_CACHE_TTL_MS)
      });
      CACHE_STATS.errors += 1;
      namespaceStats.errors += 1;
      throw error;
    })
    .finally(() => {
      CACHE_INFLIGHT.delete(key);
    });
  CACHE_INFLIGHT.set(key, pending);
  return pending;
}

function cacheNamespace(key) {
  return String(key).split(":")[0] || "unknown";
}

function cacheStatsSnapshot() {
  const now = Date.now();
  const entriesByNamespace = {};
  for (const [key, entry] of API_CACHE.entries()) {
    if (entry.expiresAt <= now) {
      API_CACHE.delete(key);
      continue;
    }
    const namespace = cacheNamespace(key);
    entriesByNamespace[namespace] = (entriesByNamespace[namespace] || 0) + 1;
  }
  return {
    entries: API_CACHE.size,
    inflight: CACHE_INFLIGHT.size,
    hits: CACHE_STATS.hits,
    negativeHits: CACHE_STATS.negativeHits,
    misses: CACHE_STATS.misses,
    coalesced: CACHE_STATS.coalesced,
    writes: CACHE_STATS.writes,
    errors: CACHE_STATS.errors,
    entriesByNamespace,
    byNamespace: CACHE_STATS.byNamespace,
    ttlSeconds: {
      quotes: QUOTE_TTL_MS / 1000,
      fundamentals: FUNDAMENTAL_TTL_MS / 1000,
      profiles: PROFILE_TTL_MS / 1000,
      news: NEWS_TTL_MS / 1000,
      history: HISTORY_TTL_MS / 1000
    },
    negativeCache: NEGATIVE_CACHE_TTL_MS / 1000
  };
}

async function probeConfiguredProvider() {
  if (provider instanceof HybridMarketProvider) {
    if (provider.finnhubProvider) {
      try {
        await provider.finnhubProvider.getQuote("AAPL");
      } catch {
        // The request layer records the exact status and error.
      }
    } else {
      try {
        await provider.quoteProvider.getQuote("AAPL");
      } catch {
        // The request layer records the exact status and error.
      }
    }
    return;
  }
  if (provider instanceof YahooFinanceProvider) {
    try {
      await provider.getQuote("AAPL");
    } catch {
      // The request layer records the exact status and error.
    }
  }
}

function providerStatusSnapshot() {
  return {
    provider: provider.name,
    configuredProvider: MARKET_PROVIDER,
    finnhubConfigured: Boolean(FINNHUB_API_KEY),
    finnhubWorking: PROVIDER_HEALTH.finnhub.working,
    yahooWorking: PROVIDER_HEALTH.yahoo.working,
    cacheStats: cacheStatsSnapshot(),
    checks: {
      finnhub: publicProviderHealth(PROVIDER_HEALTH.finnhub),
      yahoo: publicProviderHealth(PROVIDER_HEALTH.yahoo)
    },
    timestamp: new Date().toISOString()
  };
}

async function getAssetWithFallback(symbol) {
  const normalized = normalizeSymbol(symbol);
  return cached(`asset:${provider.name}:${normalized}`, QUOTE_TTL_MS, async () => {
    try {
      return await provider.getAsset(normalized);
    } catch (error) {
      console.error(`[Aurex] Returning fallback metadata for ${normalized}: ${providerFailureDescription(error)}`);
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

async function runEnricher(name, configured, loader) {
  if (!configured) return providerAttempt(name, "not_configured");
  try {
    const overlay = await loader();
    return providerAttempt(name, "success", overlay);
  } catch (error) {
    console.warn(`[Aurex] ${name} enrichment unavailable: ${providerFailureDescription(error)}`);
    return providerAttempt(name, "error", null, error);
  }
}

function providerAttempt(providerName, status, overlay = null, error = null) {
  return {
    provider: providerName,
    status,
    overlay,
    fieldsReturned: overlay ? FUNDAMENTAL_FIELDS.filter((field) => hasMetricValue(overlay[field])) : [],
    reason: status === "not_configured"
      ? `${providerName} API key is not configured.`
      : error
        ? userSafeError(error)
        : null
  };
}

function mergeMissingAssetFields(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base, sources: { ...(base.sources || {}) } };
  const mergeFields = [
    ...FUNDAMENTAL_FIELDS,
    "name", "assetType", "exchange", "sector", "industry", "logo", "currency", "summary",
    "history", "news", "recentEarningsPeriod"
  ];
  mergeFields.forEach((field) => {
    if (isMissingAssetValue(merged[field], field) && !isMissingAssetValue(overlay[field], field)) {
      merged[field] = overlay[field];
      if (overlay.sources?.[field]) merged.sources[field] = overlay.sources[field];
    }
  });
  if (overlay.fundamentalsUpdatedAt) merged.fundamentalsUpdatedAt = overlay.fundamentalsUpdatedAt;
  return merged;
}

function finalizeAssetCoverage(asset, attempts) {
  const normalized = normalizeAsset({
    ...asset,
    providerAttempts: attempts.map(publicProviderAttempt)
  });
  const metricDiagnostics = buildMetricDiagnostics(normalized, attempts);
  normalized.metricDiagnostics = metricDiagnostics;
  normalized.missingReasons = missingReasons(normalized.sources, normalized, metricDiagnostics);
  normalized.dataProviders = [...new Set(Object.values(normalized.sources || {}).filter(Boolean))];
  return normalized;
}

function publicProviderAttempt(attempt) {
  return {
    provider: attempt.provider,
    status: attempt.status,
    fieldsReturned: attempt.fieldsReturned,
    reason: attempt.reason
  };
}

function buildMetricDiagnostics(asset, attempts) {
  return Object.fromEntries(FUNDAMENTAL_FIELDS
    .filter((field) => !hasMetricValue(asset[field]))
    .map((field) => {
      const providersChecked = attempts.map((attempt) => ({
        provider: attempt.provider,
        status: attempt.status,
        reason: attempt.status === "success"
          ? `${attempt.provider} responded but did not return ${field}.`
          : attempt.reason
      }));
      const attemptedProviders = attempts.filter((attempt) => attempt.status !== "not_configured").map((attempt) => attempt.provider);
      const failed = attempts.filter((attempt) => attempt.status === "error").map((attempt) => `${attempt.provider}: ${attempt.reason}`);
      const reason = failed.length
        ? `Unavailable after provider checks. ${failed.join(" ")}`
        : attemptedProviders.length
          ? `Unavailable after checking ${attemptedProviders.join(", ")}; none returned this field.`
          : "Unavailable because no configured provider supports this field.";
      return [field, { providersChecked, reason }];
    }));
}

function hasMetricValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isMissingAssetValue(value, field) {
  if (field === "sector" || field === "industry" || field === "exchange" || field === "assetType") {
    return !hasMetricValue(value) || value === "Unknown";
  }
  return !hasMetricValue(value);
}

function sourceMap(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source]));
}

function sourceMapForAvailable(source, values) {
  return sourceMap(source, Object.entries(values)
    .filter(([, value]) => hasMetricValue(value))
    .map(([field]) => field));
}

function mappingValues(mappings) {
  return Object.fromEntries(Object.entries(mappings).map(([field, entry]) => [field, entry.value]));
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

function missingReasons(sources, asset, metricDiagnostics = asset.metricDiagnostics || {}) {
  const fields = [
    "price", "change", "changePercent", ...FUNDAMENTAL_FIELDS, "open", "dayHigh", "dayLow"
  ];
  return Object.fromEntries(fields.filter((field) => {
    return asset[field] === null || asset[field] === undefined || asset[field] === "";
  }).map((field) => [field, metricDiagnostics[field]?.reason || "Unavailable from current provider."]));
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
  const volatility = numberOrNull(asset.volatility) ?? annualizedVolatility(history);
  if (numberOrNull(asset.volatility) === null && volatility !== null && !sources.volatility) {
    sources.volatility = "Derived from price history";
  }
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
    pegRatio: numberOrNull(asset.pegRatio),
    priceToBook: numberOrNull(asset.priceToBook),
    evToEbitda: numberOrNull(asset.evToEbitda),
    evToSales: numberOrNull(asset.evToSales),
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
    freeCashFlowGrowth: numberOrNull(asset.freeCashFlowGrowth),
    grossMargin: numberOrNull(asset.grossMargin),
    profitMargin: numberOrNull(asset.profitMargin),
    operatingMargin: numberOrNull(asset.operatingMargin),
    debtToEquity: numberOrNull(asset.debtToEquity),
    returnOnEquity: numberOrNull(asset.returnOnEquity),
    returnOnAssets: numberOrNull(asset.returnOnAssets),
    currentRatio: numberOrNull(asset.currentRatio),
    quickRatio: numberOrNull(asset.quickRatio),
    cashPerShare: numberOrNull(asset.cashPerShare),
    beta: numberOrNull(asset.beta),
    volatility,
    institutionalOwnership: numberOrNull(asset.institutionalOwnership),
    shortInterest: numberOrNull(asset.shortInterest),
    payoutRatio: numberOrNull(asset.payoutRatio),
    analystRating: asset.analystRating || null,
    recommendationTrend: asset.recommendationTrend || null,
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
    providerAttempts: Array.isArray(asset.providerAttempts) ? asset.providerAttempts : [],
    metricDiagnostics: asset.metricDiagnostics || {},
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
    pegRatio: metricEntry(metrics, ["pegTTM", "pegAnnual", "peg5Y"]),
    evToEbitda: metricEntry(metrics, ["ev/ebitdaTTM", "ev/ebitdaAnnual", "enterpriseValue/ebitdaTTM"]),
    evToSales: metricEntry(metrics, ["ev/salesTTM", "ev/revenueTTM", "ev/salesAnnual"]),
    eps: metricEntry(metrics, ["epsTTM", "epsBasicExclExtraItemsTTM", "epsDilutedExclExtraItemsTTM", "epsNormalizedAnnual", "epsInclExtraItemsTTM"]),
    dividendYield: metricEntry(metrics, ["dividendYieldIndicatedAnnual", "dividendYield5Y"]),
    payoutRatio: metricEntry(metrics, ["payoutRatioTTM", "payoutRatioAnnual"]),
    week52High: metricEntry(metrics, ["52WeekHigh"]),
    week52Low: metricEntry(metrics, ["52WeekLow"]),
    averageVolume: metricEntry(metrics, ["10DayAverageTradingVolume", "3MonthAverageTradingVolume"], normalizeAverageVolume),
    revenueGrowth: metricEntry(metrics, ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy", "revenueGrowth3Y", "revenueGrowth5Y"]),
    earningsGrowth: metricEntry(metrics, ["epsGrowthTTMYoy", "epsGrowthQuarterlyYoy", "epsGrowth3Y", "epsGrowth5Y"]),
    freeCashFlowGrowth: metricEntry(metrics, ["freeCashFlowGrowthTTMYoy", "freeCashFlowGrowth3Y", "freeCashFlowGrowth5Y"]),
    grossMargin: metricEntry(metrics, ["grossMarginTTM", "grossMarginAnnual"]),
    profitMargin: metricEntry(metrics, ["netProfitMarginTTM", "netProfitMarginAnnual"]),
    operatingMargin: metricEntry(metrics, ["operatingMarginTTM", "operatingMarginAnnual"]),
    debtToEquity: metricEntry(metrics, ["totalDebt/totalEquityAnnual", "totalDebt/totalEquityQuarterly", "ltDebt/equityAnnual", "ltDebt/equityQuarterly"], normalizeDebt),
    returnOnEquity: metricEntry(metrics, ["roeTTM", "roeRfy", "roeAnnual"]),
    returnOnAssets: metricEntry(metrics, ["roaTTM", "roaRfy", "roaAnnual"]),
    currentRatio: metricEntry(metrics, ["currentRatioAnnual", "currentRatioQuarterly"]),
    quickRatio: metricEntry(metrics, ["quickRatioAnnual", "quickRatioQuarterly"]),
    cashPerShare: metricEntry(metrics, ["cashPerSharePerShareTTM", "cashPerShareAnnual", "cashFlowPerShareTTM"]),
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

function rollingGrowthFromSeries(series, type, window = 4) {
  const rows = seriesRows(series, type);
  if (rows.length < window * 2) return null;
  const current = sumLastSeriesValues(rows, window);
  const priorRows = rows.slice(-(window * 2), -window);
  const prior = priorRows.length === window
    ? priorRows.reduce((sum, row) => sum + seriesRowValue(row), 0)
    : null;
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

function annualizedVolatility(history) {
  if (!Array.isArray(history) || history.length < 12) return null;
  const values = history.map((point) => numberOrNull(point.close)).filter((value) => value !== null && value > 0);
  if (values.length < 12) return null;
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function recommendationToLabel(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  const positive = (numberOrNull(recommendation.strongBuy) || 0) + (numberOrNull(recommendation.buy) || 0);
  const neutral = numberOrNull(recommendation.hold) || 0;
  const negative = (numberOrNull(recommendation.sell) || 0) + (numberOrNull(recommendation.strongSell) || 0);
  if (!positive && !neutral && !negative) return null;
  if (positive > neutral + negative) return "buy";
  if (negative > positive + neutral) return "sell";
  return "hold";
}

function alphaAnalystRating(overview) {
  const trend = alphaRecommendationTrend(overview);
  if (!trend) return null;
  return recommendationToLabel(trend);
}

function alphaRecommendationTrend(overview) {
  const trend = {
    strongBuy: numberOrNull(overview.AnalystRatingStrongBuy),
    buy: numberOrNull(overview.AnalystRatingBuy),
    hold: numberOrNull(overview.AnalystRatingHold),
    sell: numberOrNull(overview.AnalystRatingSell),
    strongSell: numberOrNull(overview.AnalystRatingStrongSell)
  };
  return Object.values(trend).some((value) => value !== null) ? trend : null;
}

function fmpRecommendationTrend(consensus) {
  if (!consensus || typeof consensus !== "object") return null;
  const trend = {
    strongBuy: numberOrNull(consensus.strongBuy),
    buy: numberOrNull(consensus.buy),
    hold: numberOrNull(consensus.hold),
    sell: numberOrNull(consensus.sell),
    strongSell: numberOrNull(consensus.strongSell)
  };
  return Object.values(trend).some((value) => value !== null) ? trend : null;
}

function firstObject(value) {
  if (Array.isArray(value)) return value.find((item) => item && typeof item === "object") || {};
  if (value?.results && Array.isArray(value.results)) return value.results[0] || {};
  return value && typeof value === "object" ? value : {};
}

function polygonValue(statement, keys) {
  for (const key of keys) {
    const value = numberOrNull(statement?.[key]?.value ?? statement?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function polygonFreeCashFlow(cashFlow) {
  const operatingCash = polygonValue(cashFlow, [
    "net_cash_flow_from_operating_activities",
    "net_cash_flow_from_operating_activities_continuing"
  ]);
  const capex = polygonValue(cashFlow, [
    "payments_to_acquire_property_plant_and_equipment",
    "capital_expenditures"
  ]);
  if (operatingCash === null || capex === null) return null;
  return operatingCash - Math.abs(capex);
}

function sumNumbers(values) {
  const available = values.filter((value) => numberOrNull(value) !== null);
  return available.length ? available.reduce((sum, value) => sum + Number(value), 0) : null;
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

function providerHealthState(configured) {
  return {
    configured,
    working: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    lastStatus: null,
    operations: {}
  };
}

function publicProviderHealth(state) {
  return {
    configured: state.configured,
    working: state.working,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastError: state.lastError,
    lastStatus: state.lastStatus,
    operations: state.operations
  };
}

function providerHealthKey(providerName) {
  const normalized = String(providerName || "").toLowerCase();
  if (normalized.includes("finnhub")) return "finnhub";
  if (normalized.includes("yahoo")) return "yahoo";
  if (normalized.includes("alpha vantage")) return "alphaVantage";
  if (normalized.includes("financial modeling prep")) return "fmp";
  if (normalized.includes("polygon")) return "polygon";
  return null;
}

function recordProviderSuccess(providerName, operation, healthCritical = false) {
  const key = providerHealthKey(providerName);
  if (!key) return;
  const state = PROVIDER_HEALTH[key];
  const timestamp = new Date().toISOString();
  state.lastSuccessAt = timestamp;
  state.operations[operation] = { working: true, lastSuccessAt: timestamp, lastError: null, lastStatus: 200 };
  if (healthCritical) {
    state.working = true;
    state.lastError = null;
    state.lastStatus = 200;
  }
}

function recordProviderFailure(providerName, operation, error, healthCritical = false) {
  const key = providerHealthKey(providerName);
  if (!key) return;
  const state = PROVIDER_HEALTH[key];
  const timestamp = new Date().toISOString();
  const status = error?.status || null;
  const message = userSafeError(error);
  state.lastFailureAt = timestamp;
  state.operations[operation] = { working: false, lastFailureAt: timestamp, lastError: message, lastStatus: status };
  if (healthCritical) {
    state.working = false;
    state.lastError = message;
    state.lastStatus = status;
  }
}

function providerError(providerName, operation, code, status, message, cause = null) {
  const error = new Error(message);
  error.name = "ProviderRequestError";
  error.providerName = providerName;
  error.operation = operation;
  error.code = code;
  error.status = status;
  error.cause = cause || undefined;
  return error;
}

function isValidFinnhubQuote(quote) {
  return quote
    && typeof quote === "object"
    && numberOrNull(quote.c) !== null
    && numberOrNull(quote.c) > 0
    && numberOrNull(quote.t) !== null
    && numberOrNull(quote.t) > 0;
}

function isUsableQuote(asset) {
  return asset && numberOrNull(asset.price) !== null && numberOrNull(asset.price) > 0;
}

async function optionalProviderData(providerName, operation, loader, fallback) {
  try {
    return await loader();
  } catch (error) {
    if (!error.logged) {
      recordProviderFailure(providerName, operation, error, false);
      console.warn(`[Aurex] ${providerName} ${operation} unavailable: ${providerFailureDescription(error)}`);
      error.logged = true;
    }
    return fallback;
  }
}

function providerFailureDescription(error) {
  const status = error?.status ? `${error.status} ` : "";
  const code = error?.code ? `${error.code}: ` : "";
  return `${status}${code}${userSafeError(error)}`;
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
  const providerName = options.providerName || inferProviderName(url);
  const operation = options.operation || url.pathname;
  try {
    const response = await fetchResponse(url, options);
    let json;
    try {
      json = await response.json();
    } catch (cause) {
      throw providerError(providerName, operation, "invalid_response", response.status, `${providerName} returned invalid JSON for ${operation}.`, cause);
    }
    const responseError = json?.finance?.error || json?.quoteSummary?.error;
    if (responseError) {
      throw providerError(
        providerName,
        operation,
        "invalid_response",
        response.status,
        responseError.description || responseError.code || `${providerName} returned an error.`
      );
    }
    if (typeof json?.error === "string" && json.error.trim()) {
      const rateLimited = /limit|rate/i.test(json.error);
      throw providerError(
        providerName,
        operation,
        rateLimited ? "rate_limit" : "invalid_response",
        rateLimited ? 429 : response.status,
        json.error
      );
    }
    if (json === null || json === undefined || typeof json !== "object") {
      throw providerError(providerName, operation, "invalid_response", response.status, `${providerName} returned an empty response for ${operation}.`);
    }
    recordProviderSuccess(providerName, operation, Boolean(options.healthCritical));
    return json;
  } catch (error) {
    if (!error.logged) {
      recordProviderFailure(providerName, operation, error, Boolean(options.healthCritical));
      console.warn(`[Aurex] ${providerName} ${operation} failed: ${providerFailureDescription(error)}`);
      error.logged = true;
    }
    throw error;
  }
}

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  const providerName = options.providerName || inferProviderName(url);
  const operation = options.operation || url.pathname;
  try {
    const {
      headers = {},
      allowStatuses = [],
      providerName: ignoredProviderName,
      operation: ignoredOperation,
      healthCritical: ignoredHealthCritical,
      ...rest
    } = options;
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": "Aurex/1.0 educational market research platform",
        Accept: "application/json,text/plain,*/*",
        ...headers
      }
    });
    if (!response.ok && !allowStatuses.includes(response.status)) {
      const code = response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : response.status === 429
            ? "rate_limit"
            : "http_error";
      const message = response.status === 429
        ? `${providerName} rate limit reached.`
        : `${providerName} returned HTTP ${response.status} for ${operation}.`;
      throw providerError(providerName, operation, code, response.status, message);
    }
    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw providerError(providerName, operation, "timeout", null, `${providerName} timed out while requesting ${operation}.`, error);
    }
    if (error?.name === "ProviderRequestError") throw error;
    throw providerError(providerName, operation, "network_error", null, `${providerName} network request failed for ${operation}.`, error);
  } finally {
    clearTimeout(timeout);
  }
}

function inferProviderName(url) {
  const hostname = String(url?.hostname || "");
  if (hostname.includes("finnhub")) return "Finnhub";
  if (hostname.includes("yahoo")) return "Yahoo";
  if (hostname.includes("stooq")) return "Stooq";
  if (hostname.includes("alphavantage")) return "Alpha Vantage";
  return hostname || "Market provider";
}

function userSafeError(error) {
  const message = String(error?.message || error || "");
  if (error?.status === 401 || error?.code === "unauthorized") return "Provider authentication failed (401).";
  if (error?.status === 403 || error?.code === "forbidden") return "Provider rejected the request (403).";
  if (error?.status === 429 || error?.code === "rate_limit" || message.toLowerCase().includes("rate limit")) return "Provider rate limit reached (429). Try again shortly.";
  if (error?.code === "timeout" || message.toLowerCase().includes("abort") || message.toLowerCase().includes("timed out")) return "Market data provider timed out.";
  if (error?.code === "invalid_response") return "Provider returned an empty or invalid response.";
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
