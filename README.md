# Aurex

Aurex is a live market research and portfolio simulation platform. It combines provider-backed market data, transparent field sources, data quality scoring, a weighted investment scoring model, news sentiment, side-by-side comparisons, watchlists, recently viewed assets, portfolio-aware recommendations, trade impact simulation, and diversification scoring.

The app intentionally does not invent missing financial data. If a provider does not return a metric, the UI shows `N/A` and lowers the analysis confidence where appropriate.

Each major metric includes a source label, such as `Finnhub`, `Yahoo chart quote`, `Estimated sector benchmark`, or `Unavailable from current provider`. API responses are cached briefly for quotes/search and longer for fundamentals to reduce provider rate limits.

## Routes

- `/` - premium product homepage with a live asset preview
- `/app` - main research dashboard
- `/api/health` - provider and environment status
- `/api/provider-status` - provider health and cache diagnostics
- `/api/search?q=apple` - provider-backed asset search
- `/api/asset/AAPL` - normalized asset quote, fundamentals, history, and news
- `/api/assets?symbols=AAPL,MSFT,NVDA` - batch asset lookup

## Local Development

```bash
npm start
```

Then open:

```text
http://localhost:4174
```

The server uses `process.env.PORT || 4174`, so hosted platforms can provide their own port automatically.

## Check

```bash
npm run check
```

This runs syntax checks for the server and browser controller:

```bash
node --check server.js && node --check app.js
```

## Market Data Providers

The default mode is `MARKET_PROVIDER=auto`. When `FINNHUB_API_KEY` is available, Finnhub supplies the primary quote and first-pass fundamentals. Aurex then fills only missing fields from Yahoo fundamentals and optional keyed providers. Lower-priority providers never replace a valid higher-priority value. Without a Finnhub key, Yahoo-compatible quote, fundamentals, history, and news become the primary path, with Stooq as the final delayed-quote fallback.

Field-level enrichment can combine valuation, profitability, growth, balance-sheet, risk, shareholder, and analyst metrics from different providers in one normalized asset response. Each populated field retains its source. Missing fields include provider attempts and an unavailable reason in `metricDiagnostics`.

Environment variables:

```bash
MARKET_PROVIDER=auto
FINNHUB_API_KEY=your_key
ALPHA_VANTAGE_API_KEY=your_key
FMP_API_KEY=your_key
POLYGON_API_KEY=your_key
TWELVE_DATA_API_KEY=your_key
PORT=4174
```

Supported provider values:

```bash
MARKET_PROVIDER=auto
MARKET_PROVIDER=yahoo
MARKET_PROVIDER=finnhub
MARKET_PROVIDER=alphavantage
```

API keys are read only from environment variables. No keys are hardcoded in the repository.

Use `.env.example` as the environment variable checklist. The app still runs without API keys, but keyed providers generally return deeper fundamentals.

## Deployment: GitHub + Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from the repository.
3. Use:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variables in Render:
- `MARKET_PROVIDER=auto`
- `FINNHUB_API_KEY`, plus optional `ALPHA_VANTAGE_API_KEY`, `FMP_API_KEY`, and `POLYGON_API_KEY`
5. Deploy. Render will provide `PORT`; the server reads it automatically.

## Deployment: Vercel

This repository includes `vercel.json` routing all requests to `server.js`, which exports the HTTP handler for the Node runtime.

1. Import the GitHub repository into Vercel.
2. Keep the default install command unless your account requires a specific package manager.
3. Add environment variables:
   - `MARKET_PROVIDER=auto`
   - `FINNHUB_API_KEY`, plus optional `ALPHA_VANTAGE_API_KEY`, `FMP_API_KEY`, and `POLYGON_API_KEY`
4. Deploy.

For the most predictable deployment of this plain Node server, Render is the simpler target. Vercel is configured for serverless deployment through the included Node handler.

## Scoring Model

The standalone investment score is weighted:

- Balance sheet / financial strength: 25%
- Valuation: 20%
- Growth: 20%
- Profitability: 15%
- Risk: 10%
- News sentiment: 10%

Verdict thresholds:

- `75-100`: Buy
- `50-74`: Hold
- `0-49`: Sell

Data Quality is scored separately from Investment Confidence. Data Quality tracks whether the most important fields are available. Investment Confidence also considers history, news, missing fundamentals, provider reliability, and volatility.

The UI also includes:

- Analyst-style verdict reports with bull case, bear case, main reason, and what could change the verdict
- Valuation and risk interpretation in normal or beginner-friendly language
- 52-week position indicator and educational fair value range
- LocalStorage watchlist and recently viewed assets
- Portfolio trade impact simulator and more detailed diversification scoring

## Disclaimer

This platform is for educational and informational purposes only. It does not guarantee investment results and should not be treated as professional financial advice. Users should do their own research before making real investment decisions.
