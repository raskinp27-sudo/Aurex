const API_BASE = location.protocol === "file:" ? "http://localhost:4174" : "";
const EXAMPLE_ASSETS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "NFLX", "AMD", "INTC",
  "JPM", "BAC", "V", "MA", "JNJ", "UNH", "LLY", "PFE", "WMT", "COST",
  "KO", "PEP", "XOM", "CVX", "BA", "LMT", "DIS", "NKE", "MCD", "SPY",
  "QQQ", "VTI", "VNQ", "GLD", "BTC-USD", "ETH-USD"
];

const CATEGORY_WEIGHTS = {
  financialStrength: 25,
  valuation: 20,
  growth: 20,
  profitability: 15,
  risk: 10,
  newsSentiment: 10
};

const CONFIDENCE_FIELDS = [
  "price", "previousClose", "volume", "week52High", "week52Low", "marketCap", "peRatio",
  "forwardPe", "priceToBook", "eps", "revenueGrowth", "earningsGrowth", "profitMargin",
  "debtToEquity", "beta", "dividendYield"
];

const state = {
  selectedSymbol: "MSFT",
  selectedAsset: null,
  comparisonSymbols: ["AAPL", "MSFT", "NVDA"],
  cache: new Map(),
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
    throw new Error(body.error || `Request failed with ${response.status}`);
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

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 50;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function scoreAsset(asset) {
  const confidence = analysisConfidence(asset);
  const financialStrength = average([
    asset.debtToEquity !== null ? clamp(100 - asset.debtToEquity * 42) : 50,
    asset.currentRatio !== null ? clamp(asset.currentRatio * 36, 20, 100) : 50,
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
    asset.profitMargin !== null ? clamp(34 + asset.profitMargin * 2.2, 0, 100) : 50
  ]);
  const risk = average([
    asset.beta !== null ? clamp(100 - Math.max(0, asset.beta - 0.75) * 38, 10, 100) : riskFallback(asset) ? clamp(100 - Math.max(0, riskFallback(asset) - 0.75) * 38, 10, 100) : 50,
    asset.debtToEquity !== null ? clamp(95 - asset.debtToEquity * 35, 0, 100) : 50,
    historyRiskScore(asset.history)
  ]);
  const newsSentiment = newsScore(asset.news);
  const overall = Math.round(
    financialStrength * 0.25
    + valuation * 0.2
    + growth * 0.2
    + profitability * 0.15
    + risk * 0.1
    + newsSentiment * 0.1
  );
  const verdict = overall >= 75 ? "Buy" : overall >= 50 ? "Hold" : "Sell";
  const categories = { financialStrength, valuation, growth, profitability, risk, newsSentiment };
  const factors = factorSummary(asset, categories, confidence.missing);
  return { overall, verdict, categories, factors, confidence };
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

function newsScore(news) {
  if (!news || !news.length) return 50;
  return average(news.map((item) => item.sentiment === "positive" ? 82 : item.sentiment === "negative" ? 28 : 55));
}

function analysisConfidence(asset) {
  const missing = CONFIDENCE_FIELDS.filter((field) => asset[field] === null || asset[field] === undefined);
  let available = CONFIDENCE_FIELDS.length - missing.length;
  if (asset.news?.length) available += 1;
  if (asset.history?.length > 30) available += 1;
  if (asset.live) available += 1;
  const denominator = CONFIDENCE_FIELDS.length + 3;
  const ratio = available / denominator;
  const level = ratio >= 0.72 ? "High" : ratio >= 0.45 ? "Medium" : "Low";
  return { level, ratio, missing };
}

function factorSummary(asset, categories, missing) {
  const readable = [
    ["Financial strength", categories.financialStrength, 25],
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

  if (score.categories.financialStrength >= 65) strengths.push("Balance sheet, liquidity, and scale indicators are supportive.");
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
  return `${asset.symbol} is rated ${score.verdict} with a score of ${score.overall}/100 and ${confidenceText}. The main support is ${strongest[0].toLowerCase()} at ${Math.round(strongest[1])}/100. The biggest drag is ${weakest[0].toLowerCase()} at ${Math.round(weakest[1])}/100. ${dataNote}`;
}

function confidenceCopy(score) {
  if (score.confidence.level === "High") return "High confidence: most quote, fundamental, history, and news fields were returned by the provider.";
  if (score.confidence.level === "Medium") return "Medium confidence: enough data was returned for directional analysis, but some important fields were unavailable.";
  return `This verdict has low confidence because several key financial metrics were unavailable: ${score.confidence.missing.slice(0, 8).join(", ") || "provider fields"}.`;
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
  try {
    const health = await loadHealth();
    $("#providerLabel").textContent = health.provider;
    $("#marketState").textContent = `${health.status}. Keys: Finnhub ${health.env.finnhubConfigured ? "configured" : "not set"}, Alpha Vantage ${health.env.alphaVantageConfigured ? "configured" : "not set"}.`;
    $("#dataModeCopy").textContent = `${health.provider} is active. Search and quotes use the provider first; missing fields stay marked Unavailable.`;
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
  $("#assetSource").textContent = `${asset.sourceNote || "Provider details unavailable."}`;
  $("#companyVerdict").textContent = score.verdict;
  $("#companyVerdict").className = `verdict-badge ${score.verdict.toLowerCase()}`;
  $("#confidenceBadge").textContent = `${score.confidence.level} confidence`;
  $("#confidenceBadge").className = `confidence-badge ${score.confidence.level.toLowerCase()}`;
  $("#standaloneScore").textContent = `Score ${score.overall}/100`;
  $("#keyStatsGrid").innerHTML = renderMetricCards(keyStatsRows(asset));
  $("#financialMetricsGrid").innerHTML = renderMetricCards(financialMetricRows(asset));
  $("#missingDataLabel").textContent = score.confidence.missing.length ? `${score.confidence.missing.length} fields unavailable` : "Core fields available";
  $("#verdictExplanation").textContent = verdictExplanation(asset, score);
  $("#confidenceNote").textContent = confidenceCopy(score);
  $("#scoreBars").innerHTML = renderScoreBars(score.categories);
  $("#researchGrid").innerHTML = renderResearchCards(research);
  renderNews(asset);
  drawLineChart($("#priceChart"), asset.history, !isRealNumber(asset.change) || asset.change >= 0 ? "#0f8a5f" : "#c24135", asset.currency);
}

function keyStatsRows(asset) {
  return [
    ["Current price", money(asset.price, asset.currency)],
    ["Daily change", formatDailyMove(asset)],
    ["Previous close", money(asset.previousClose, asset.currency)],
    ["Open", money(asset.open, asset.currency)],
    ["Day range", dayRange(asset)],
    ["52-week range", weekRange(asset)],
    ["Volume", compactNumber(asset.volume)],
    ["Average volume", compactNumber(asset.averageVolume)],
    ["Exchange", asset.exchange || "Unavailable"],
    ["Last updated", displayDate(asset.lastUpdated)]
  ];
}

function financialMetricRows(asset) {
  return [
    ["Market cap", asset.marketCap ? `$${compactNumber(asset.marketCap)}` : "Unavailable"],
    ["P/E ratio", number(asset.peRatio, 2)],
    ["Forward P/E", number(asset.forwardPe, 2)],
    ["Price-to-book", number(asset.priceToBook, 2)],
    ["EPS", money(asset.eps, asset.currency)],
    ["Dividend yield", percent(asset.dividendYield, false)],
    ["Revenue growth", percent(asset.revenueGrowth)],
    ["Earnings growth", percent(asset.earningsGrowth)],
    ["Profit margin", percent(asset.profitMargin, false)],
    ["Debt-to-equity", asset.debtToEquity === null ? "Unavailable" : number(asset.debtToEquity, 2)],
    ["Beta", number(asset.beta, 2)],
    ["Sector / industry", `${asset.sector || "Unavailable"} / ${asset.industry || "Unavailable"}`]
  ];
}

function renderMetricCards(rows) {
  return rows.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function dayRange(asset) {
  if (!isRealNumber(asset.dayLow) || !isRealNumber(asset.dayHigh)) return "Unavailable";
  return `${money(asset.dayLow, asset.currency)} - ${money(asset.dayHigh, asset.currency)}`;
}

function weekRange(asset) {
  if (!isRealNumber(asset.week52Low) || !isRealNumber(asset.week52High)) return "Unavailable";
  return `${money(asset.week52Low, asset.currency)} - ${money(asset.week52High, asset.currency)}`;
}

function formatDailyMove(asset) {
  if (asset.change === null && asset.changePercent === null) return "Daily move unavailable";
  const change = asset.change >= 0 ? `+${money(asset.change, asset.currency)}` : money(asset.change, asset.currency);
  return `${change} (${percent(asset.changePercent)})`;
}

function renderScoreBars(categories) {
  const labels = {
    financialStrength: "Financial strength",
    valuation: "Valuation",
    growth: "Growth",
    profitability: "Profitability",
    risk: "Risk",
    newsSentiment: "News/sentiment"
  };
  return Object.entries(CATEGORY_WEIGHTS).map(([key, weight]) => {
    const value = Math.round(categories[key]);
    return `
      <div class="score-bar">
        <span>${labels[key]} (${weight}%)</span>
        <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
        <strong>${value}/100</strong>
      </div>
    `;
  }).join("");
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
    </article>
  `).join("");
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
    $("#searchMessage").textContent = `${response.results.length} results from ${response.provider}. Live search is primary; fallback metadata is labeled.`;
  } catch (error) {
    $("#searchMessage").textContent = `Search failed: ${error.message}`;
    $("#searchResults").innerHTML = "";
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
      ? `${best.asset.symbol} currently looks strongest with a ${best.score.verdict} verdict, ${best.score.overall}/100 score, and ${best.score.confidence.level.toLowerCase()} confidence. Its edge is ${best.score.factors.strongest[0].toLowerCase()}, while ${second.asset.symbol}'s biggest drag is ${second.score.factors.weakest[0].toLowerCase()}.`
      : `${best.asset.symbol} is selected. Add another asset for a relative conclusion.`;
    $("#comparisonTable").innerHTML = comparisonTable(scored);
    drawComparisonChart($("#comparisonChart"), scored);
    stampUpdate();
  } catch (error) {
    showAlert(`Comparison update failed: ${error.message}`);
  }
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
  const topSectorValue = topSector(holdings, totalValue);
  const sectorScore = clamp(24 - Math.max(0, topSectorValue.percent - 35) * 0.85, 0, 24);
  const typeCount = new Set(holdings.map((holding) => holding.asset.assetType || "Unknown")).size;
  const typeScore = clamp((typeCount / 4) * 12, 0, 12);
  const averageBeta = holdings.length ? holdings.reduce((sum, holding) => sum + (holding.asset.beta ?? riskFallback(holding.asset)), 0) / holdings.length : 1;
  const riskTarget = state.portfolio.riskTolerance === "Conservative" ? 0.85 : state.portfolio.riskTolerance === "Aggressive" ? 1.35 : 1.05;
  const riskScore = clamp(13 - Math.max(0, averageBeta - riskTarget) * 18, 0, 13);
  const overlapScore = clamp(10 - similarHoldingPenalty(holdings), 0, 10);
  const total = Math.round(countScore + positionScore + sectorScore + typeScore + riskScore + overlapScore);
  const suggestions = [];
  if (holdings.length < 8) suggestions.push("Add more holdings to reduce single-position risk.");
  if (topSectorValue.percent > 40) suggestions.push(`Reduce ${topSectorValue.name} concentration or add exposure to other sectors.`);
  if (largest.percent > state.portfolio.maxAllocation) suggestions.push(`${largest.name} exceeds your maximum allocation target.`);
  if (typeCount < 2) suggestions.push("Add asset-type diversity, such as broad-market ETFs or defensive exposure.");
  if (averageBeta > riskTarget + 0.2) suggestions.push("Add lower-beta assets to better match your selected risk tolerance.");
  if (similarHoldingPenalty(holdings) > 3) suggestions.push("Several holdings appear similar by sector or style, which can create hidden overlap.");
  if (!suggestions.length) suggestions.push("Portfolio balance looks reasonable against your current constraints.");
  const riskLabel = averageBeta >= 1.3 ? "Elevated" : averageBeta <= 0.85 ? "Lower" : "Moderate";
  return { total, topSector: topSectorValue, largest, averageBeta, typeCount, suggestions, riskLabel };
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
  $("#scoreExplanation").textContent = `Diversification Score: ${result.total}/100. Your portfolio is ${result.total >= 75 ? "well diversified" : result.total >= 50 ? "moderately diversified" : "concentrated"}, with ${result.topSector.percent.toFixed(1)}% in ${result.topSector.name}, ${result.largest.percent.toFixed(1)}% in ${result.largest.name}, ${result.typeCount} asset type(s), and average beta of ${result.averageBeta.toFixed(2)}.`;
  $("#sectorRiskLabel").textContent = `${result.topSector.name}: ${result.topSector.percent.toFixed(1)}%`;
  $("#positionRiskLabel").textContent = `${result.largest.name}: ${result.largest.percent.toFixed(1)}%`;
  $("#portfolioSuggestions").innerHTML = result.suggestions.map((item) => `<span class="suggestion-pill">${item}</span>`).join("");
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

function drawLineChart(canvas, history, color, currency = "USD") {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  drawChartGrid(ctx, width, height);
  if (!history || history.length < 2) {
    drawCenteredText(ctx, "Price history unavailable");
    return;
  }
  const points = history.slice(-180);
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
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

function setupDashboardEvents() {
  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      showTab(button.dataset.tab);
      if (button.dataset.tab === "comparison") await renderComparison();
      if (button.dataset.tab === "portfolio") await renderPortfolio();
    });
  });

  $("#refreshButton").addEventListener("click", refreshDashboardData);
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
