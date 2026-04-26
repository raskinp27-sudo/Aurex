const API_BASE = location.protocol === "file:" ? "http://localhost:4174" : "";
const EXAMPLE_ASSETS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "NFLX", "AMD", "INTC",
  "JPM", "BAC", "V", "MA", "JNJ", "UNH", "LLY", "PFE", "WMT", "COST",
  "KO", "PEP", "XOM", "CVX", "BA", "LMT", "DIS", "NKE", "MCD", "SPY",
  "QQQ", "VTI", "VNQ", "GLD", "BTC-USD", "ETH-USD"
];

const CATEGORY_WEIGHTS = {
  balanceSheet: 25,
  valuation: 20,
  growth: 20,
  profitability: 15,
  risk: 10,
  newsSentiment: 10
};

const CONFIDENCE_FIELDS = [
  "price", "previousClose", "volume", "week52High", "week52Low", "marketCap", "peRatio",
  "forwardPe", "priceToBook", "eps", "revenueGrowth", "earningsGrowth", "profitMargin",
  "operatingMargin", "debtToEquity", "returnOnEquity", "beta", "dividendYield"
];

const DATA_QUALITY_FIELDS = [
  ["price", "Price"],
  ["peRatio", "P/E"],
  ["beta", "Beta"],
  ["marketCap", "Market cap"],
  ["eps", "EPS"],
  ["revenueGrowth", "Revenue growth"],
  ["profitMargin", "Profit margin"],
  ["debtToEquity", "Debt/equity"],
  ["week52Range", "52-week range"],
  ["volume", "Volume"]
];

const METRIC_TOOLTIPS = {
  peRatio: "Price divided by earnings per share. Lower can mean cheaper, but context matters.",
  forwardPe: "Expected price-to-earnings based on forecast earnings.",
  beta: "Volatility versus the broad market. 1.0 is roughly market-like.",
  eps: "Earnings per share, or profit allocated to each share.",
  debtToEquity: "Debt compared with shareholder equity. Higher means more leverage.",
  profitMargin: "Net profit as a percentage of revenue.",
  operatingMargin: "Operating profit as a percentage of revenue before interest and tax.",
  revenueGrowth: "Revenue change versus the comparable prior period.",
  dividendYield: "Annual dividend divided by current price.",
  returnOnEquity: "Profit generated relative to shareholder equity."
};

const state = {
  selectedSymbol: "MSFT",
  selectedAsset: null,
  comparisonSymbols: ["AAPL", "MSFT", "NVDA"],
  cache: new Map(),
  chartTimeframe: "1Y",
  beginnerMode: localStorage.getItem("aurexBeginnerMode") === "true",
  watchlist: readStoredList("aurexWatchlist", ["AAPL", "MSFT", "SPY"]),
  recentlyViewed: readStoredList("aurexRecentAssets", []),
  provider: { name: "Connecting", status: "unknown" },
  portfolio: {
    startingCash: 100000,
    riskTolerance: "Moderate",
    investmentHorizon: "3-5 years",
    maxAllocation: 25,
    sectorPreferences: "",
    holdings: [
      { symbol: "AAPL", shares: 30, purchasePrice: 155 },
      { symbol: "JPM", shares: 55, purchasePrice: 176 },
      { symbol: "SPY", shares: 40, purchasePrice: 430 }
    ]
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function readStoredList(key, fallback = []) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const marketApi = {
  async health() {
    return request("/api/health");
  },
  async search(query, filters = {}) {
    const params = new URLSearchParams({ q: query || "" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request(`/api/search?${params}`);
  },
  async asset(symbol, force = false) {
    const normalized = normalizeSymbol(symbol);
    const cached = state.cache.get(normalized);
    if (!force && cached && Date.now() - cached.cachedAt < 45_000) return cached.asset;
    const response = await request(`/api/asset/${encodeURIComponent(normalized)}`);
    state.cache.set(response.asset.symbol, { asset: response.asset, cachedAt: Date.now() });
    return response.asset;
  },
  async assets(symbols, force = false) {
    const normalized = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
    const misses = normalized.filter((symbol) => {
      const cached = state.cache.get(symbol);
      return force || !cached || Date.now() - cached.cachedAt > 45_000;
    });
    if (misses.length) {
      const response = await request(`/api/assets?symbols=${encodeURIComponent(misses.join(","))}`);
      response.assets.forEach((asset) => state.cache.set(asset.symbol, { asset, cachedAt: Date.now() }));
    }
    return normalized.map((symbol) => state.cache.get(symbol)?.asset).filter(Boolean);
  }
};

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(friendlyError(body.error || `Request failed with ${response.status}`));
  }
  return response.json();
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function money(value, currency = "USD") {
  if (!isRealNumber(value)) return "Unavailable";
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2
  });
}

function compactNumber(value) {
  if (!isRealNumber(value)) return "Unavailable";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return Number(value).toLocaleString("en-US");
}

function volumeNumber(value) {
  const formatted = compactNumber(value);
  return formatted === "Unavailable" ? formatted : `${formatted} shares`;
}

function percent(value, signed = true) {
  if (!isRealNumber(value)) return "Unavailable";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
}

function number(value, decimals = 2) {
  if (!isRealNumber(value)) return "Unavailable";
  return Number(value).toFixed(decimals);
}

function isRealNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function displayDate(value) {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function friendlyError(message) {
  const text = String(message || "");
  if (text.includes("429") || text.toLowerCase().includes("rate limit")) return "Provider rate limit reached. Try again shortly.";
  if (text.toLowerCase().includes("failed to fetch")) return "Some data is temporarily unavailable.";
  if (text.toLowerCase().includes("request failed")) return "Some data is temporarily unavailable.";
  return text || "Some data is temporarily unavailable.";
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 50;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function scoreAsset(asset) {
  const dataQuality = dataQualityScore(asset);
  const confidence = analysisConfidence(asset, dataQuality);
  const balanceSheet = average([
    asset.debtToEquity !== null ? clamp(100 - asset.debtToEquity * 42) : 50,
    asset.currentRatio !== null ? clamp(asset.currentRatio * 36, 20, 100) : 50,
    asset.returnOnEquity !== null ? clamp(42 + asset.returnOnEquity * 1.4, 0, 100) : 50,
    asset.marketCap !== null ? clamp(Math.log10(Math.max(asset.marketCap, 1) / 1_000_000_000) * 18 + 38, 25, 100) : 50
  ]);
  const valuation = average([
    asset.peRatio !== null && asset.sectorPe ? scorePe(asset.peRatio, asset.sectorPe) : asset.peRatio !== null ? scoreAbsolutePe(asset.peRatio) : 50,
    asset.forwardPe !== null && asset.sectorPe ? scorePe(asset.forwardPe, asset.sectorPe) : asset.forwardPe !== null ? scoreAbsolutePe(asset.forwardPe) : 50,
    asset.priceToBook !== null ? clamp(95 - asset.priceToBook * 8, 10, 100) : 50
  ]);
  const growth = average([
    asset.revenueGrowth !== null ? clamp(48 + asset.revenueGrowth * 2.1, 0, 100) : 50,
    asset.earningsGrowth !== null ? clamp(48 + asset.earningsGrowth * 1.35, 0, 100) : 50
  ]);
  const profitability = average([
    asset.profitMargin !== null ? clamp(34 + asset.profitMargin * 2.2, 0, 100) : 50,
    asset.operatingMargin !== null ? clamp(34 + asset.operatingMargin * 1.8, 0, 100) : 50,
    asset.sectorBenchmark?.profitMargin && asset.profitMargin !== null ? clamp(50 + (asset.profitMargin - asset.sectorBenchmark.profitMargin) * 2, 0, 100) : 50
  ]);
  const risk = average([
    asset.beta !== null ? clamp(100 - Math.max(0, asset.beta - 0.75) * 38, 10, 100) : riskFallback(asset) ? clamp(100 - Math.max(0, riskFallback(asset) - 0.75) * 38, 10, 100) : 50,
    asset.debtToEquity !== null ? clamp(95 - asset.debtToEquity * 35, 0, 100) : 50,
    historyRiskScore(asset.history)
  ]);
  const newsSentiment = newsScore(asset.news);
  const overall = Math.round(
    balanceSheet * 0.25
    + valuation * 0.2
    + growth * 0.2
    + profitability * 0.15
    + risk * 0.1
    + newsSentiment * 0.1
  );
  const verdict = overall >= 75 ? "Buy" : overall >= 50 ? "Hold" : "Sell";
  const categories = { balanceSheet, valuation, growth, profitability, risk, newsSentiment };
  const factors = factorSummary(asset, categories, confidence.missing);
  return { overall, verdict, categories, factors, confidence, dataQuality };
}

function scorePe(pe, sectorPe) {
  const ratio = pe / sectorPe;
  if (ratio <= 0) return 50;
  return clamp(104 - ratio * 46, 5, 100);
}

function scoreAbsolutePe(pe) {
  if (pe <= 0) return 35;
  if (pe < 15) return 85;
  if (pe < 25) return 72;
  if (pe < 40) return 55;
  return clamp(55 - (pe - 40) * 0.7, 10, 55);
}

function historyRiskScore(history) {
  if (!history || history.length < 12) return 50;
  const returns = history.slice(1).map((point, index) => {
    const previous = history[index].close;
    return previous ? (point.close - previous) / previous : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const annualizedVol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  return clamp(100 - annualizedVol * 1.55, 5, 100);
}

function historyVolatility(history) {
  if (!history || history.length < 12) return null;
  const returns = history.slice(1).map((point, index) => {
    const previous = history[index].close;
    return previous ? (point.close - previous) / previous : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function newsScore(news) {
  if (!news || !news.length) return 50;
  return average(news.map((item) => item.sentiment === "positive" ? 82 : item.sentiment === "negative" ? 28 : 55));
}

function dataQualityScore(asset) {
  const missing = [];
  const available = DATA_QUALITY_FIELDS.reduce((count, [field, label]) => {
    const isAvailable = field === "week52Range"
      ? isRealNumber(asset.week52High) && isRealNumber(asset.week52Low)
      : isRealNumber(asset[field]);
    if (!isAvailable) missing.push(label);
    return count + (isAvailable ? 1 : 0);
  }, 0);
  const score = Math.round(available / DATA_QUALITY_FIELDS.length * 100);
  const summary = score >= 80
    ? "Most key metrics are available."
    : score >= 55
      ? "Core quote data is available, but some fundamentals are missing."
      : "This asset has limited fundamentals from the current provider.";
  return { score, missing, summary, available, total: DATA_QUALITY_FIELDS.length };
}

function analysisConfidence(asset, dataQuality = dataQualityScore(asset)) {
  const missing = CONFIDENCE_FIELDS.filter((field) => asset[field] === null || asset[field] === undefined);
  let available = CONFIDENCE_FIELDS.length - missing.length;
  if (asset.news?.length) available += 1;
  if (asset.history?.length > 30) available += 1;
  if (asset.live) available += 1;
  const denominator = CONFIDENCE_FIELDS.length + 3;
  const sourceText = Object.values(asset.sources || {}).join(" ");
  const reliabilityAdjustment = sourceText.includes("Finnhub") ? 0.08 : asset.provider?.includes("Alpha Vantage") ? 0.04 : 0;
  const liveAdjustment = asset.live ? 0 : -0.15;
  const keyMissingPenalty = ["price", "peRatio", "profitMargin", "debtToEquity"].filter((field) => missing.includes(field)).length * 0.035;
  const volatility = historyVolatility(asset.history);
  const volatilityPenalty = volatility !== null && volatility > 48 ? 0.07 : volatility !== null && volatility > 34 ? 0.035 : 0;
  const dataQualityAdjustment = (dataQuality.score - 70) / 500;
  const ratio = clamp(available / denominator + reliabilityAdjustment + liveAdjustment + dataQualityAdjustment - keyMissingPenalty - volatilityPenalty, 0, 1);
  const level = ratio >= 0.72 ? "High" : ratio >= 0.45 ? "Medium" : "Low";
  return { level, ratio, missing, volatility };
}

function factorSummary(asset, categories, missing) {
  const readable = [
    ["Balance sheet", categories.balanceSheet, 25],
    ["Valuation", categories.valuation, 20],
    ["Growth", categories.growth, 20],
    ["Profitability", categories.profitability, 15],
    ["Risk", categories.risk, 10],
    ["News sentiment", categories.newsSentiment, 10]
  ].sort((a, b) => b[1] - a[1]);
  return { strongest: readable[0], weakest: readable.at(-1), missing };
}

function buildResearch(asset, score) {
  const strengths = [];
  const weaknesses = [];
  const risks = [];
  const catalysts = [];

  if (score.categories.balanceSheet >= 65) strengths.push("Balance sheet, liquidity, and scale indicators are supportive.");
  if (score.categories.profitability >= 65) strengths.push(`Profitability screens well${asset.profitMargin !== null ? ` at ${number(asset.profitMargin, 1)}% margin` : ""}.`);
  if (score.categories.growth >= 65) strengths.push("Growth indicators are above the model's neutral baseline.");
  if (score.categories.newsSentiment >= 65) strengths.push("Recent news tone is broadly constructive.");
  if (!strengths.length) strengths.push("The model sees neutral factors, but no dominant strength from the returned dataset.");

  if (score.categories.valuation < 50) weaknesses.push("Valuation looks demanding relative to available benchmarks.");
  if (score.categories.growth < 50) weaknesses.push("Growth signals are weak or missing, reducing conviction.");
  if (score.confidence.missing.length) weaknesses.push(`Missing data: ${score.confidence.missing.slice(0, 8).join(", ")}.`);
  if (!asset.live) weaknesses.push("Live or delayed market data was unavailable, so the verdict should be treated cautiously.");
  if (!weaknesses.length) weaknesses.push("No severe weakness stands out in the currently available provider data.");

  if (asset.beta !== null && asset.beta > 1.35) risks.push(`Higher beta of ${number(asset.beta, 2)} can increase volatility.`);
  if (asset.beta === null) risks.push("Beta unavailable; volatility is inferred from recent price movement instead.");
  if (asset.debtToEquity !== null && asset.debtToEquity > 1.2) risks.push(`Debt-to-equity of ${number(asset.debtToEquity, 2)} raises balance-sheet sensitivity.`);
  if (asset.changePercent !== null && asset.changePercent < -3) risks.push("Large daily decline may indicate fresh market concern.");
  if (asset.assetType === "CRYPTOCURRENCY") risks.push("Crypto assets can have large drawdowns and weaker fundamental comparability.");
  if (score.categories.newsSentiment < 45) risks.push("Recent news sentiment is a drag on the model.");
  if (!risks.length) risks.push("Main risks are valuation changes, earnings revisions, liquidity, and sector-specific macro pressure.");

  if (asset.targetMeanPrice && asset.price && asset.targetMeanPrice > asset.price) catalysts.push("Analyst target price sits above the current quote.");
  if (asset.revenueGrowth !== null && asset.revenueGrowth > 10) catalysts.push("Double-digit revenue growth could support earnings revisions.");
  if (asset.news?.some((item) => item.sentiment === "positive")) catalysts.push("Positive recent headlines may improve investor sentiment.");
  if (asset.assetType === "ETF") catalysts.push("ETF structure can add diversification versus a single-stock position.");
  if (!catalysts.length) catalysts.push("Catalysts depend on upcoming earnings, margin trends, and broader sector momentum.");

  return { strengths, weaknesses, risks, catalysts };
}

function verdictExplanation(asset, score) {
  const strongest = score.factors.strongest;
  const weakest = score.factors.weakest;
  const confidenceText = `${score.confidence.level.toLowerCase()} confidence`;
  const dataNote = asset.live
    ? `Provider data is ${asset.marketState || "available"} as of ${displayDate(asset.lastUpdated)}.`
    : "Live data was unavailable, so Aurex is not filling missing values with fake numbers.";
  const normal = `${asset.symbol} is rated ${score.verdict} with a score of ${score.overall}/100 and ${confidenceText}. The main support is ${strongest[0].toLowerCase()} at ${Math.round(strongest[1])}/100. The biggest drag is ${weakest[0].toLowerCase()} at ${Math.round(weakest[1])}/100. ${dataNote}`;
  const beginner = `${asset.symbol} is a ${score.verdict}. Aurex likes ${strongest[0].toLowerCase()} most, but ${weakest[0].toLowerCase()} is holding the score back. ${dataNote}`;
  return explain(normal, beginner);
}

function confidenceCopy(score) {
  const missing = score.confidence.missing.slice(0, 6).join(", ");
  if (score.confidence.level === "High") return `High investment confidence: data quality is ${score.dataQuality.score}/100, recent price history and news are available, and most fundamentals were returned.`;
  if (score.confidence.level === "Medium") return `Medium investment confidence: enough data is available for directional analysis, but ${missing || "some important fields"} are unavailable.`;
  return `Low investment confidence: several key metrics are unavailable (${missing || "provider fields"}), so the verdict should be treated as preliminary.`;
}

function explain(normal, beginner) {
  return state.beginnerMode ? beginner : normal;
}

function analystReport(asset, score, research) {
  const strongest = score.factors.strongest[0].toLowerCase();
  const weakest = score.factors.weakest[0].toLowerCase();
  const improve = score.verdict === "Buy"
    ? "A materially higher valuation, weaker margins, or negative earnings revisions would pressure the Buy rating."
    : score.verdict === "Hold"
      ? "Stronger revenue growth, better profitability, lower leverage, or a lower valuation would improve the score."
      : "Sustained growth, improving margins, stronger balance-sheet data, and a more attractive valuation could move this away from Sell.";
  return [
    ["Main reason", `${asset.symbol} is ${score.verdict} because ${strongest} is the strongest model input while ${weakest} is the main offset.`],
    ["Bull case", research.strengths[0] || "The bull case depends on improving fundamentals and constructive sentiment."],
    ["Bear case", research.risks[0] || research.weaknesses[0] || "The bear case is valuation compression, weaker earnings, or higher volatility."],
    ["What would change it", improve]
  ];
}

function valuationInterpretation(asset) {
  if (!isRealNumber(asset.peRatio)) {
    return "Negative or unavailable P/E often means earnings are negative, inconsistent, or unavailable from the current provider.";
  }
  if (isRealNumber(asset.sectorBenchmark?.pe)) {
    if (asset.peRatio > asset.sectorBenchmark.pe * 1.18) return "A P/E above the estimated sector benchmark suggests the stock may be expensive unless growth and margins justify the premium.";
    if (asset.peRatio < asset.sectorBenchmark.pe * 0.82) return "A lower P/E can suggest value, but it may also reflect slower growth or higher perceived risk.";
    return "P/E is near the estimated sector benchmark, so valuation does not dominate the verdict by itself.";
  }
  return "P/E is available, but sector benchmark data is estimated or unavailable, so valuation confidence is lower.";
}

function riskInterpretation(asset) {
  const pieces = [];
  if (isRealNumber(asset.beta)) pieces.push(asset.beta > 1 ? "Beta above 1 means this asset has historically moved more than the overall market." : "Beta below 1 suggests lower broad-market sensitivity.");
  else pieces.push("Beta is unavailable, so Aurex infers volatility from recent price movement.");
  if (isRealNumber(asset.debtToEquity) && asset.debtToEquity > 1) pieces.push("High debt-to-equity may make the company more sensitive to rates and earnings pressure.");
  const position = weekPosition(asset);
  if (position) pieces.push(position.copy);
  return pieces.join(" ");
}

function weekPosition(asset) {
  if (!isRealNumber(asset.price) || !isRealNumber(asset.week52Low) || !isRealNumber(asset.week52High) || asset.week52High <= asset.week52Low) return null;
  const pct = clamp((asset.price - asset.week52Low) / (asset.week52High - asset.week52Low) * 100, 0, 100);
  const copy = pct > 75
    ? "Current price is near the upper end of its 52-week range, which can indicate momentum but less margin of safety."
    : pct < 25
      ? "Current price is near the lower end of its 52-week range, which can indicate pessimism or a potential value setup."
      : "Current price sits near the middle of its 52-week range.";
  return { pct, copy };
}

function fairValueEstimate(asset) {
  if (!isRealNumber(asset.eps) || !isRealNumber(asset.price) || asset.eps <= 0) {
    return {
      available: false,
      copy: "Educational fair value estimate unavailable because EPS or current price was not returned by the provider."
    };
  }
  const sectorPe = isRealNumber(asset.sectorBenchmark?.pe) ? asset.sectorBenchmark.pe : isRealNumber(asset.peRatio) ? asset.peRatio : 18;
  const growthPremium = isRealNumber(asset.revenueGrowth) ? clamp(asset.revenueGrowth / 100, -0.25, 0.35) : 0;
  const marginPremium = isRealNumber(asset.profitMargin) && isRealNumber(asset.sectorBenchmark?.profitMargin)
    ? clamp((asset.profitMargin - asset.sectorBenchmark.profitMargin) / 100, -0.2, 0.25)
    : 0;
  const riskDiscount = (asset.beta ?? riskFallback(asset)) > 1.3 ? -0.08 : 0;
  const fairPe = clamp(sectorPe * (1 + growthPremium + marginPremium + riskDiscount), 8, 55);
  const center = asset.eps * fairPe;
  const low = center * 0.88;
  const high = center * 1.12;
  const status = asset.price < low ? "below" : asset.price > high ? "above" : "near";
  const mos = status === "below"
    ? `Price appears below the educational range, implying a possible margin of safety if assumptions hold.`
    : status === "above"
      ? "Price appears above the educational range, which lowers margin of safety."
      : "Price appears near the educational range, so margin of safety looks limited but not stretched.";
  return { available: true, low, high, center, status, copy: mos };
}

async function loadHealth() {
  const health = await marketApi.health();
  state.provider = { name: health.provider, status: health.status };
  return health;
}

async function bootHome() {
  applySavedTheme();
  wireThemeToggle();
  try {
    const health = await loadHealth();
    $("#landingProvider").textContent = health.provider;
    const asset = await marketApi.asset("AAPL", true);
    const score = scoreAsset(asset);
    $("#landingScore").textContent = `${score.overall}/100`;
    $("#landingVerdict").textContent = score.verdict;
    $("#landingConfidence").textContent = score.confidence.level;
    $("#landingQuality").textContent = `${score.dataQuality.score}/100`;
    $("#previewSymbol").textContent = asset.symbol;
    $("#previewName").textContent = asset.name;
    $("#previewPrice").textContent = money(asset.price, asset.currency);
    $("#previewMove").textContent = formatDailyMove(asset);
    $("#previewMove").className = isRealNumber(asset.change) ? asset.change >= 0 ? "positive" : "negative" : "muted";
    $("#previewVerdict").textContent = score.verdict;
    $("#previewVerdict").className = `verdict-badge ${score.verdict.toLowerCase()}`;
    $("#previewExplanation").textContent = verdictExplanation(asset, score);
  } catch (error) {
    $("#landingProvider").textContent = "Offline";
    $("#previewExplanation").textContent = `Live preview unavailable: ${error.message}. Start the server with npm start.`;
  } finally {
    $("#landingPreview")?.classList.remove("loading");
  }
}

async function bootDashboard() {
  applySavedTheme();
  wireThemeToggle();
  setupDashboardEvents();
  renderQuickPicks();
  updateCompareControls();
  renderWatchlist();
  renderRecentlyViewed();
  $("#beginnerToggle").checked = state.beginnerMode;
  try {
    const health = await loadHealth();
    $("#providerLabel").textContent = health.provider;
    $("#marketState").textContent = `${health.status}. Keys: Finnhub ${health.env.finnhubConfigured ? "configured" : "not set"}, Alpha Vantage ${health.env.alphaVantageConfigured ? "configured" : "not set"}.`;
    $("#dataModeCopy").textContent = `${health.provider} is active. Search and quotes use the provider first; missing fields stay marked unavailable instead of being invented.`;
  } catch (error) {
    $("#providerLabel").textContent = "Market server offline";
    $("#marketState").textContent = "Start npm start to enable live data.";
    showAlert(`Live data is not connected: ${error.message}. Aurex does not show fake prices as current market data.`);
  }
  await loadAsset(state.selectedSymbol);
  await runSearch();
  await renderPortfolio();
  setInterval(async () => {
    await refreshDashboardData();
  }, 60_000);
}

async function refreshDashboardData() {
  await loadAsset(state.selectedSymbol, true);
  await renderPortfolio(true);
  if ($("#comparison")?.classList.contains("active")) await renderComparison(true);
}

async function loadAsset(symbol, force = false) {
  setPanelLoading(true);
  clearAlert();
  try {
    const asset = await marketApi.asset(symbol, force);
    state.selectedSymbol = asset.symbol;
    state.selectedAsset = asset;
    rememberAsset(asset);
    renderAsset(asset);
    renderPortfolioAware(asset, scoreAsset(asset));
    updateCompareControls();
    stampUpdate(asset.lastUpdated);
  } catch (error) {
    showAlert(`Could not load ${symbol}: ${error.message}`);
  } finally {
    setPanelLoading(false);
  }
}

function renderAsset(asset) {
  const score = scoreAsset(asset);
  const research = buildResearch(asset, score);
  $("#companyMeta").textContent = `${asset.assetType} / ${asset.exchange} / ${asset.currency}`;
  $("#companyName").textContent = `${asset.name} (${asset.symbol})`;
  $("#assetTags").innerHTML = [
    asset.sector,
    asset.industry,
    asset.live ? asset.marketState || "Provider quote" : "Unavailable quote",
    asset.provider
  ].filter(Boolean).map((item) => `<span class="asset-tag">${item}</span>`).join("");
  $("#stockPrice").textContent = money(asset.price, asset.currency);
  $("#dailyMove").textContent = formatDailyMove(asset);
  $("#dailyMove").className = isRealNumber(asset.change) ? asset.change >= 0 ? "positive" : "negative" : "muted";
  $("#assetUpdated").textContent = `Last updated ${displayDate(asset.lastUpdated)}`;
  $("#assetSource").textContent = `${asset.sourceNote || "Provider details unavailable."} Data updated ${displayDate(asset.freshness?.priceData || asset.lastUpdated)}. Analysis generated ${displayDate(asset.analysisGeneratedAt)}. Fundamental metrics may lag quarterly filings even when price data is live.`;
  $("#companyVerdict").textContent = score.verdict;
  $("#companyVerdict").className = `verdict-badge ${score.verdict.toLowerCase()}`;
  $("#confidenceBadge").textContent = `${score.confidence.level} confidence`;
  $("#confidenceBadge").className = `confidence-badge ${score.confidence.level.toLowerCase()}`;
  $("#dataQualityBadge").textContent = `Data Quality ${score.dataQuality.score}/100`;
  $("#watchlistToggle").textContent = state.watchlist.includes(asset.symbol) ? "Remove from watchlist" : "Add to watchlist";
  $("#standaloneScore").textContent = `Score ${score.overall}/100`;
  $("#keyStatsGrid").innerHTML = renderMetricCards(keyStatsRows(asset));
  $("#financialMetricsGrid").innerHTML = renderMetricCards(financialMetricRows(asset));
  $("#missingDataLabel").textContent = score.confidence.missing.length ? `${score.confidence.missing.length} fields unavailable` : "Core fields available";
  $("#verdictExplanation").textContent = verdictExplanation(asset, score);
  $("#confidenceNote").textContent = confidenceCopy(score);
  $("#dataQualityPanel").innerHTML = renderDataQuality(score.dataQuality);
  $("#scoreBars").innerHTML = renderScoreBars(score.categories, asset);
  $("#analystReportGrid").innerHTML = renderAnalystReport(analystReport(asset, score, research));
  $("#researchGrid").innerHTML = renderResearchCards(research);
  renderSectorComparison(asset);
  renderEarningsCatalyst(asset, research);
  renderInterpretation(asset);
  renderFairValue(asset);
  renderWeekPosition(asset);
  renderNews(asset);
  drawLineChart($("#priceChart"), asset.history, !isRealNumber(asset.change) || asset.change >= 0 ? "#0f8a5f" : "#c24135", asset.currency, state.chartTimeframe, asset.price);
  renderWatchlist();
  renderRecentlyViewed();
}

function keyStatsRows(asset) {
  return [
    metricRow(asset, "Current price", "price", money(asset.price, asset.currency)),
    metricRow(asset, "Daily change", "change", formatDailyMove(asset)),
    metricRow(asset, "Previous close", "previousClose", money(asset.previousClose, asset.currency)),
    metricRow(asset, "Open", "open", money(asset.open, asset.currency)),
    metricRow(asset, "Day range", "dayHigh", dayRange(asset)),
    metricRow(asset, "52-week range", "week52High", weekRange(asset)),
    metricRow(asset, "Volume", "volume", volumeNumber(asset.volume)),
    metricRow(asset, "Average volume", "averageVolume", volumeNumber(asset.averageVolume)),
    metricRow(asset, "Exchange", "exchange", asset.exchange || "Unavailable"),
    metricRow(asset, "Last updated", "lastUpdated", displayDate(asset.lastUpdated))
  ];
}

function financialMetricRows(asset) {
  return [
    metricRow(asset, "Market cap", "marketCap", asset.marketCap ? `$${compactNumber(asset.marketCap)}` : "Unavailable"),
    metricRow(asset, "P/E ratio", "peRatio", number(asset.peRatio, 2), valuationBadge(asset)),
    metricRow(asset, "Forward P/E", "forwardPe", number(asset.forwardPe, 2)),
    metricRow(asset, "Price-to-book", "priceToBook", number(asset.priceToBook, 2)),
    metricRow(asset, "EPS", "eps", money(asset.eps, asset.currency)),
    metricRow(asset, "Dividend yield", "dividendYield", percent(asset.dividendYield, false)),
    metricRow(asset, "Revenue growth", "revenueGrowth", percent(asset.revenueGrowth)),
    metricRow(asset, "Earnings growth", "earningsGrowth", percent(asset.earningsGrowth)),
    metricRow(asset, "Profit margin", "profitMargin", percent(asset.profitMargin, false), marginBadge(asset)),
    metricRow(asset, "Operating margin", "operatingMargin", percent(asset.operatingMargin, false)),
    metricRow(asset, "Debt-to-equity", "debtToEquity", asset.debtToEquity === null ? "Unavailable" : number(asset.debtToEquity, 2)),
    metricRow(asset, "Return on equity", "returnOnEquity", percent(asset.returnOnEquity, false)),
    metricRow(asset, "Beta", "beta", number(asset.beta, 2), betaBadge(asset)),
    metricRow(asset, "Sector / industry", "sector", `${asset.sector || "Unavailable"} / ${asset.industry || "Unavailable"}`)
  ];
}

function renderMetricCards(rows) {
  return rows.map((entry) => {
    const row = Array.isArray(entry)
      ? { label: entry[0], value: entry[1], source: entry[2] || "Aurex portfolio model", missing: "Derived from portfolio inputs." }
      : entry;
    return `
    <div class="metric">
      <span>${row.label}${row.tooltip ? `<button class="metric-help" type="button" title="${row.tooltip}">?</button>` : ""}</span>
      <strong>${row.value}</strong>
      ${row.badge ? `<em class="metric-badge ${row.badge.tone}">${row.badge.text}</em>` : ""}
      <small class="metric-source">${String(row.value).toLowerCase().includes("unavailable") ? "Unavailable from current provider" : `Source: ${row.source}`}</small>
    </div>
  `;
  }).join("");
}

function metricRow(asset, label, field, value, badge = null) {
  return {
    label,
    field,
    value,
    badge,
    tooltip: METRIC_TOOLTIPS[field],
    source: asset.sources?.[field] || "Unavailable from current provider",
    missing: asset.missingReasons?.[field] || "Unavailable from current provider."
  };
}

function dayRange(asset) {
  if (!isRealNumber(asset.dayLow) || !isRealNumber(asset.dayHigh)) return "Unavailable";
  return `${money(asset.dayLow, asset.currency)} - ${money(asset.dayHigh, asset.currency)}`;
}

function weekRange(asset) {
  if (!isRealNumber(asset.week52Low) || !isRealNumber(asset.week52High)) return "Unavailable";
  return `${money(asset.week52Low, asset.currency)} - ${money(asset.week52High, asset.currency)}`;
}

function valuationBadge(asset) {
  if (!isRealNumber(asset.peRatio) || !isRealNumber(asset.sectorBenchmark?.pe)) return null;
  const spread = asset.peRatio - asset.sectorBenchmark.pe;
  if (spread < -4) return { text: "Below sector est.", tone: "good" };
  if (spread > 6) return { text: "Above sector est.", tone: "watch" };
  return { text: "Near sector est.", tone: "neutral" };
}

function marginBadge(asset) {
  if (!isRealNumber(asset.profitMargin) || !isRealNumber(asset.sectorBenchmark?.profitMargin)) return null;
  const spread = asset.profitMargin - asset.sectorBenchmark.profitMargin;
  if (spread > 4) return { text: "Stronger than sector est.", tone: "good" };
  if (spread < -4) return { text: "Below sector est.", tone: "watch" };
  return { text: "Near sector est.", tone: "neutral" };
}

function betaBadge(asset) {
  if (!isRealNumber(asset.beta)) return { text: "Inferred from history", tone: "neutral" };
  if (asset.beta > 1.25) return { text: "Above market risk", tone: "watch" };
  if (asset.beta < 0.85) return { text: "Lower than market", tone: "good" };
  return { text: "Market-like", tone: "neutral" };
}

function formatDailyMove(asset) {
  if (asset.change === null && asset.changePercent === null) return "Daily move unavailable";
  const change = isRealNumber(asset.change) ? asset.change >= 0 ? `+${money(asset.change, asset.currency)}` : money(asset.change, asset.currency) : "Unavailable";
  return `${change} (${percent(asset.changePercent)})`;
}

function renderDataQuality(dataQuality) {
  const tone = dataQuality.score >= 80 ? "good" : dataQuality.score >= 55 ? "neutral" : "watch";
  return `
    <div class="quality-card ${tone}">
      <div>
        <strong>Data Quality: ${dataQuality.score}/100</strong>
        <p>${dataQuality.summary}</p>
      </div>
      <small>${dataQuality.missing.length ? `Missing: ${dataQuality.missing.slice(0, 5).join(", ")}` : "All tracked quality fields available."}</small>
    </div>
  `;
}

function renderScoreBars(categories, asset) {
  const labels = {
    balanceSheet: ["Balance sheet", asset.debtToEquity !== null ? `Debt/equity ${number(asset.debtToEquity, 2)}` : "Debt data unavailable"],
    valuation: ["Valuation", asset.peRatio !== null ? `P/E ${number(asset.peRatio, 1)}x` : "P/E unavailable"],
    growth: ["Growth", asset.revenueGrowth !== null ? `Revenue ${percent(asset.revenueGrowth)}` : "Growth unavailable"],
    profitability: ["Profitability", asset.profitMargin !== null ? `Margin ${percent(asset.profitMargin, false)}` : "Margin unavailable"],
    risk: ["Risk", asset.beta !== null ? `Beta ${number(asset.beta, 2)}` : "Risk inferred from price history"],
    newsSentiment: ["News sentiment", asset.news?.length ? `${asset.news.length} recent articles` : "News unavailable"]
  };
  const cards = Object.entries(CATEGORY_WEIGHTS).map(([key, weight]) => {
    const value = Math.round(categories[key]);
    const [label, driver] = labels[key];
    const copy = scoreCategoryCopy(key, value);
    return `
      <div class="score-card">
        <div class="score-card-head">
          <span>${label}</span>
          <strong>${value}/100</strong>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
        <p>${copy}</p>
        <small>${weight}% weight / ${driver}</small>
      </div>
    `;
  });
  cards.push(`
    <div class="score-card">
      <div class="score-card-head">
        <span>Portfolio fit</span>
        <strong>${portfolioFitScore(asset)}/100</strong>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${portfolioFitScore(asset)}%"></div></div>
      <p>${portfolioFitScore(asset) >= 70 ? "This asset appears compatible with the current simulated portfolio." : "This asset may add concentration or risk relative to current portfolio settings."}</p>
      <small>Personalized / sector exposure, risk tolerance, and current holdings</small>
    </div>
  `);
  return cards.join("");
}

function scoreCategoryCopy(key, value) {
  if (value >= 70) {
    return {
      valuation: "Valuation is supportive relative to available benchmarks.",
      growth: "Growth signals are helping the score.",
      profitability: "Margins are a clear positive.",
      balanceSheet: "Financial strength appears supportive.",
      risk: "Risk indicators look manageable.",
      newsSentiment: "Recent news tone is constructive."
    }[key];
  }
  if (value >= 45) return "This factor is neutral to mixed based on available data.";
  return {
    valuation: "Valuation is elevated or incomplete.",
    growth: "Growth is weak or unavailable.",
    profitability: "Profitability is below model preference or missing.",
    balanceSheet: "Balance-sheet data is weak or incomplete.",
    risk: "Risk indicators are elevated.",
    newsSentiment: "News tone is a drag."
  }[key];
}

function renderAnalystReport(rows) {
  return rows.map(([title, copy]) => `
    <div class="research-card analyst-card">
      <h3>${title}</h3>
      <p class="explanation">${copy}</p>
    </div>
  `).join("");
}

function renderResearchCards(research) {
  const cards = [
    ["Strengths", research.strengths],
    ["Weaknesses", research.weaknesses],
    ["Major risks", research.risks],
    ["Key catalysts", research.catalysts]
  ];
  return cards.map(([title, items]) => `
    <div class="research-card">
      <h3>${title}</h3>
      <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
  `).join("");
}

function renderSectorComparison(asset) {
  const benchmark = asset.sectorBenchmark || {};
  const rows = [
    {
      title: "P/E vs sector",
      copy: isRealNumber(asset.peRatio) && isRealNumber(benchmark.pe)
        ? `${asset.symbol} trades at ${number(asset.peRatio, 1)}x earnings versus an estimated ${number(benchmark.pe, 1)}x sector benchmark.`
        : "P/E comparison unavailable because the provider did not return enough valuation data."
    },
    {
      title: "Profit margin vs sector",
      copy: isRealNumber(asset.profitMargin) && isRealNumber(benchmark.profitMargin)
        ? `${asset.symbol}'s profit margin is ${percent(asset.profitMargin, false)} versus an estimated ${percent(benchmark.profitMargin, false)} sector benchmark.`
        : "Profit margin comparison unavailable because the provider did not return margin data."
    },
    {
      title: "Beta vs market",
      copy: isRealNumber(asset.beta)
        ? `${asset.symbol} beta is ${number(asset.beta, 2)}. A beta near 1.00 is broad-market-like; higher means more volatile.`
        : "Beta unavailable; Aurex uses recent price volatility as fallback risk evidence."
    }
  ];
  $("#sectorComparisonGrid").innerHTML = rows.map((row) => `
    <div class="research-card">
      <h3>${row.title}</h3>
      <p class="explanation">${row.copy}</p>
      <small class="metric-source">${benchmark.source || "Estimated sector benchmark"}</small>
    </div>
  `).join("");
}

function renderInterpretation(asset) {
  const rows = [
    ["Valuation interpretation", valuationInterpretation(asset)],
    ["Risk interpretation", riskInterpretation(asset)],
    ["Data freshness", asset.freshness?.note || "Price data may update intraday while fundamentals can lag provider refreshes."]
  ];
  $("#interpretationGrid").innerHTML = rows.map(([title, copy]) => `
    <div class="research-card">
      <h3>${title}</h3>
      <p class="explanation">${copy}</p>
    </div>
  `).join("");
}

function renderFairValue(asset) {
  const estimate = fairValueEstimate(asset);
  if (!estimate.available) {
    $("#fairValuePanel").innerHTML = `<div class="empty-state">${estimate.copy}</div>`;
    return;
  }
  $("#fairValuePanel").innerHTML = `
    <div class="fair-value-grid">
      <div><span>Estimated range</span><strong>${money(estimate.low, asset.currency)} - ${money(estimate.high, asset.currency)}</strong></div>
      <div><span>Current price</span><strong>${money(asset.price, asset.currency)}</strong></div>
      <div><span>Signal</span><strong>${estimate.status === "below" ? "Below range" : estimate.status === "above" ? "Above range" : "Near range"}</strong></div>
    </div>
    <p class="explanation">${estimate.copy}</p>
    <small class="metric-source">Educational estimate, not a prediction. Uses EPS, estimated sector P/E, growth, margin, and risk inputs.</small>
  `;
}

function renderWeekPosition(asset) {
  const position = weekPosition(asset);
  if (!position) {
    $("#weekPositionPanel").innerHTML = `<div class="empty-state">52-week position unavailable from current provider.</div>`;
    return;
  }
  $("#weekPositionPanel").innerHTML = `
    <div class="week-position-label">
      <strong>52-week position</strong>
      <span>${position.pct.toFixed(1)}%</span>
    </div>
    <div class="range-track"><div class="range-fill" style="width:${position.pct}%"></div></div>
    <p class="explanation">${position.copy}</p>
  `;
}

function renderEarningsCatalyst(asset, research) {
  const earningsUnavailable = !asset.nextEarningsDate && asset.earningsSurprise === null;
  $("#earningsStatus").textContent = earningsUnavailable ? "Earnings data unavailable from provider" : "Provider earnings data";
  const rows = [
    metricCatalyst("Next earnings date", asset.nextEarningsDate ? displayDate(asset.nextEarningsDate) : "Earnings data unavailable from provider.", asset, "nextEarningsDate"),
    metricCatalyst("Recent earnings surprise", asset.earningsSurprise !== null ? percent(asset.earningsSurprise) : "Earnings data unavailable from provider.", asset, "earningsSurprise"),
    metricCatalyst("Major catalyst", research.catalysts[0] || "Catalyst unavailable from returned data.", asset, "news"),
    metricCatalyst("Main risk catalyst", research.risks[0] || "Risk catalyst unavailable from returned data.", asset, "news")
  ];
  $("#earningsCatalystGrid").innerHTML = rows.map((row) => `
    <div class="research-card">
      <h3>${row.title}</h3>
      <p class="explanation">${row.copy}</p>
      <small class="metric-source">${row.source}</small>
    </div>
  `).join("");
}

function metricCatalyst(title, copy, asset, field) {
  const missing = String(copy).includes("unavailable");
  return {
    title,
    copy,
    source: missing ? asset.missingReasons?.[field] || "Provider did not return this field." : asset.sources?.[field] || "Derived by Aurex analysis"
  };
}

function renderNews(asset) {
  const score = newsScore(asset.news);
  $("#newsScoreLabel").textContent = asset.news?.length ? `Sentiment ${Math.round(score)}/100` : "No recent news returned";
  if (!asset.news?.length) {
    $("#newsList").innerHTML = `<div class="empty-state">No recent news was returned by the active provider. News is treated as neutral and cannot overpower fundamentals.</div>`;
    return;
  }
  $("#newsList").innerHTML = asset.news.slice(0, 5).map((item) => `
    <article class="news-item">
      <a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.headline}</a>
      <div class="news-meta">
        <span>${item.source || "Unknown source"}</span>
        <span>${displayDate(item.date)}</span>
        <span class="sentiment ${item.sentiment}">${item.sentiment}</span>
      </div>
      <p class="explanation">${item.summary || "No summary returned by the provider."}</p>
      <small class="metric-source">Why this matters: ${whyNewsMatters(item)}</small>
    </article>
  `).join("");
}

function whyNewsMatters(item) {
  const text = `${item.headline || ""} ${item.summary || ""}`.toLowerCase();
  if (text.includes("earnings") || text.includes("profit") || text.includes("margin")) return "earnings and margins can directly affect valuation and the model score.";
  if (text.includes("ai") || text.includes("cloud") || text.includes("chip")) return "technology investment themes may affect future revenue growth expectations.";
  if (text.includes("upgrade") || text.includes("downgrade") || text.includes("analyst")) return "analyst revisions can influence near-term sentiment, though fundamentals still carry more weight.";
  if (text.includes("lawsuit") || text.includes("probe") || text.includes("regulator")) return "legal or regulatory pressure can increase risk and uncertainty.";
  return "recent news can shift sentiment, but Aurex keeps fundamentals as the main driver.";
}

async function runSearch() {
  const query = $("#assetSearch").value.trim();
  const filters = {
    type: $("#assetTypeFilter").value,
    sector: $("#sectorFilter").value.trim(),
    exchange: $("#exchangeFilter").value.trim()
  };
  $("#searchMessage").textContent = "Searching live provider...";
  try {
    const response = await marketApi.search(query, filters);
    renderSearchResults(response.results);
    $("#searchMessage").textContent = response.warning
      ? `Search provider is rate-limited or unavailable. Showing fallback results.`
      : `${response.results.length} results from ${response.provider}. Live search is primary; fallback metadata is labeled.`;
  } catch (error) {
    $("#searchMessage").textContent = friendlyError(error.message);
    renderSearchResults(EXAMPLE_ASSETS.slice(0, 12).map((symbol) => ({ symbol, name: symbol, assetType: "Fallback", exchange: "Example", sector: "Example", industry: "Fallback", isLiveSearch: false })));
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    $("#searchResults").innerHTML = `<div class="empty-state">No results matched. Try a ticker, company name, ETF, sector, crypto pair, or exchange.</div>`;
    return;
  }
  $("#searchResults").innerHTML = results.map((asset) => `
    <div class="search-result">
      <div>
        <strong>${asset.symbol} - ${asset.name}</strong>
        <span>${asset.assetType} / ${asset.exchange} / ${asset.sector || "Sector unknown"} / ${asset.industry || "Industry unknown"} / ${asset.isLiveSearch ? "Live search" : "Fallback catalog"}</span>
      </div>
      <div class="search-actions">
        <button type="button" data-action="analyze" data-symbol="${asset.symbol}">Analyze</button>
        <button type="button" data-action="compare" data-symbol="${asset.symbol}">Compare</button>
      </div>
    </div>
  `).join("");
  $$("#searchResults button").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.dataset.symbol;
      if (button.dataset.action === "compare") {
        addComparisonSymbol(symbol);
        showTab("comparison");
        await renderComparison(true);
      } else {
        await loadAsset(symbol);
        showTab("analysis");
      }
    });
  });
}

async function renderComparison(force = false) {
  $("#comparisonCount").textContent = `${state.comparisonSymbols.length} selected`;
  updateCompareControls();
  try {
    const assets = await marketApi.assets(state.comparisonSymbols, force);
    const scored = assets.map((asset) => {
      const score = scoreAsset(asset);
      return { asset, score, research: buildResearch(asset, score) };
    });
    if (!scored.length) {
      $("#comparisonSummary").textContent = "Add at least two assets to compare.";
      return;
    }
    const ranked = [...scored].sort((a, b) => b.score.overall - a.score.overall);
    const best = ranked[0];
    const second = ranked[1];
    $("#comparisonSummary").textContent = second
      ? `${best.asset.symbol} appears strongest overall because it has the best score (${best.score.overall}/100), ${best.score.confidence.level.toLowerCase()} confidence, and data quality of ${best.score.dataQuality.score}/100. Its edge is ${best.score.factors.strongest[0].toLowerCase()}, while ${second.asset.symbol}'s biggest drag is ${second.score.factors.weakest[0].toLowerCase()}. Compare valuation, growth, risk, and portfolio fit before treating this as a decision signal.`
      : `${best.asset.symbol} is selected. Add another asset for a relative conclusion.`;
    renderComparisonWinners(scored);
    $("#comparisonTable").innerHTML = comparisonTable(scored);
    drawComparisonChart($("#comparisonChart"), scored);
    stampUpdate();
  } catch (error) {
    showAlert(`Comparison update failed: ${error.message}`);
  }
}

function renderComparisonWinners(scored) {
  const winner = (label, sorter, reason) => {
    const picked = [...scored].sort(sorter)[0];
    return `<div class="winner-card"><span>${label}</span><strong>${picked.asset.symbol}</strong><small>${reason(picked)}</small></div>`;
  };
  $("#comparisonWinners").innerHTML = [
    winner("Strongest valuation", (a, b) => b.score.categories.valuation - a.score.categories.valuation, (item) => `Valuation ${Math.round(item.score.categories.valuation)}/100`),
    winner("Strongest growth", (a, b) => b.score.categories.growth - a.score.categories.growth, (item) => `Growth ${Math.round(item.score.categories.growth)}/100`),
    winner("Lowest risk", (a, b) => b.score.categories.risk - a.score.categories.risk, (item) => `Risk score ${Math.round(item.score.categories.risk)}/100`),
    winner("Best overall", (a, b) => b.score.overall - a.score.overall, (item) => `${item.score.overall}/100 ${item.score.verdict}`),
    winner("Best data quality", (a, b) => b.score.dataQuality.score - a.score.dataQuality.score, (item) => `Data ${item.score.dataQuality.score}/100`),
    winner("Best portfolio fit", (a, b) => portfolioFitScore(b.asset) - portfolioFitScore(a.asset), (item) => `Fit ${portfolioFitScore(item.asset)}/100`)
  ].join("");
}

function comparisonTable(scored) {
  const headers = ["Metric", ...scored.map(({ asset }) => asset.symbol)];
  const rows = [
    ["Price", ...scored.map(({ asset }) => money(asset.price, asset.currency))],
    ["Daily change", ...scored.map(({ asset }) => formatDailyMove(asset))],
    ["Market cap", ...scored.map(({ asset }) => asset.marketCap ? `$${compactNumber(asset.marketCap)}` : "Unavailable")],
    ["P/E", ...scored.map(({ asset }) => number(asset.peRatio, 2))],
    ["Forward P/E", ...scored.map(({ asset }) => number(asset.forwardPe, 2))],
    ["Revenue growth", ...scored.map(({ asset }) => percent(asset.revenueGrowth))],
    ["Profit margin", ...scored.map(({ asset }) => percent(asset.profitMargin, false))],
    ["Debt-to-equity", ...scored.map(({ asset }) => asset.debtToEquity === null ? "Unavailable" : number(asset.debtToEquity, 2))],
    ["Beta", ...scored.map(({ asset }) => number(asset.beta, 2))],
    ["52-week range", ...scored.map(({ asset }) => weekRange(asset))],
    ["News sentiment", ...scored.map(({ asset }) => `${Math.round(newsScore(asset.news))}/100`)],
    ["Data quality", ...scored.map(({ score }) => `${score.dataQuality.score}/100`)],
    ["Overall score", ...scored.map(({ score }) => `${score.overall}/100`)],
    ["Confidence", ...scored.map(({ score }) => score.confidence.level)],
    ["Verdict", ...scored.map(({ score }) => score.verdict)]
  ];
  return `<thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

async function renderPortfolio(force = false) {
  syncPortfolioSettings();
  const symbols = state.portfolio.holdings.map((holding) => holding.symbol);
  const assets = await marketApi.assets(symbols, force).catch(() => []);
  const bySymbol = Object.fromEntries(assets.map((asset) => [asset.symbol, asset]));
  const holdings = state.portfolio.holdings.map((holding) => {
    const asset = bySymbol[holding.symbol] || { symbol: holding.symbol, price: null, sector: "Unknown", industry: "Unknown", beta: null, style: "Unknown", assetType: "Unknown", currency: "USD" };
    const currentPrice = asset.price ?? holding.purchasePrice ?? 0;
    const cost = holding.shares * holding.purchasePrice;
    const value = holding.shares * currentPrice;
    return { ...holding, asset, currentPrice, cost, value, gain: value - cost };
  });
  const invested = holdings.reduce((sum, holding) => sum + holding.cost, 0);
  const marketValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const cash = state.portfolio.startingCash - invested;
  const totalValue = Math.max(0, cash) + marketValue;
  const diversification = scoreDiversification(holdings, totalValue);
  $("#portfolioValue").textContent = money(totalValue);
  $("#cashRemaining").textContent = `Cash remaining ${money(cash)}`;
  $("#portfolioMetrics").innerHTML = renderMetricCards([
    ["Total simulated value", money(totalValue)],
    ["Cash remaining", money(cash)],
    ["Holdings value", money(marketValue)],
    ["Profit/loss", money(marketValue - invested)],
    ["Risk level", diversification.riskLabel],
    ["Top sector", diversification.topSector.label]
  ]);
  $("#holdingsTable").innerHTML = holdingsTable(holdings, totalValue);
  renderDiversification(diversification);
  drawDonutChart($("#sectorChart"), sectorAllocationRows(holdings), totalValue);
  drawDonutChart($("#holdingChart"), holdings.map((holding) => ({ label: holding.symbol, value: holding.value })), totalValue);
  if (state.selectedAsset) renderPortfolioAware(state.selectedAsset, scoreAsset(state.selectedAsset));
  stampUpdate();
}

function holdingsTable(holdings, totalValue) {
  const headers = ["Symbol", "Type", "Sector", "Shares", "Avg price", "Current price", "Market value", "Gain/loss", "Allocation"];
  const rows = holdings.map((holding) => {
    const allocation = totalValue ? holding.value / totalValue * 100 : 0;
    return [
      holding.symbol,
      holding.asset.assetType || "Unknown",
      holding.asset.sector || "Unknown",
      number(holding.shares, 2),
      money(holding.purchasePrice, holding.asset.currency),
      money(holding.currentPrice, holding.asset.currency),
      money(holding.value, holding.asset.currency),
      `<span class="${holding.gain >= 0 ? "positive" : "negative"}">${money(holding.gain, holding.asset.currency)}</span>`,
      `${allocation.toFixed(1)}%`
    ];
  });
  return `<thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function scoreDiversification(holdings, totalValue) {
  const countScore = clamp((holdings.length / 12) * 18, 0, 18);
  const largest = largestPosition(holdings, totalValue);
  const positionScore = clamp(23 - Math.max(0, largest.percent - state.portfolio.maxAllocation) * 1.15, 0, 23);
  const top3Pct = topPositionConcentration(holdings, totalValue, 3);
  const top3Score = clamp(10 - Math.max(0, top3Pct - 55) * 0.22, 0, 10);
  const topSectorValue = topSector(holdings, totalValue);
  const sectorScore = clamp(21 - Math.max(0, topSectorValue.percent - 35) * 0.85, 0, 21);
  const typeCount = new Set(holdings.map((holding) => holding.asset.assetType || "Unknown")).size;
  const typeScore = clamp((typeCount / 4) * 12, 0, 12);
  const averageBeta = holdings.length ? holdings.reduce((sum, holding) => sum + (holding.asset.beta ?? riskFallback(holding.asset)), 0) / holdings.length : 1;
  const riskTarget = state.portfolio.riskTolerance === "Conservative" ? 0.85 : state.portfolio.riskTolerance === "Aggressive" ? 1.35 : 1.05;
  const riskScore = clamp(13 - Math.max(0, averageBeta - riskTarget) * 18, 0, 13);
  const overlapPenalty = similarHoldingPenalty(holdings);
  const overlapScore = clamp(10 - overlapPenalty, 0, 10);
  const total = Math.round(countScore + positionScore + top3Score + sectorScore + typeScore + riskScore + overlapScore);
  const suggestions = [];
  if (holdings.length < 8) suggestions.push("Add more holdings to reduce single-position risk.");
  if (topSectorValue.percent > 40) suggestions.push(`Reduce ${topSectorValue.name} concentration or add exposure to other sectors.`);
  if (largest.percent > state.portfolio.maxAllocation) suggestions.push(`${largest.name} exceeds your maximum allocation target.`);
  if (top3Pct > 60) suggestions.push(`Top three holdings are ${top3Pct.toFixed(1)}% of the portfolio, increasing concentration risk.`);
  if (typeCount < 2) suggestions.push("Add asset-type diversity, such as broad-market ETFs or defensive exposure.");
  if (averageBeta > riskTarget + 0.2) suggestions.push("Add lower-beta assets to better match your selected risk tolerance.");
  if (overlapPenalty > 3) suggestions.push("Several holdings appear similar by sector or style, which can create hidden overlap.");
  if (!suggestions.length) suggestions.push("Portfolio balance looks reasonable against your current constraints.");
  const biggestWeakness = suggestions[0] || "No major diversification weakness detected.";
  const bestImprovement = topSectorValue.percent > 40
    ? `Consider researching assets outside ${topSectorValue.name}.`
    : typeCount < 2
      ? "Consider researching a different asset type, such as broad-market funds or defensive assets."
      : "Consider researching lower-overlap assets that add a different source of return.";
  const riskLabel = averageBeta >= 1.3 ? "Elevated" : averageBeta <= 0.85 ? "Lower" : "Moderate";
  return { total, topSector: topSectorValue, largest, top3Pct, averageBeta, typeCount, suggestions, riskLabel, biggestWeakness, bestImprovement };
}

function similarHoldingPenalty(holdings) {
  const buckets = {};
  holdings.forEach((holding) => {
    const key = `${holding.asset.sector || "Unknown"}-${styleBucket(holding.asset.style)}`;
    buckets[key] = (buckets[key] || 0) + 1;
  });
  return Object.values(buckets).reduce((penalty, count) => penalty + Math.max(0, count - 2) * 2.5, 0);
}

function renderDiversification(result) {
  $("#scoreRing").dataset.score = result.total;
  $("#scoreRing").style.background = `conic-gradient(var(--accent) ${result.total * 3.6}deg, var(--soft) ${result.total * 3.6}deg)`;
  $("#scoreTitle").textContent = result.total >= 75 ? "Well diversified" : result.total >= 50 ? "Moderately diversified" : "Concentrated portfolio";
  $("#scoreExplanation").textContent = `Diversification Score: ${result.total}/100. Your portfolio is ${result.total >= 75 ? "well diversified" : result.total >= 50 ? "moderately diversified" : "concentrated"}, with ${result.topSector.percent.toFixed(1)}% in ${result.topSector.name}, ${result.largest.percent.toFixed(1)}% in ${result.largest.name}, top-three concentration of ${result.top3Pct.toFixed(1)}%, ${result.typeCount} asset type(s), and average beta of ${result.averageBeta.toFixed(2)}. Biggest weakness: ${result.biggestWeakness} Best improvement: ${result.bestImprovement}`;
  $("#sectorRiskLabel").textContent = `${result.topSector.name}: ${result.topSector.percent.toFixed(1)}%`;
  $("#positionRiskLabel").textContent = `${result.largest.name}: ${result.largest.percent.toFixed(1)}%`;
  $("#portfolioSuggestions").innerHTML = result.suggestions.map((item) => `<span class="suggestion-pill">${item}</span>`).join("");
}

function topPositionConcentration(holdings, totalValue, count) {
  if (!holdings.length || !totalValue) return 0;
  return holdings
    .map((holding) => holding.value / totalValue * 100)
    .sort((a, b) => b - a)
    .slice(0, count)
    .reduce((sum, value) => sum + value, 0);
}

function renderPortfolioAware(asset, standaloneScore) {
  const holdings = state.portfolio.holdings.map((holding) => {
    const cached = state.cache.get(holding.symbol)?.asset;
    const value = holding.shares * (cached?.price ?? holding.purchasePrice);
    return { ...holding, asset: cached, value };
  });
  const investedValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const cash = state.portfolio.startingCash - state.portfolio.holdings.reduce((sum, holding) => sum + holding.shares * holding.purchasePrice, 0);
  const total = Math.max(0, cash) + investedValue || state.portfolio.startingCash;
  const sectorValue = holdings.filter((holding) => holding.asset?.sector === asset.sector).reduce((sum, holding) => sum + holding.value, 0);
  const sectorPct = total ? sectorValue / total * 100 : 0;
  const owned = holdings.find((holding) => holding.symbol === asset.symbol);
  let verdict = standaloneScore.verdict;
  const reasons = [`${asset.symbol} is rated ${standaloneScore.verdict} as a standalone asset at ${standaloneScore.overall}/100.`];
  if (standaloneScore.verdict === "Buy" && sectorPct > 45) {
    verdict = "Hold";
    reasons.push(`For this portfolio, it becomes a Hold because ${asset.sector} already makes up ${sectorPct.toFixed(1)}% of holdings.`);
  }
  if (verdict === "Buy" && (asset.beta ?? riskFallback(asset)) > 1.35 && state.portfolio.riskTolerance === "Conservative") {
    verdict = "Hold";
    reasons.push("The asset's risk profile is high relative to a conservative tolerance.");
  }
  if (owned && owned.value / total * 100 > state.portfolio.maxAllocation) {
    verdict = standaloneScore.verdict === "Sell" ? "Sell" : "Hold";
    reasons.push(`${asset.symbol} already exceeds the max allocation target, so adding more is not favored.`);
  }
  if (asset.price && cash < asset.price && verdict === "Buy") {
    verdict = "Hold";
    reasons.push("Available virtual cash is below one current share price.");
  }
  if (state.portfolio.investmentHorizon === "Under 1 year" && (asset.beta ?? riskFallback(asset)) > 1.25 && verdict === "Buy") {
    verdict = "Hold";
    reasons.push("A shorter horizon reduces tolerance for high-volatility assets.");
  }
  if (reasons.length === 1) {
    reasons.push(`${asset.sector} exposure is ${sectorPct.toFixed(1)}%, virtual cash is ${money(cash)}, and the selected constraints do not create a major conflict.`);
  }
  $("#portfolioAwareVerdict").textContent = verdict;
  $("#portfolioAwareExplanation").textContent = reasons.join(" ");
  $("#personalizationList").innerHTML = [
    `Risk tolerance: ${state.portfolio.riskTolerance}`,
    `Horizon: ${state.portfolio.investmentHorizon}`,
    `${asset.sector} exposure: ${sectorPct.toFixed(1)}%`,
    `Virtual cash: ${money(cash)}`
  ].map((item) => `<span class="suggestion-pill">${item}</span>`).join("");
  renderTradeImpact(asset);
}

function portfolioFitScore(asset) {
  const holdings = state.portfolio.holdings.map((holding) => {
    const cached = state.cache.get(holding.symbol)?.asset;
    return { ...holding, asset: cached || {}, value: holding.shares * (cached?.price ?? holding.purchasePrice) };
  });
  const total = holdings.reduce((sum, holding) => sum + holding.value, 0) || state.portfolio.startingCash || 1;
  const sectorPct = holdings.filter((holding) => holding.asset?.sector === asset.sector).reduce((sum, holding) => sum + holding.value, 0) / total * 100;
  const beta = asset.beta ?? riskFallback(asset);
  const riskTarget = state.portfolio.riskTolerance === "Conservative" ? 0.85 : state.portfolio.riskTolerance === "Aggressive" ? 1.35 : 1.05;
  return Math.round(clamp(92 - Math.max(0, sectorPct - 30) * 0.8 - Math.max(0, beta - riskTarget) * 18, 20, 100));
}

function renderTradeImpact(asset) {
  if (!asset || !$("#tradeImpactResult")) return;
  const baseHoldings = state.portfolio.holdings.map((holding) => {
    const cached = state.cache.get(holding.symbol)?.asset;
    const currentPrice = cached?.price ?? holding.purchasePrice;
    return { ...holding, asset: cached || { symbol: holding.symbol, sector: "Unknown", assetType: "Unknown", beta: null, style: "Unknown" }, currentPrice, value: holding.shares * currentPrice };
  });
  const baseMarketValue = baseHoldings.reduce((sum, holding) => sum + holding.value, 0);
  const investedCost = state.portfolio.holdings.reduce((sum, holding) => sum + holding.shares * holding.purchasePrice, 0);
  const cash = Math.max(0, state.portfolio.startingCash - investedCost);
  const baseTotal = baseMarketValue + cash || state.portfolio.startingCash || 1;
  const dollars = Number($("#tradeDollars").value) || 0;
  const shares = Number($("#tradeShares").value) || (asset.price ? dollars / asset.price : 0);
  const percentInput = Number($("#tradePercent").value) || 0;
  const tradeValue = percentInput ? baseTotal * percentInput / 100 : asset.price ? shares * asset.price : dollars;
  const beforeSector = sectorPercent(baseHoldings, baseTotal, asset.sector);
  const simulatedHolding = {
    symbol: asset.symbol,
    shares,
    purchasePrice: asset.price || 0,
    asset,
    currentPrice: asset.price || 0,
    value: tradeValue
  };
  const afterHoldings = [...baseHoldings, simulatedHolding];
  const afterTotal = baseTotal + tradeValue;
  const afterSector = sectorPercent(afterHoldings, afterTotal, asset.sector);
  const beforeScore = scoreDiversification(baseHoldings, baseTotal).total;
  const afterScore = scoreDiversification(afterHoldings, afterTotal).total;
  const direction = afterScore >= beforeScore ? "improves or preserves" : "weakens";
  $("#tradeImpactResult").innerHTML = `
    <strong>${asset.symbol} trade impact</strong>
    <p class="explanation">Adding ${money(tradeValue, asset.currency)} would move ${asset.sector} exposure from ${beforeSector.toFixed(1)}% to ${afterSector.toFixed(1)}% and ${direction} diversification (${beforeScore}/100 to ${afterScore}/100).</p>
    <small class="metric-source">${afterSector > 45 ? `Concentration risk rises because ${asset.sector} would exceed 45%.` : "Trade impact is estimated from simulated holdings and current provider prices."}</small>
  `;
}

function sectorPercent(holdings, totalValue, sector) {
  if (!totalValue) return 0;
  return holdings.filter((holding) => holding.asset?.sector === sector).reduce((sum, holding) => sum + holding.value, 0) / totalValue * 100;
}

function sectorAllocationRows(holdings) {
  const totals = {};
  holdings.forEach((holding) => {
    const sector = holding.asset.sector || "Unknown";
    totals[sector] = (totals[sector] || 0) + holding.value;
  });
  return Object.entries(totals).map(([label, value]) => ({ label, value }));
}

function largestPosition(holdings, totalValue) {
  if (!holdings.length || !totalValue) return { name: "None", label: "None", percent: 0 };
  const largest = holdings.map((holding) => ({ name: holding.symbol, percent: holding.value / totalValue * 100 })).sort((a, b) => b.percent - a.percent)[0];
  return { ...largest, label: `${largest.name} ${largest.percent.toFixed(1)}%` };
}

function topSector(holdings, totalValue) {
  const sectors = sectorAllocationRows(holdings);
  if (!sectors.length || !totalValue) return { name: "None", label: "None", percent: 0 };
  const top = sectors.map((sector) => ({ name: sector.label, percent: sector.value / totalValue * 100 })).sort((a, b) => b.percent - a.percent)[0];
  return { ...top, label: `${top.name} ${top.percent.toFixed(1)}%` };
}

function riskFallback(asset) {
  if (asset.assetType === "CRYPTOCURRENCY") return 1.8;
  if (asset.style?.toLowerCase().includes("defensive")) return 0.75;
  if (asset.style?.toLowerCase().includes("growth")) return 1.2;
  return 1;
}

function styleBucket(style = "") {
  const text = style.toLowerCase();
  if (text.includes("defensive")) return "Defensive";
  if (text.includes("value")) return "Value";
  return "Growth";
}

function syncPortfolioSettings() {
  state.portfolio.startingCash = Number($("#startingCash").value) || 0;
  state.portfolio.riskTolerance = $("#riskTolerance").value;
  state.portfolio.investmentHorizon = $("#investmentHorizon").value;
  state.portfolio.maxAllocation = Number($("#maxAllocation").value) || 25;
  state.portfolio.sectorPreferences = $("#sectorPreferences").value;
}

function drawLineChart(canvas, history, color, currency = "USD", timeframe = "1Y", currentPrice = null) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  drawChartGrid(ctx, width, height);
  if (!history || history.length < 2) {
    drawCenteredText(ctx, "Price history unavailable");
    return;
  }
  const lengths = { "1M": 22, "6M": 126, "1Y": 252 };
  const points = history.slice(-(lengths[timeframe] || 252));
  $("#priceRangeLabel").textContent = timeframe === "1M" ? "1 month" : timeframe === "6M" ? "6 months" : "1 year";
  const values = points.map((point) => point.close);
  const allValues = isRealNumber(currentPrice) ? [...values, currentPrice] : values;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const coords = points.map((point, index) => [
    42 + index * ((width - 84) / (points.length - 1)),
    height - 36 - ((point.close - min) / range) * (height - 74)
  ]);
  ctx.beginPath();
  coords.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineTo(coords.at(-1)[0], height - 34);
  ctx.lineTo(coords[0][0], height - 34);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 24, 0, height);
  gradient.addColorStop(0, `${color}38`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.fill();
  if (isRealNumber(currentPrice)) {
    const y = height - 36 - ((currentPrice - min) / range) * (height - 74);
    ctx.beginPath();
    ctx.setLineDash([7, 7]);
    ctx.moveTo(42, y);
    ctx.lineTo(width - 28, y);
    ctx.strokeStyle = cssVar("--muted");
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = canvasTextColor();
    ctx.fillText(`Current ${money(currentPrice, currency)}`, width - 178, y - 8);
  }
  ctx.fillStyle = canvasTextColor();
  ctx.font = "700 13px system-ui";
  ctx.fillText(`${money(max, currency)} high`, 44, 24);
  ctx.fillText(`${money(min, currency)} low`, 44, height - 12);
}

function drawComparisonChart(canvas, scored) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  drawChartGrid(ctx, width, height);
  if (!scored.length) {
    drawCenteredText(ctx, "Add assets to compare");
    return;
  }
  const barWidth = Math.min(72, (width - 110) / scored.length - 16);
  scored.forEach(({ asset, score }, index) => {
    const x = 70 + index * ((width - 120) / scored.length) + 12;
    const barHeight = (score.overall / 100) * (height - 72);
    const y = height - 38 - barHeight;
    ctx.fillStyle = score.verdict === "Buy" ? "#0f8a5f" : score.verdict === "Sell" ? "#c24135" : "#b7791f";
    roundedRect(ctx, x, y, barWidth, barHeight, 8);
    ctx.fill();
    ctx.fillStyle = canvasTextColor();
    ctx.font = "800 13px system-ui";
    ctx.fillText(asset.symbol, x, height - 14);
    ctx.fillText(score.overall, x, y - 8);
  });
}

function drawDonutChart(canvas, rows, totalValue) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!rows.length || !totalValue) {
    drawCenteredText(ctx, "No allocation data");
    return;
  }
  const colors = ["#0f766e", "#2359d1", "#c28a22", "#6d5bd0", "#0f8a5f", "#c24135", "#64748b", "#0891b2"];
  const centerX = width * 0.34;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.31;
  let start = -Math.PI / 2;
  rows.forEach((row, index) => {
    const angle = (row.value / totalValue) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    start += angle;
  });
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = cssVar("--surface");
  ctx.fill();
  ctx.font = "800 13px system-ui";
  rows.slice(0, 6).forEach((row, index) => {
    const y = 44 + index * 30;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(width * 0.62, y - 10, 12, 12);
    ctx.fillStyle = canvasTextColor();
    ctx.fillText(`${row.label} ${(row.value / totalValue * 100).toFixed(1)}%`, width * 0.62 + 20, y);
  });
}

function drawChartGrid(ctx, width, height) {
  ctx.strokeStyle = cssVar("--line");
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = 28 + i * ((height - 64) / 4);
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 28, y);
    ctx.stroke();
  }
}

function drawCenteredText(ctx, text) {
  ctx.fillStyle = canvasTextColor();
  ctx.font = "800 15px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, ctx.canvas.width / 2, ctx.canvas.height / 2);
  ctx.textAlign = "start";
}

function canvasTextColor() {
  return cssVar("--muted");
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function showTab(id) {
  $$(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

function showAlert(message) {
  $("#appAlert").hidden = false;
  $("#appAlert").textContent = message;
}

function clearAlert() {
  $("#appAlert").hidden = true;
  $("#appAlert").textContent = "";
}

function setPanelLoading(isLoading) {
  $("#companyPanel")?.classList.toggle("loading", isLoading);
}

function stampUpdate(value) {
  const target = $("#lastUpdated");
  if (target) target.textContent = value ? `Updated ${displayDate(value)}` : `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function addComparisonSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!state.comparisonSymbols.includes(normalized)) state.comparisonSymbols.push(normalized);
  if (state.comparisonSymbols.length > 6) state.comparisonSymbols.shift();
  updateCompareControls();
}

function removeComparisonSymbol(symbol) {
  state.comparisonSymbols = state.comparisonSymbols.filter((item) => item !== symbol);
  if (state.comparisonSymbols.length < 2) state.comparisonSymbols.push(state.selectedSymbol || "MSFT");
  updateCompareControls();
}

function updateCompareControls() {
  const target = $("#compareControls");
  if (!target) return;
  target.innerHTML = state.comparisonSymbols.map((symbol) => `<button type="button" class="active" data-symbol="${symbol}">${symbol} x</button>`).join("");
  $$("#compareControls button").forEach((button) => button.addEventListener("click", async () => {
    removeComparisonSymbol(button.dataset.symbol);
    await renderComparison();
  }));
}

function toggleWatchlist(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return;
  state.watchlist = state.watchlist.includes(normalized)
    ? state.watchlist.filter((item) => item !== normalized)
    : [normalized, ...state.watchlist].slice(0, 12);
  writeStoredList("aurexWatchlist", state.watchlist);
  if (state.selectedAsset) renderAsset(state.selectedAsset);
}

async function renderWatchlist() {
  const panel = $("#watchlistPanel");
  if (!panel) return;
  $("#watchlistCount").textContent = `${state.watchlist.length} asset${state.watchlist.length === 1 ? "" : "s"}`;
  if (!state.watchlist.length) {
    panel.innerHTML = `<div class="side-empty">Add assets from the analysis page.</div>`;
    return;
  }
  panel.innerHTML = `<div class="side-empty">Updating watchlist...</div>`;
  const assets = await marketApi.assets(state.watchlist).catch(() => []);
  panel.innerHTML = state.watchlist.map((symbol) => {
    const asset = assets.find((item) => item.symbol === symbol);
    const score = asset ? scoreAsset(asset) : null;
    return `
      <button type="button" class="side-asset" data-symbol="${symbol}">
        <span><strong>${symbol}</strong><small>${asset ? `${money(asset.price, asset.currency)} / ${formatDailyMove(asset)}` : "Temporarily unavailable"}</small></span>
        <em>${score ? `${score.verdict} / DQ ${score.dataQuality.score}` : "Open"}</em>
      </button>
    `;
  }).join("");
  $$("#watchlistPanel .side-asset").forEach((button) => {
    button.addEventListener("click", () => loadAsset(button.dataset.symbol));
  });
}

function rememberAsset(asset) {
  const entry = {
    symbol: asset.symbol,
    name: asset.name,
    price: asset.price,
    currency: asset.currency,
    verdict: scoreAsset(asset).verdict,
    timestamp: new Date().toISOString()
  };
  state.recentlyViewed = [entry, ...state.recentlyViewed.filter((item) => item.symbol !== asset.symbol)].slice(0, 8);
  writeStoredList("aurexRecentAssets", state.recentlyViewed);
}

function renderRecentlyViewed() {
  const panel = $("#recentPanel");
  if (!panel) return;
  if (!state.recentlyViewed.length) {
    panel.innerHTML = `<div class="side-empty">Analyzed assets will appear here.</div>`;
    return;
  }
  panel.innerHTML = state.recentlyViewed.map((item) => `
    <button type="button" class="side-asset" data-symbol="${item.symbol}">
      <span><strong>${item.symbol}</strong><small>${item.name || item.symbol} / ${money(item.price, item.currency)}</small></span>
      <em>${item.verdict} / ${displayDate(item.timestamp)}</em>
    </button>
  `).join("");
  $$("#recentPanel .side-asset").forEach((button) => {
    button.addEventListener("click", () => loadAsset(button.dataset.symbol));
  });
}

function setupDashboardEvents() {
  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      showTab(button.dataset.tab);
      if (button.dataset.tab === "comparison") await renderComparison();
      if (button.dataset.tab === "portfolio") await renderPortfolio();
    });
  });

  $("#refreshButton").addEventListener("click", refreshDashboardData);
  $("#beginnerToggle").addEventListener("input", () => {
    state.beginnerMode = $("#beginnerToggle").checked;
    localStorage.setItem("aurexBeginnerMode", String(state.beginnerMode));
    if (state.selectedAsset) renderAsset(state.selectedAsset);
  });
  $("#watchlistToggle").addEventListener("click", () => toggleWatchlist(state.selectedSymbol));
  $$("[data-tab-jump]").forEach((button) => {
    button.addEventListener("click", async () => {
      addComparisonSymbol(state.selectedSymbol);
      showTab(button.dataset.tabJump);
      await renderComparison();
    });
  });
  $$("#timeframeControls button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.chartTimeframe = button.dataset.timeframe;
      $$("#timeframeControls button").forEach((item) => item.classList.toggle("active", item === button));
      if (state.selectedAsset) renderAsset(state.selectedAsset);
    });
  });
  $("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });

  let searchTimer;
  ["assetSearch", "assetTypeFilter", "sectorFilter", "exchangeFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 350);
    });
  });

  $("#holdingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const symbol = normalizeSymbol($("#holdingTicker").value);
    if (!symbol) return;
    const asset = await marketApi.asset(symbol).catch(() => null);
    const purchasePrice = Number($("#holdingPrice").value) || asset?.price || 0;
    state.portfolio.holdings.push({
      symbol,
      shares: Number($("#holdingShares").value) || 0,
      purchasePrice
    });
    $("#holdingTicker").value = "";
    $("#holdingPrice").value = "";
    await renderPortfolio(true);
  });

  ["startingCash", "riskTolerance", "investmentHorizon", "maxAllocation", "sectorPreferences"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => renderPortfolio());
  });
  ["tradeDollars", "tradeShares", "tradePercent"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (state.selectedAsset) renderTradeImpact(state.selectedAsset);
    });
  });
}

function wireThemeToggle() {
  $("#themeToggle")?.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("aurexTheme", document.body.classList.contains("dark") ? "dark" : "light");
    if (document.body.dataset.page === "app") {
      if (state.selectedAsset) renderAsset(state.selectedAsset);
      renderComparison();
      renderPortfolio();
    }
  });
}

function applySavedTheme() {
  if (localStorage.getItem("aurexTheme") === "dark") document.body.classList.add("dark");
}

function renderQuickPicks() {
  $("#quickPicks").innerHTML = EXAMPLE_ASSETS.slice(0, 18).map((symbol) => `<button type="button" data-symbol="${symbol}">${symbol}</button>`).join("");
  $$("#quickPicks button").forEach((button) => button.addEventListener("click", async () => loadAsset(button.dataset.symbol)));
  $("#symbolList").innerHTML = EXAMPLE_ASSETS.map((symbol) => `<option value="${symbol}"></option>`).join("");
}

if (document.body.dataset.page === "home") {
  bootHome();
} else {
  bootDashboard();
}
