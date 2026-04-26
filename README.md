# Aurex

Aurex is a live market research and portfolio simulation platform. It combines provider-backed market data, a weighted investment scoring model, news sentiment, side-by-side comparisons, portfolio-aware recommendations, and diversification scoring.

The app intentionally does not invent missing financial data. If a provider does not return a metric, the UI shows `Unavailable` and lowers the analysis confidence where appropriate.

## Routes

- `/` - premium product homepage with a live asset preview
- `/app` - main research dashboard
- `/api/health` - provider and environment status
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

The default mode is `MARKET_PROVIDER=auto`. It chooses a keyed provider when credentials are available, otherwise it falls back to the no-key Yahoo-compatible search/chart plus Stooq delayed quote path.

Environment variables:

```bash
MARKET_PROVIDER=auto
FINNHUB_API_KEY=your_key
ALPHA_VANTAGE_API_KEY=your_key
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
   - `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, or both if available
5. Deploy. Render will provide `PORT`; the server reads it automatically.

## Deployment: Vercel

This repository includes `vercel.json` routing all requests to `server.js`, which exports the HTTP handler for the Node runtime.

1. Import the GitHub repository into Vercel.
2. Keep the default install command unless your account requires a specific package manager.
3. Add environment variables:
   - `MARKET_PROVIDER=auto`
   - `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, or both if available
4. Deploy.

For the most predictable deployment of this plain Node server, Render is the simpler target. Vercel is configured for serverless deployment through the included Node handler.

## Scoring Model

The standalone investment score is weighted:

- Financial strength: 25%
- Valuation: 20%
- Growth: 20%
- Profitability: 15%
- Risk: 10%
- News sentiment: 10%

Verdict thresholds:

- `75-100`: Buy
- `50-74`: Hold
- `0-49`: Sell

Analysis confidence depends on provider coverage for quote, market data, valuation, fundamentals, history, and news. Missing fields lower confidence and are shown to the user.

## Disclaimer

This platform is for educational and informational purposes only. It does not guarantee investment results and should not be treated as professional financial advice. Users should do their own research before making real investment decisions.
