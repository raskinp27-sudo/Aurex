const assert = require("node:assert/strict");
const test = require("node:test");

process.env.MARKET_PROVIDER = "finnhub";
process.env.FINNHUB_API_KEY = "test-finnhub";
process.env.ALPHA_VANTAGE_API_KEY = "test-alpha";
process.env.FMP_API_KEY = "test-fmp";
process.env.POLYGON_API_KEY = "test-polygon";

const SYMBOLS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "JPM", "BAC", "SPY", "QQQ", "SPCX"];
const requestedUrls = [];
const originalFetch = global.fetch;

global.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url.toString());

  if (url.hostname === "finnhub.io") return mockFinnhub(url);
  if (url.hostname === "fc.yahoo.com") {
    return new Response("ok", {
      status: 404,
      headers: { "Set-Cookie": "A1=test-cookie; Path=/; Secure" }
    });
  }
  if (url.hostname.includes("yahoo.com")) return mockYahoo(url);
  if (url.hostname === "www.alphavantage.co") return mockAlphaVantage(url);
  if (url.hostname === "financialmodelingprep.com") return mockFmp(url);
  if (url.hostname === "api.polygon.io") return mockPolygon(url);
  throw new Error(`Unexpected provider request: ${url}`);
};

const handleRequest = require("./server");

test.after(() => {
  global.fetch = originalFetch;
});

test("field-level enrichment maximizes coverage for the requested asset set", async () => {
  const response = await request(`/api/assets?symbols=${SYMBOLS.join(",")}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.assets.length, SYMBOLS.length);

  for (const asset of response.body.assets) {
    assert.equal(asset.provider, "Finnhub");
    assert.ok(asset.price > 0);
    assert.ok(asset.marketCap > 0);
    assert.ok(asset.peRatio > 0);
    assert.ok(asset.beta > 0);
    assert.ok(asset.forwardPe > 0);
    assert.ok(asset.priceToBook > 0);
    assert.ok(asset.pegRatio > 0);
    assert.ok(asset.evToEbitda > 0);
    assert.ok(asset.evToSales > 0);
    assert.ok(asset.returnOnEquity > 0);
    assert.ok(asset.returnOnAssets > 0);
    assert.ok(asset.grossMargin > 0);
    assert.ok(asset.freeCashFlowGrowth > 0);
    assert.ok(asset.debtToEquity > 0);
    assert.ok(asset.currentRatio > 0);
    assert.ok(asset.quickRatio > 0);
    assert.ok(asset.cashPerShare > 0);
    assert.ok(asset.week52High > asset.week52Low);
    assert.ok(asset.volume > 0);
    assert.equal(asset.sources.price, "Finnhub");
    assert.equal(asset.sources.peRatio, "Finnhub");
    assert.equal(asset.sources.beta, asset.assetType === "ETF" ? "FMP" : "Yahoo fundamentals");
    assert.equal(asset.sources.priceToBook, asset.assetType === "ETF" ? "FMP" : "Yahoo fundamentals");
    assert.equal(
      asset.sources.returnOnEquity,
      ["SPY", "QQQ"].includes(asset.symbol) ? "FMP" : "Yahoo fundamentals",
      `${asset.symbol} should preserve provider priority for ROE`
    );
    assert.equal(asset.sources.pegRatio, "Alpha Vantage");
    assert.equal(asset.sources.evToEbitda, "FMP");
    assert.equal(asset.sources.freeCashFlowGrowth, "FMP");
    assert.equal(asset.sources.grossMargin, "Polygon");
    assert.equal(asset.sources.currentRatio, "Polygon");

    const diagnostic = asset.metricDiagnostics.shortInterest;
    assert.ok(diagnostic);
    assert.deepEqual(
      diagnostic.providersChecked.map((entry) => entry.provider),
      ["Finnhub", "Yahoo", "FMP", "Alpha Vantage", "Polygon"]
    );

    const coreCoverage = [
      asset.price, asset.marketCap, asset.peRatio, asset.beta, asset.eps,
      asset.revenueGrowth, asset.profitMargin, asset.debtToEquity,
      asset.week52High, asset.week52Low, asset.volume
    ].filter((value) => Number.isFinite(Number(value))).length;
    assert.ok(coreCoverage >= 10, `${asset.symbol} core coverage was ${coreCoverage}/11`);

    const finnhubQuoteIndex = requestedUrls.findIndex((value) => {
      return value.includes("finnhub.io/api/v1/quote") && value.includes(`symbol=${asset.symbol}`);
    });
    const yahooFundamentalsIndex = requestedUrls.findIndex((value) => {
      return value.includes(`quoteSummary/${asset.symbol}`);
    });
    assert.ok(finnhubQuoteIndex >= 0);
    assert.ok(yahooFundamentalsIndex > finnhubQuoteIndex);
    const fmpProfileIndex = requestedUrls.findIndex((value) => {
      return value.includes("financialmodelingprep.com/stable/profile") && value.includes(`symbol=${asset.symbol}`);
    });
    const alphaIndex = requestedUrls.findIndex((value) => {
      return value.includes("alphavantage.co") && value.includes(`symbol=${asset.symbol}`);
    });
    assert.ok(fmpProfileIndex > yahooFundamentalsIndex);
    assert.ok(alphaIndex > fmpProfileIndex);
  }

  for (const symbol of ["SPY", "QQQ"]) {
    const asset = response.body.assets.find((candidate) => candidate.symbol === symbol);
    assert.equal(asset.sources.beta, "FMP");
    assert.equal(asset.sources.returnOnEquity, "FMP");
    assert.equal(asset.sources.priceToBook, "FMP");
    assert.equal(asset.sources.targetMeanPrice, "FMP");
    assert.equal(asset.sources.earningsSurprise, "FMP");
    assert.equal(asset.sources.analystRating, "FMP");
    assert.equal(asset.analystRating, "Buy");
    assert.equal(asset.sources.expenseRatio, "FMP");
    assert.equal(asset.sources.etfHoldings, "FMP");
    assert.equal(asset.expenseRatio, 0.09);
    assert.equal(asset.etfHoldings.length, 2);
    assert.equal(asset.etfHoldings[1].weight, 0.12);
  }

  assert.equal(requestedUrls.some((url) => url.includes("/v7/finance/quote")), false);
});

test("provider status exposes configured primary provider and cache activity", async () => {
  const callsBefore = requestedUrls.length;
  const response = await request("/api/provider-status");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.provider, "Finnhub primary + field-level enrichment");
  assert.equal(response.body.finnhubConfigured, true);
  assert.equal(response.body.finnhubWorking, true);
  assert.equal(response.body.fmpConfigured, true);
  assert.equal(response.body.fmpWorking, true);
  assert.equal(response.body.checks.fmp.configured, true);
  assert.equal(response.body.checks.fmp.working, true);
  assert.ok(response.body.cacheStats.hits > 0);
  assert.equal(requestedUrls.length, callsBefore);
});

function mockFinnhub(url) {
  const symbol = url.searchParams.get("symbol") || "AAPL";
  const offset = Math.max(0, SYMBOLS.indexOf(symbol)) * 5;
  const timestamp = 1_767_225_600;
  let body;

  if (url.pathname.endsWith("/quote")) {
    body = { c: 200 + offset, d: 2, dp: 1, h: 205 + offset, l: 196 + offset, o: 198 + offset, pc: 198 + offset, t: timestamp };
  } else if (url.pathname.endsWith("/stock/profile2")) {
    body = {
      name: `${symbol} Test Asset`,
      exchange: "NASDAQ",
      currency: "USD",
      finnhubIndustry: symbol === "SPY" || symbol === "QQQ" ? "Exchange Traded Fund" : "Technology",
      marketCapitalization: 3_000_000
    };
  } else if (url.pathname.endsWith("/stock/metric")) {
    assert.equal(url.searchParams.get("metric"), "all");
    body = {
      metric: {
        peTTM: 25,
        epsTTM: 8,
        "52WeekHigh": 250 + offset,
        "52WeekLow": 150 + offset,
        "10DayAverageTradingVolume": 45,
        revenueGrowthTTMYoy: 12,
        netProfitMarginTTM: 24,
        dividendYieldIndicatedAnnual: 0.6
      }
    };
  } else if (url.pathname.endsWith("/stock/candle")) {
    body = {
      s: "ok",
      t: Array.from({ length: 20 }, (_, index) => timestamp - (19 - index) * 86_400),
      c: Array.from({ length: 20 }, (_, index) => 181 + offset + index),
      v: Array.from({ length: 20 }, () => 50_000_000)
    };
  } else if (url.pathname.endsWith("/company-news")) {
    body = [];
  } else if (url.pathname.endsWith("/stock/earnings")) {
    body = symbol === "SPY" || symbol === "QQQ" ? [] : [{ period: "2025-Q4", surprisePercent: 4.5 }];
  } else if (url.pathname.endsWith("/calendar/earnings")) {
    body = { earningsCalendar: [{ date: "2026-07-20" }] };
  } else if (url.pathname.endsWith("/stock/recommendation")) {
    body = symbol === "SPY" || symbol === "QQQ"
      ? []
      : [{ period: "2026-06-01", strongBuy: 8, buy: 12, hold: 5, sell: 1, strongSell: 0 }];
  } else if (url.pathname.endsWith("/stock/price-target")) {
    body = symbol === "SPY" || symbol === "QQQ" ? {} : { targetMean: 240 + offset };
  } else if (url.pathname.endsWith("/stock/ownership")) {
    body = { ownership: [] };
  } else if (url.pathname.endsWith("/stock/short-interest")) {
    body = { data: [] };
  } else {
    throw new Error(`Unhandled Finnhub endpoint: ${url.pathname}`);
  }
  return jsonResponse(body);
}

function mockYahoo(url) {
  if (url.pathname.endsWith("/v1/test/getcrumb")) return new Response("test-crumb", { status: 200 });
  const symbol = decodeURIComponent(url.pathname.split("/").at(-1));
  if (url.pathname.includes("/v10/finance/quoteSummary/")) {
    const isEtf = symbol === "SPY" || symbol === "QQQ";
    return jsonResponse({
      quoteSummary: {
        result: [{
          assetProfile: { sector: "Technology", industry: "Software" },
          summaryDetail: { payoutRatio: { raw: 0.24 } },
          financialData: {
            revenueGrowth: { raw: 0.12 },
            earningsGrowth: { raw: 0.15 },
            profitMargins: { raw: 0.24 },
            operatingMargins: { raw: 0.28 },
            debtToEquity: { raw: 42 },
            ...(!isEtf ? { returnOnEquity: { raw: 0.31 } } : {}),
            quickRatio: { raw: 1.2 },
            totalCashPerShare: { raw: 4.5 },
            ...(!isEtf ? { targetMeanPrice: { raw: 250 }, recommendationKey: "buy" } : {})
          },
          defaultKeyStatistics: {
            forwardPE: { raw: 22 },
            ...(!isEtf ? { priceToBook: { raw: 7 }, beta: { raw: 1.1 } } : {}),
            heldPercentInstitutions: { raw: 0.68 }
          },
          recommendationTrend: {
            trend: [{ period: "0m", strongBuy: 8, buy: 12, hold: 5, sell: 1, strongSell: 0 }]
          },
          earningsHistory: { history: isEtf ? [] : [{ surprisePercent: { raw: 0.045 } }] },
          majorHoldersBreakdown: { institutionsPercentHeld: { raw: 0.68 } },
          price: { symbol }
        }],
        error: null
      }
    });
  }
  throw new Error(`Unhandled Yahoo endpoint: ${url.pathname}`);
}

function mockAlphaVantage(url) {
  const fn = url.searchParams.get("function");
  if (fn === "OVERVIEW") {
    return jsonResponse({
      Symbol: url.searchParams.get("symbol"),
      PEGRatio: "1.4",
      ReturnOnAssetsTTM: "0.14",
      AnalystTargetPrice: "255",
      AnalystRatingStrongBuy: "8",
      AnalystRatingBuy: "12",
      AnalystRatingHold: "5",
      AnalystRatingSell: "1",
      AnalystRatingStrongSell: "0"
    });
  }
  if (fn === "EARNINGS") {
    return jsonResponse({ quarterlyEarnings: [{ fiscalDateEnding: "2025-12-31", surprisePercentage: "4.5" }] });
  }
  throw new Error(`Unhandled Alpha Vantage function: ${fn}`);
}

function mockFmp(url) {
  const endpoint = url.pathname.replace("/stable/", "");
  const bodies = {
    profile: [{ symbol: url.searchParams.get("symbol"), companyName: "Test Asset", exchangeShortName: "NASDAQ", sector: "Technology", industry: "Software", currency: "USD", beta: 1.25, price: 200 }],
    "ratios-ttm": [{ payoutRatioTTM: 0.24, priceToBookRatioTTM: 6.5, returnOnEquityRatioTTM: 0.27, returnOnAssetsRatioTTM: 0.14, debtToEquityRatioTTM: 0.4 }],
    "key-metrics-ttm": [{ enterpriseValueOverEBITDATTM: 18, evToSalesTTM: 6, cashPerShareTTM: 4.5 }],
    "financial-growth": [{ freeCashFlowGrowth: 0.18 }],
    "analyst-estimates": [{ estimatedPriceTargetAvg: 255, estimatedEpsAvg: 9 }],
    "grades-consensus": [{ strongBuy: 8, buy: 12, hold: 5, sell: 1, strongSell: 0, consensus: "Buy" }],
    "price-target-consensus": [{ targetConsensus: 258, targetMedian: 255 }],
    earnings: [{ epsActual: 2.1, epsEstimated: 2 }],
    "etf/info": [{ expenseRatio: 0.09 }],
    "etf/holdings": [
      { asset: "AAPL", name: "Apple Inc.", weightPercentage: 7.1, sharesNumber: 1000, marketValue: 200000 },
      { asset: "MSFT", name: "Microsoft Corporation", weightPercentage: 0.12, sharesNumber: 900, marketValue: 180000 }
    ]
  };
  if (!(endpoint in bodies)) throw new Error(`Unhandled FMP endpoint: ${endpoint}`);
  return jsonResponse(bodies[endpoint]);
}

function mockPolygon(url) {
  if (url.pathname.includes("/v3/reference/tickers/")) {
    return jsonResponse({
      results: {
        name: "Test Asset",
        market_cap: 3_000_000_000_000,
        share_class_shares_outstanding: 15_000_000_000,
        primary_exchange: "XNAS",
        currency_name: "usd",
        sic_description: "Technology"
      }
    });
  }
  if (url.pathname.endsWith("/vX/reference/financials")) {
    return jsonResponse({
      results: [{
        financials: {
          income_statement: {
            revenues: { value: 400_000_000_000 },
            net_income_loss: { value: 100_000_000_000 },
            gross_profit: { value: 180_000_000_000 },
            operating_income_loss: { value: 120_000_000_000 },
            diluted_earnings_per_share: { value: 8 }
          },
          balance_sheet: {
            equity: { value: 200_000_000_000 },
            assets: { value: 500_000_000_000 },
            current_assets: { value: 180_000_000_000 },
            current_liabilities: { value: 120_000_000_000 },
            long_term_debt: { value: 70_000_000_000 },
            current_debt: { value: 10_000_000_000 },
            cash_and_cash_equivalents: { value: 60_000_000_000 }
          },
          cash_flow_statement: {
            net_cash_flow_from_operating_activities: { value: 130_000_000_000 },
            payments_to_acquire_property_plant_and_equipment: { value: 20_000_000_000 }
          }
        }
      }, {
        financials: {
          income_statement: { revenues: { value: 360_000_000_000 } },
          cash_flow_statement: {
            net_cash_flow_from_operating_activities: { value: 110_000_000_000 },
            payments_to_acquire_property_plant_and_equipment: { value: 18_000_000_000 }
          }
        }
      }]
    });
  }
  throw new Error(`Unhandled Polygon endpoint: ${url.pathname}`);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function request(pathname) {
  return new Promise((resolve, reject) => {
    const requestObject = {
      method: "GET",
      url: pathname,
      headers: { host: "localhost:4174" }
    };
    const responseObject = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(body) {
        try {
          resolve({ statusCode: this.statusCode, body: JSON.parse(String(body)) });
        } catch (error) {
          reject(error);
        }
      }
    };
    Promise.resolve(handleRequest(requestObject, responseObject)).catch(reject);
  });
}
