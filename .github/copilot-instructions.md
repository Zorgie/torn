## Quick orientation (what this project is)

This is a small Flask-backed single-repo utility that stores Torn market trades in a local SQLite DB and serves a small frontend. Key files:

- `app.py` — main Flask application, creates/uses `torn.db` (SQLite). Tables of interest: `MARKET_TRADES`, `ITEM_DATA`, and the `DAILY_SUMMARY` view.
- `index.html` — front-end UI (Tailwind + Chart.js via CDN).
- `code.js` — front-end logic: fetches API endpoints, renders charts/tables, uses localStorage for caching items.

## How to run (developer workflow)

- Install minimal Python deps: Flask and Flask-CORS. The code uses the builtin `sqlite3`.
  - Example (Windows PowerShell):
    python -m pip install --upgrade pip; python -m pip install flask flask-cors
- Start the server (debug mode already set in `app.py` main guard):
    python .\app.py
- Open the frontend at: http://localhost:5000

Notes: `app.py` calls `init_db()` on startup; the DB file is `torn.db` in the repo CWD. No extra build steps are required for the frontend — `index.html` is returned by the root endpoint.

## API surface (useful endpoints & payload shapes)

- GET `/most_recent` → { "most_recent_timestamp": <unix_ts|null> }
- POST `/data` expects JSON: `{ "trades": [ { "id", "itemId", "tradeType", "quantity", "price", "timestamp" }, ... ] }` — inserts into `MARKET_TRADES` using `INSERT OR REPLACE`.
- GET `/daily_summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` → returns `DAILY_SUMMARY` rows.
- POST `/daily_summary` with `{ "dates": ["YYYY-MM-DD", ...] }` returns the same view filtered to those dates.
- GET `/item_data/<itemName>` returns `{ "<itemName>": <itemId|null> }` (case-insensitive match using UPPER in SQL).
- GET `/calculate_profit` supports optional `itemId`, `start_date`, `end_date` query params (date format in `calculate_profit` is `DD/MM/YYYY` when converting to timestamps).

Example: fetch daily summary for Sept 1-7, 2025:
  GET `/daily_summary?start_date=2025-09-01&end_date=2025-09-07`

## Project-specific conventions & gotchas (do not assume defaults)

- Database: SQLite with `check_same_thread=False` in `get_db_connection()` — this avoids thread errors but you should still be careful about concurrent writes. There is no migration tool; schema is created in `init_db()`.
- Frontend serving: `app.py` reads `index.html` and `code.js` from disk and returns them (endpoints `/` and `/code`). The frontend then fetches relative endpoints (BASE_URL uses `window.location.href`), so tests and local dev should use the server host/port directly.
- LocalStorage keys used by `code.js`: `torn_api_key`, `torn_items_v1` (items cache TTL ~7 days). The `datalist` with id `data-list-container` is populated by these items and used across forms.
- Data shape mismatches: `DAILY_SUMMARY` view in `app.py` does not include `itemName` — the frontend sometimes expects `itemName` (e.g., price-history code filters rows by `row.itemName`). When adding features, either augment the SQL view to include `ITEM_DATA.itemName` or update the frontend to map `itemId -> itemName` using local items cache.

## Where to look when changing features

- To modify trade storage / schema: `app.py` (create/insert logic & `init_db`).
- To adapt frontend visuals / controls: `index.html` (markup) and `code.js` (behavior, event handlers: `syncData`, `generateDailySummary`, `fetchPriceHistory`, `fetchMostRecentTimestamp`, etc.).
- To change charts: Chart.js is loaded from CDN in `index.html`; `code.js` builds chart datasets.

## Small examples for contributors

- Add a new trade via curl (example JSON):
  POST to `/data` with body:
  `{ "trades": [{ "id": "1234-1", "itemId": 123, "tradeType": "BUY", "quantity": 2, "price": 125000, "timestamp": 1698518400 }] }`

- Debugging tip: If the frontend shows "No data for this item" but DB contains rows, check `most_recent` and confirm timestamps are present via `sqlite3 torn.db "SELECT COUNT(*) FROM MARKET_TRADES;"`.

## What an AI assistant should prioritize here

1. Preserve the SQLite-first architecture and the simple REST surface — changes should be backward compatible with the current endpoints.
2. When adding server-side fields (e.g., `itemName` on summary rows), update both the SQL/view in `app.py` and the consuming code in `code.js`.
3. Respect localStorage keys and existing UI IDs when editing the frontend — many components look up elements by id (e.g., `fetch-price-history-btn`, `summary-results-body`).

If any of the conventions above are unclear or you want me to expand a section (for example: add quick examples of `syncData` flow or an explicit SQL snippet to include itemName in the DAILY_SUMMARY view), tell me which part and I will iterate.
