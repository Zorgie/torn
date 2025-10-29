const BASE_URL = window.location.href;

// API key section
const apiKeyInput = document.getElementById("api-key-input");
const API_KEY_STORAGE_KEY = "torn_api_key";
const USER_ID_STORAGE_KEY = "torn_user_id";
const SECRET_STORAGE_KEY = "torn_secret";

const dataListContainer = document.getElementById("data-list-container");
const recentTimestampOutput = document.getElementById(
  "recent-timestamp-output"
);
const fetchRecentBtn = document.getElementById("fetch-recent-btn");
const refreshDataBtn = document.getElementById("refresh-data-btn");
const syncDataBtn = document.getElementById("sync-data-btn");
const userIdInput = document.getElementById("user-id-input");
const secretInput = document.getElementById("secret-input");

// Monkey-patch global fetch so requests to our backend (BASE_URL) include the stored User ID and Secret
const _originalFetch = window.fetch.bind(window);
window.fetch = async function(input, init = {}) {
  try {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  // Only attach headers to backend (same origin) requests — do NOT attach to Torn API calls
  const backendOrigin = window.location.origin || BASE_URL.replace(/\/$/, '');
  const isBackendRequest = url && (url.startsWith(BASE_URL) || url.startsWith(backendOrigin) || url.startsWith(backendOrigin + '/'));
  if (isBackendRequest) {
      const userId = localStorage.getItem(USER_ID_STORAGE_KEY);
      const secret = localStorage.getItem(SECRET_STORAGE_KEY);

      // Merge headers, preserving any passed headers
      const merged = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      if (userId) merged.set('X-User-Id', userId);
      if (secret) merged.set('X-Secret', secret);

      // If input is a Request object, create a new Request so headers are applied
      if (typeof input !== 'string' && input instanceof Request) {
        const newReq = new Request(input, { headers: merged });
        return _originalFetch(newReq, init);
      }

      // Otherwise, pass the merged headers via init
      const newInit = Object.assign({}, init, { headers: merged });
      return _originalFetch(input, newInit);
    }
  } catch (err) {
    // If our header-attach logic fails, fall back to original fetch
    console.warn('fetch wrapper error', err);
  }
  return _originalFetch(input, init);
};

// Item search selectors
const searchItemDataBtn = document.getElementById("search-item-btn");
const searchNameInput = document.getElementById("search-name-input");
const searchResultsBody = document.getElementById("search-results-body");

// Undercut UI selectors
const findUndercutsBtn = document.getElementById("find-undercuts-btn");
const undercutResultsBody = document.getElementById("undercut-results-body");
const undercutStatus = document.getElementById("undercut-status");

// Daily summary selectors
const dailyDateInput = document.getElementById("daily-date-input");
const generateSummaryBtn = document.getElementById("generate-summary-btn");
const summaryResultsBody = document.getElementById("summary-results-body");
const profitOnlyCheckbox = document.getElementById("profit-only-checkbox");
const dateTodayBtn = document.getElementById("date-today-btn");
const date3DaysBtn = document.getElementById("date-3days-btn");
const date7DaysBtn = document.getElementById("date-7days-btn");

// Price History Chart selectors
const priceHistoryItemInput = document.getElementById("price-history-item-input");
const priceHistoryStartDate = document.getElementById("price-history-start-date");
const priceHistoryEndDate = document.getElementById("price-history-end-date");
const fetchPriceHistoryBtn = document.getElementById("fetch-price-history-btn");
const priceHistoryStatus = document.getElementById("price-history-status");
const priceHistoryChart = document.getElementById("price-history-chart");
let priceHistoryChartInstance = null;

// Item profit section
const profitItemInput = document.getElementById("profit-item-input");
const profitStartDate = document.getElementById("profit-start-date");
const profitEndDate = document.getElementById("profit-end-date");
const fetchItemProfitBtn = document.getElementById("fetch-item-profit-btn");
const itemProfitChartCanvas = document.getElementById("item-profit-chart");
const itemProfitStatus = document.getElementById("item-profit-status");
const itemProfitTotal = document.getElementById("item-profit-total");
let itemProfitChartInstance = null;

// Halloween report selectors
const halloweenStartInput = document.getElementById("halloween-start");
const halloweenEndInput = document.getElementById("halloween-end");
const halloweenGenerateBtn = document.getElementById("halloween-generate-btn");
const halloweenStatus = document.getElementById("halloween-status");
const halloweenResultsBody = document.getElementById("halloween-results-body");

// Add global items store and storage key
let items = {}; // will hold the items JSON (id -> {name,...})
const ITEMS_STORAGE_KEY = "torn_items_v1";
const ITEMS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days TTL (optional)

// --- Utility Functions ---

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<span class="font-semibold">Error:</span> ${message}`;
    element.classList.remove("text-green-700", "bg-green-50");
    element.classList.add("text-red-700", "bg-red-100");
  }
}

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<span class="font-semibold">Error:</span> ${message}`;
    element.classList.remove("text-green-700", "bg-green-50");
    element.classList.add("text-red-700", "bg-red-100");
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Formats a Date object into a YYYY-MM-DD string.
 * @param {Date} date
 * @returns {string} Formatted date string.
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Gets a comma-separated string of dates from today going back N days (including today).
 * @param {number} numberOfDays - The total number of days to include (e.g., 3 for today, yesterday, day before).
 * @returns {string} Comma-separated date string (YYYY-MM-DD, YYYY-MM-DD).
 */
function getDates(numberOfDays) {
  const dates = [];
  for (let i = 0; i < numberOfDays; i++) {
    const date = new Date();
    // Set the date back i days
    date.setDate(date.getDate() - i);
    dates.push(formatDate(date));
  }
  return dates.join(", ");
}

/**
 * Sets a default 7-day range for the new section
 * @param {number} days - Number of days to look back.
 */
function setDefaultProfitDateRange(days = 7) {
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - (days - 1));
  profitEndDate.value = formatDate(today);
  profitStartDate.value = formatDate(past);
}

/**
 * Formats a Date object into a YYYY-MM-DD string.
 * @param {Date} date
 * @returns {string} Formatted date string.
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Gets a comma-separated string of dates from today going back N days (including today).
 * @param {number} numberOfDays - The total number of days to include (e.g., 3 for today, yesterday, day before).
 * @returns {string} Comma-separated date string (YYYY-MM-DD, YYYY-MM-DD).
 */
function getDates(numberOfDays) {
  const dates = [];
  for (let i = 0; i < numberOfDays; i++) {
    const date = new Date();
    // Set the date back i days
    date.setDate(date.getDate() - i);
    dates.push(formatDate(date));
  }
  return dates.join(", ");
}

// --- API Call Handlers ---

async function fetchMostRecentTimestamp() {
  recentTimestampOutput.textContent = "Fetching...";
  recentTimestampOutput.classList.remove("text-red-700", "bg-red-100");
  recentTimestampOutput.classList.add("text-green-700", "bg-green-50");

  try {
    const response = await fetch(`${BASE_URL}/most_recent`);
    if (!response.ok) {
      throw new Error(`HTTP Status: ${response.status}`);
    }
    const data = await response.json();

    const timestamp = data.most_recent_timestamp;
    if (timestamp !== null) {
      // Format the UNIX timestamp for better readability
      const date = new Date(timestamp * 1000);
      recentTimestampOutput.textContent = `${date.toLocaleString()}`;
    } else {
      recentTimestampOutput.textContent = "No trade data found in database.";
    }
  } catch (error) {
    showError(
      "recent-timestamp-output",
      `Failed to fetch timestamp: ${error.message}`
    );
  }
}

// --- Rendering Functions ---
function renderSearchResults(results) {
  if (results.length === 0) {
    searchResultsBody.innerHTML =
      '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-300">No trades found for this item.</td></tr>';
    return;
  }

  searchResultsBody.innerHTML = results
    .map((trade) => {
      const formattedPrice = formatCurrency(trade.price);
      return `
        <tr>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">${formattedPrice}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${trade.amount}</td>
        </tr>
      `;
    })
    .join("");
}

function renderDailySummaryResults(summary) {
  const displayProfitOnly = profitOnlyCheckbox.checked;
  if (summary.length === 0) {
    summaryResultsBody.innerHTML =
      '<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-gray-500">No summary data found for the selected dates.</td></tr>';
    return;
  }

  // Filter for profit only if checkbox is checked
  summary = summary.filter(row => !displayProfitOnly || row.profit > 0);

  // Calculate Totals for relevant columns
  const totals = summary.reduce(
    (acc, row) => {
      acc.totalBuyCount += parseInt(row["buyCount"]);
      acc.totalSellCount += parseInt(row["sellCount"]);
      acc.totalProfit += parseInt(row.profit);
      return acc;
    },
    { totalBuyCount: 0, totalSellCount: 0, totalProfit: 0 }
  );

  // Map detail rows to HTML
  const detailRows = summary
    .map(
      (row) => {
        // Look up item name from local items data
        const itemName = items[row.itemId]?.name || `Unknown Item (${row.itemId})`;
        
        return `
          <tr>
              <td class="px-2 py-2 whitespace-nowrap text-sm font-medium text-gray-200">${itemName}</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${
                row["isodate"] ?? "-"
              }</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${
                row["buyCount"]
              }</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm text-green-600">${formatCurrency(
                row["avgBuyPrice"]
              )}</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${
                row["sellCount"]
              }</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm text-red-600">${formatCurrency(
                row["avgSellPrice"]
              )}</td>
              <td class="px-2 py-2 whitespace-nowrap text-sm font-bold text-indigo-400">${formatCurrency(
                row.profit
              )}</td>
          </tr>
        `;
      }
    )
    .join("");

  // Create Total Row HTML
  const totalRow = `
      <tr class="bg-indigo-50 font-extrabold border-t-2 border-indigo-500">
          <td class="px-2 py-2 whitespace-nowrap text-base text-indigo-800" colspan="2">TOTALS</td>
          <td class="px-2 py-2 whitespace-nowrap text-base text-gray-700">${
            totals.totalBuyCount
          }</td>
          <td class="px-2 py-2 whitespace-nowrap text-base text-gray-700">--</td>
          <td class="px-2 py-2 whitespace-nowrap text-base text-gray-700">${
            totals.totalSellCount
          }</td>
          <td class="px-2 py-2 whitespace-nowrap text-base text-gray-700">--</td>
          <td class="px-2 py-2 whitespace-nowrap text-base text-indigo-800">${formatCurrency(
            totals.totalProfit
          )}</td>
      </tr>
  `;

  // Combine and render all rows
  summaryResultsBody.innerHTML = detailRows + totalRow;
}

// --- Initialization ---

// Set up event listeners
fetchRecentBtn.addEventListener("click", fetchMostRecentTimestamp);
syncDataBtn.addEventListener("click", syncData);
searchItemDataBtn.addEventListener("click", searchItemData);
generateSummaryBtn.addEventListener("click", generateDailySummary);
findUndercutsBtn.addEventListener("click", findUndercuts);
// Halloween report listener
if (halloweenGenerateBtn) {
  halloweenGenerateBtn.addEventListener("click", fetchHalloweenReport);
}
// NEW: Price history listener
if (fetchPriceHistoryBtn) {
    fetchPriceHistoryBtn.addEventListener("click", fetchPriceHistory);
    // Set default date range (last 30 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    priceHistoryStartDate.value = formatDate(start);
    priceHistoryEndDate.value = formatDate(end);
}

// Set default Halloween report window (UTC times shown as local datetime-local values)
if (halloweenStartInput && halloweenEndInput) {
  halloweenStartInput.value = "2025-10-25T14:00";
  halloweenEndInput.value = "2025-10-31T14:00";
}

async function fetchPriceHistory() {
    const itemName = priceHistoryItemInput.value.trim();
    if (!itemName) {
        priceHistoryStatus.innerText = "Please enter an item name";
        return;
    }

    const startDate = priceHistoryStartDate.value;
    const endDate = priceHistoryEndDate.value;
    if (!startDate || !endDate) {
        priceHistoryStatus.innerText = "Please select both start and end dates";
        return;
    }

    priceHistoryStatus.innerText = "Fetching price history...";

    try {
        const response = await fetch(
            `${BASE_URL}/daily_summary?start_date=${startDate}&end_date=${endDate}`
        );
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        // Get the itemId from the local items data
        const itemId = parseInt(Object.keys(items).find(id => items[id].name.toLowerCase() === itemName.toLowerCase()));

        // Filter for the specific item and prepare chart data
        const itemData = data.filter(row => parseInt(row.itemId) === itemId);
        
        if (itemData.length === 0) {
            priceHistoryStatus.innerText = "No data found for this item in the selected date range";
            return;
        }

        // Sort by date
        itemData.sort((a, b) => new Date(a.isodate) - new Date(b.isodate));

        const chartData = {
            labels: itemData.map(row => row.isodate),
            datasets: [
                {
                    label: 'Buy Price',
                    data: itemData.map(row => row.avgBuyPrice),
                    borderColor: 'rgb(59, 130, 246)', // blue-500
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.1
                },
                {
                    label: 'Sell Price',
                    data: itemData.map(row => row.avgSellPrice),
                    borderColor: 'rgb(34, 197, 94)', // green-500
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    tension: 0.1
                }
            ]
        };

        // Destroy existing chart if it exists
        if (priceHistoryChartInstance) {
            priceHistoryChartInstance.destroy();
        }

        // Create new chart
        priceHistoryChartInstance = new Chart(priceHistoryChart, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: value => formatCurrency(value)
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const label = context.dataset.label || '';
                                const value = formatCurrency(context.parsed.y);
                                return `${label}: ${value}`;
                            }
                        }
                    }
                }
            }
        });

        priceHistoryStatus.innerText = `Showing price history for ${itemName}`;

    } catch (error) {
        console.error('Error:', error);
        priceHistoryStatus.innerText = `Error fetching data: ${error.message}`;
    }
}

// CHART EVENT LISTENER

dateTodayBtn.addEventListener("click", () => {
  dailyDateInput.value = getDates(1);
});

date3DaysBtn.addEventListener("click", () => {
  dailyDateInput.value = getDates(3);
});

date7DaysBtn.addEventListener("click", () => {
  dailyDateInput.value = getDates(7);
});

apiKeyInput.addEventListener("input", function () {
  if (this.value) {
    localStorage.setItem(API_KEY_STORAGE_KEY, this.value);
  }
});

if (userIdInput) {
  userIdInput.addEventListener('input', function() {
    localStorage.setItem(USER_ID_STORAGE_KEY, this.value || '');
  });
}

if (secretInput) {
  secretInput.addEventListener('input', function() {
    localStorage.setItem(SECRET_STORAGE_KEY, this.value || '');
  });
}

// Initial load of data when the page loads
window.onload = () => {
  const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
  }
  // Load saved user id and secret
  try {
    const savedUserId = localStorage.getItem(USER_ID_STORAGE_KEY);
    if (savedUserId && userIdInput) userIdInput.value = savedUserId;
    const savedSecret = localStorage.getItem(SECRET_STORAGE_KEY);
    if (savedSecret && secretInput) secretInput.value = savedSecret;
  } catch (e) {
    // ignore
  }

  // Set default date range for chart and initial data load for other sections
  fetchMostRecentTimestamp();
  
  // Try populate from cache immediately, then refresh in background
  const cached = readCachedItems();
  if (cached) {
    items = cached;
    populateItemDatalist(items);
    // Fetch fresh copy in background
    fetchItems(true).catch((e) =>
      console.warn("Background items refresh failed:", e)
    );
  } else {
    // No cache -> fetch now
    fetchItems().catch((e) => console.warn("Initial items fetch failed:", e));
  }
};

const MARKET_BUY = 1112;
const MARKET_SELL = 1113;
const CATEGORY_MARKET = 11;
const CATEGORY_BAZAAR = 18;
const BAZAAR_BUY = 1225;
const BAZAAR_SELL = 1226;
let queryRes;
let parsedBuy;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMinTimestamp() {
  const minTimestamp = parseInt(document.getElementById("minTimestamp").value);
  if (!minTimestamp) {
    return 0;
  }
  return minTimestamp;
}

function apiKey() {
  return apiKeyInput.value;
}

async function fetchItemMarket(timestamp) {
  if (!timestamp) {
    timestamp = getMinTimestamp();
  }
  const itemMarketBaseUrl =
    "https://api.torn.com/user?selections=log&cat=11&key=" + apiKey();
  queryRes = await fetchPartial([], [], timestamp, itemMarketBaseUrl);
  updateStatus("Fetch complete, ready to parse");
  return queryRes;
}

function updateStatus(status) {
  const statusDiv = document.getElementById("sync-data-output");
  statusDiv.innerText = status;
}

async function fetchBazaar(timestamp) {
  if (!timestamp) {
    timestamp = getMinTimestamp();
  }
  const bazaarUrl = `https://api.torn.com/user?selections=log&cat=${CATEGORY_BAZAAR}&key=${apiKey()}`;
  queryRes = await fetchPartial([], [], timestamp, bazaarUrl);
  updateStatus("Fetch complete, ready to parse");
  return queryRes;
}

async function fetchPartial(
  buyRes,
  sellRes,
  fromTimestamp,
  baseUrl,
  toTimestamp,
  fetchCount
) {
  if (!fetchCount) {
    fetchCount = 0;
  }
  if (!toTimestamp) {
    toTimestamp = Number.MAX_SAFE_INTEGER;
  }
  const fetchUrl = `${baseUrl}&from=${fromTimestamp}&to=${toTimestamp}`;
  updateStatus("fetching: " + fetchCount);
  var res = await fetchWithRateLimit(fetchUrl);
  var jsonRes = await res.json();
  let minToTimestamp = toTimestamp;
  for (const [key, value] of Object.entries(jsonRes.log)) {
    minToTimestamp = Math.min(minToTimestamp, value.timestamp);
    value.logId = key;
    if (value.log === MARKET_BUY || value.log === BAZAAR_BUY) {
      buyRes.push(value);
    } else if (value.log === MARKET_SELL || value.log === BAZAAR_SELL) {
      sellRes.push(value);
    }
  }
  if (Object.entries(jsonRes.log).length === 100) {
    return fetchPartial(
      buyRes,
      sellRes,
      fromTimestamp,
      baseUrl,
      minToTimestamp - 1,
      fetchCount + 1
    );
  } else {
    return { sell: sellRes, buy: buyRes };
  }
}

async function syncData() {
  let res = await fetch(`${BASE_URL}/most_recent`);
  const jsonTimestamp = await res.json();
  const timestamp = jsonTimestamp["most_recent_timestamp"] + 1;

  updateStatus("Fetching market data");
  const marketData = await fetchItemMarket(timestamp);
  const marketDataCount = marketData.buy.length + marketData.sell.length;
  updateStatus("Pushing market data to table");
  await pushToTable(marketData);

  updateStatus("Fetching bazaar data");
  const bazaarData = await fetchBazaar(timestamp);
  const bazaarDataCount = bazaarData.buy.length + bazaarData.sell.length;
  updateStatus("Pushing bazaar data to table");
  await pushToTable(bazaarData);
  updateStatus(
    `Market: ${marketDataCount}, Bazaar: ${bazaarDataCount}`
  );
}

async function pushToTable(items) {
  const data = generateTradeJson(items);
  data["key"] = apiKey();
  // Need to be on the format {'trades': [{id: string, itemId: int, tradeType: string, quantity: int, price: int, timestamp: int}]}
  const response = await fetch(`${BASE_URL}/data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

function generateTradeJson(items) {
  const res = [];
  for (const item of items.buy) {
    res.push(createTradeRequest(item, "BUY"));
  }
  for (const item of items.sell) {
    res.push(createTradeRequest(item, "SELL"));
  }
  return { trades: res };
}

function createTradeRequest(item, type) {
  const itemData = item.data;
  return {
    id: item.logId,
    itemId: itemData.items[0].id,
    tradeType: type,
    quantity: itemData.items[0].qty,
    price: itemData.cost_each,
    timestamp: item.timestamp,
  };
}

// Helper to truncate long text with ellipses
function ellipsize(text, maxLen = 60) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).trim() + "...";
}

// Populate datalist element for item name autocomplete.
// Accepts either the items object returned by the Torn API (id -> itemObj)
// or an array of names.
// Now includes market_value and truncated description in the option value
function populateItemDatalist(itemsObjOrArray) {
  if (!dataListContainer) return;
  // Clear previous options
  dataListContainer.innerHTML = "";

  const fragment = document.createDocumentFragment();

  if (Array.isArray(itemsObjOrArray)) {
    for (const name of itemsObjOrArray) {
      const opt = document.createElement("option");
      opt.value = name; // simple names
      fragment.appendChild(opt);
    }
  } else if (itemsObjOrArray && typeof itemsObjOrArray === "object") {
    // Expect object keyed by id with { name, market_value, description, ... } entries
    for (const [id, itemObj] of Object.entries(itemsObjOrArray)) {
      const name = (itemObj.name || itemObj.item || itemObj.title || "").trim();
      if (!name) continue;
      const marketVal = itemObj.market_value != null ? formatCurrency(itemObj.market_value) : "";
      const desc = ellipsize(itemObj.description || "", 80);

      const inputValue = name;
      // label shown in the dropdown (browsers that support it) includes the description
      const dropdownLabel = desc ? `${inputValue} - ${marketVal} — ${desc}` : inputValue;

      const opt = document.createElement("option");
      opt.value = inputValue;
      // prefer label for richer dropdown display; provide title as tooltip fallback
      opt.label = dropdownLabel;
      opt.title = dropdownLabel;
      opt.dataset.itemId = id;
      fragment.appendChild(opt);
    }
  }

  dataListContainer.appendChild(fragment);
}

// Helper to read cached items with optional TTL metadata
function readCachedItems() {
  try {
    const raw = localStorage.getItem(ITEMS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    // Optional TTL check
    if (parsed.ts && Date.now() - parsed.ts > ITEMS_CACHE_TTL_MS) {
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.warn("Failed to read cached items:", e);
    return null;
  }
}

// Helper to write items to cache with timestamp
function writeCachedItems(data) {
  try {
    localStorage.setItem(
      ITEMS_STORAGE_KEY,
      JSON.stringify({
        ts: Date.now(),
        data,
      })
    );
  } catch (e) {
    console.warn("Failed to write cached items:", e);
  }
}

// Fetches all the different item types for local db storage
async function fetchItems(forceRefresh = false) {
  updateStatus("Fetching items");

  // Try cache first unless forced
  if (!forceRefresh) {
    const cached = readCachedItems();
    if (cached) {
      items = cached;
      populateItemDatalist(items);
      updateStatus("Loaded items from cache");
      // Still refresh in background (non-blocking)
      fetchItems(true).catch((e) =>
        console.warn("Background refresh of items failed:", e)
      );
      return;
    }
  }
  updateStatus("Fetching items from Torn API");
  const fetchItemsUrl = `https://api.torn.com/torn/?selections=items&key=${apiKey()}`;
  const res = await fetchWithRateLimit(fetchItemsUrl);
  const jsonRes = await res.json();
  // Torn returns { items: { id: { name, ... }, ... } } - accept either shape
  items = jsonRes.items || jsonRes || {};
  // cache and populate datalist so autocomplete works immediately next time
  writeCachedItems(items);
  populateItemDatalist(items);
  updateStatus("Items fetched and cached");
}

// --- Halloween report: fetch faction members and outgoing attacks (paginated) ---
async function fetchFactionMembers() {
  if (!apiKey()) throw new Error("API key required");
  const url = `https://api.torn.com/v2/faction/members?striptags=true&key=${apiKey()}`;
  const res = await fetchWithRateLimit(url);
  if (!res.ok) throw new Error(`Faction members fetch failed: ${res.status}`);
  const json = await res.json();
  const members = json.members || json || {};
  const idToName = {};
  for (const member of members) {
    // obj may contain { name, level, ... }
    idToName[member.id] = member.name
  }
  return idToName;
}

async function fetchFactionAttacksPaginated(fromTs, toTs) {
  if (!apiKey()) throw new Error("API key required");
  let all = [];
  let toParam = toTs;
  while (true) {
    let url = `https://api.torn.com/v2/faction/attacksfull?filters=outgoing&limit=1000&sort=DESC&key=${apiKey()}`;
    if (fromTs) url += `&from=${fromTs}`;
    if (toParam) url += `&to=${toParam}`;
    halloweenStatus && (halloweenStatus.innerText = `Fetching attacks — fetched ${all.length}`);
    const res = await fetchWithRateLimit(url);
    if (!res.ok) throw new Error(`Attacks fetch failed: ${res.status}`);
    const json = await res.json();

    // Normalize to an array of attacks
    let chunk = json.attacks;

    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk);

    if (chunk.length < 1000) break;

    // Find minimum timestamp in this chunk to page
    let minTs = Number.MAX_SAFE_INTEGER;
    for (const a of chunk) {
      const timestamp = Number(a.ended);
      if (!Number.isNaN(timestamp)) minTs = Math.min(minTs, timestamp);
    }
    if (minTs === Number.MAX_SAFE_INTEGER) break;
    toParam = minTs - 1;
  }
  return all;
}

async function fetchHalloweenReport() {
  if (!apiKey()) {
    halloweenStatus && (halloweenStatus.innerText = "Set an API key first.");
    return;
  }

  try {
    halloweenStatus && (halloweenStatus.innerText = "Fetching faction members...");
    const members = await fetchFactionMembers(); // id -> name

    // parse date inputs (datetime-local -> epoch seconds)
    const fromVal = halloweenStartInput && halloweenStartInput.value;
    const toVal = halloweenEndInput && halloweenEndInput.value;
    const fromTs = fromVal ? Math.floor(new Date(fromVal).getTime() / 1000) : null;
    const toTs = toVal ? Math.floor(new Date(toVal).getTime() / 1000) : null;

    halloweenStatus && (halloweenStatus.innerText = "Fetching faction attacks (this may take a while)...");
    const attacks = await fetchFactionAttacksPaginated(fromTs, toTs);

    halloweenStatus && (halloweenStatus.innerText = `Fetched ${attacks.length} attacks — aggregating by attacker...`);

    // Aggregate attacks per attacker
    const byAttacker = {};
    let milsoulAttacks = 0;
    for (const atk of attacks) {
      const defender = atk.defender;
      if (defender.id === 3170298) {// Milsoul
        milsoulAttacks += 1;
      }
      const rawAttacker = parseInt(atk.attacker.id);
      let key = rawAttacker;
      // if key is not numeric, try to resolve by name
      let displayName = members[key] || key;

      const ts = atk.ended || 0;
      if (!byAttacker[key]) byAttacker[key] = { name: displayName || `#${key}`, count: 0, respect: 0.0, firstTs: ts, lastTs: ts };
      byAttacker[key].count += 1;
      byAttacker[key].respect += parseFloat(atk.respect_gain || 0);
      if (ts && ts < byAttacker[key].firstTs) byAttacker[key].firstTs = ts;
      if (ts && ts > byAttacker[key].lastTs) byAttacker[key].lastTs = ts;
    }

    const rows = Object.values(byAttacker).sort((a, b) => b.count - a.count);
    renderHalloweenResults(rows, milsoulAttacks);
    halloweenStatus && (halloweenStatus.innerText = `Report ready - ${rows.length} players.`);
  } catch (e) {
    console.error(e);
    halloweenStatus && (halloweenStatus.innerText = `Error: ${e.message}`);
    halloweenResultsBody && (halloweenResultsBody.innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-red-400">${e.message}</td></tr>`);
  }
}

function renderHalloweenResults(rows, milsoulAttacks) {
  if (!halloweenResultsBody) return;
  halloweenResultsBody.innerHTML = "";
  if (!rows || rows.length === 0) {
    halloweenResultsBody.innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-gray-500">No attacks found in the selected window.</td></tr>`;
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.className = 'px-3 py-2'; tdName.textContent = r.name || 'Unknown';
    const tdCount = document.createElement('td'); tdCount.className = 'px-3 py-2'; tdCount.textContent = String(r.count);
    const tdRespect = document.createElement('td'); tdRespect.className = 'px-3 py-2'; tdRespect.textContent = parseInt(r.respect);
    tr.appendChild(tdName); tr.appendChild(tdCount); tr.appendChild(tdRespect);
    halloweenResultsBody.appendChild(tr);
  }
  // Append milsoul attacks
  const milsoulRow = document.createElement('tr');
  const milsoulTd = document.createElement('td'); milsoulTd.className = 'px-3 py-2 font-bold text-red-400'; milsoulTd.textContent = 'Milsoul Killed ';
  const milsoulCountTd = document.createElement('td'); milsoulCountTd.className = 'px-3 py-2 font-bold text-red-400'; milsoulCountTd.textContent = String(milsoulAttacks);
  const milsoulEmpty1 = document.createElement('td'); milsoulEmpty1.className = 'px-3 py-2'; milsoulEmpty1.textContent = '-';
  milsoulRow.appendChild(milsoulTd); milsoulRow.appendChild(milsoulCountTd); milsoulRow.appendChild(milsoulEmpty1);
  halloweenResultsBody.appendChild(milsoulRow);
}

async function searchItemData() {
  const rawInput = searchNameInput.value.trim();
  if (!rawInput) {
    searchResultsBody.innerHTML =
      '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Please enter an item name.</td></tr>';
    return;
  }

  // If the input is a composite value produced by the datalist (e.g. "Hammer — $30 — A small..."),
  // extract the actual item name before doing lookups.
  const candidateName = rawInput.split("—")[0].trim();
  const lookupName = candidateName.toLowerCase();

  searchResultsBody.innerHTML =
    '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-blue-400 animate-pulse">Searching for trades...</td></tr>';

  try {
    // Try to resolve itemId from cached items first
    let itemId = null;

    if (items && typeof items === "object" && Object.keys(items).length > 0) {
      // Try exact name match (case-insensitive)
      for (const [id, obj] of Object.entries(items)) {
        const name = (obj.name || obj.item || obj.title || "").toLowerCase();
        if (name === lookupName) {
          itemId = id;
          break;
        }
      }

      // If no exact match, try substring match
      if (!itemId) {
        for (const [id, obj] of Object.entries(items)) {
          const name = (obj.name || obj.item || obj.title || "").toLowerCase();
          if (name.includes(lookupName)) {
            itemId = id;
            break;
          }
        }
      }
    }

    // Fallback to server lookup if not found in cache
    if (!itemId) {
      const itemIdResponse = await fetch(
        `${BASE_URL}/item_data/${encodeURIComponent(lookupName)}`
      );
      if (!itemIdResponse.ok) {
        throw new Error(`HTTP Status: ${itemIdResponse.status}`);
      }
      const itemIdJson = await itemIdResponse.json();
      itemId = itemIdJson[lookupName];
    }

    if (!itemId) {
      searchResultsBody.innerHTML = 
        `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-400">Item "${candidateName}" not found in cache or server.</td></tr>`;
      return;
    }

    // Fetch market listings using the resolved itemId
    const itemMarketResponse = await fetchWithRateLimit(
      `https://api.torn.com/v2/market/${itemId}/itemmarket?limit=20&offset=0&key=${apiKey()}`
    );
    if (!itemMarketResponse.ok) {
      throw new Error(`HTTP Status: ${itemMarketResponse.status}`);
    }
    const itemMarketJson = await itemMarketResponse.json();
    const listings = itemMarketJson?.itemmarket?.listings || [];
    renderSearchResults(listings);
  } catch (error) {
    searchResultsBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Search failed: ${error.message}. Check your server logs.</td></tr>`;
  }
}

async function generateDailySummary() {
  const rawDates = dailyDateInput.value.trim();

  let datesArray;
  // Convert comma-separated string into an array of trimmed date strings

  if (rawDates) {
    datesArray = rawDates
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d);
  }

  summaryResultsBody.innerHTML =
    '<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-blue-400 animate-pulse">Generating summary...</td></tr>';

  try {
    const response = datesArray
      ? await fetch(`${BASE_URL}/daily_summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates: datesArray }),
        })
      : await fetch(`${BASE_URL}/total_summary`);

    if (!response.ok) {
      throw new Error(`HTTP Status: ${response.status}`);
    }

    const summaryData = await response.json();
    renderDailySummaryResults(summaryData);
  } catch (error) {
    summaryResultsBody.innerHTML = `<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-red-500">Summary failed: ${error.message}. Check server logs.</td></tr>`;
  }
}

// --- New functions: fetchMyListings, findUndercuts, renderUndercutResults ---

/**
 * Fetch the current user's itemmarket listings from Torn.
 * Returns an array of listing objects with at least: itemId, price, quantity, id.
 */
async function fetchMyListings() {
  if (!apiKey()) throw new Error("API key required");
  const url = `https://api.torn.com/v2/user/itemmarket?key=${apiKey()}`;

  const res = await fetchWithRateLimit(url);
  if (!res.ok) throw new Error(`User itemmarket fetch failed: ${res.status}`);
  const json = await res.json();

  // Response shapes vary; try common shapes defensively:
  // - json.itemmarket?.listings (array)
  // - json.itemmarket?.items (object keyed by item id)
  // - json.itemmarket (maybe already array)
  // We'll normalize to an array of { itemId, price, quantity, listingId }.
  const listings = [];

  const im = json.itemmarket;
  if (im) {
    for (const l of im) {
      listings.push({
        itemId: l.item.id,
        price: l.price || 0,
        quantity: l.amount,
        id: l.id,
        itemName: l.item.name,
      });
    }
    return listings;
  }

  // Nothing found
  return listings;
}

/**
 * For each of the user's listings, fetch the public market and collect listings priced below the user's price.
 */
async function findUndercuts() {
  if (!apiKey()) {
    undercutStatus.innerText = "Set an API key first.";
    undercutStatus.classList.add("text-red-500");
    return;
  }

  // Ensure items cache exists (for names)
  if (!items || Object.keys(items).length === 0) {
    undercutStatus.innerText = "Loading item catalog (will be used to resolve names)...";
    try {
      await fetchItems(true);
    } catch (e) {
      console.warn("fetchItems failed:", e);
    }
  }

  undercutStatus.innerText = "Fetching your listings...";
  undercutStatus.classList.remove("text-red-500");
  undercutStatus.classList.add("text-gray-500");
  undercutResultsBody.innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-gray-500 animate-pulse">Scanning your listings...</td></tr>`;

  try {
    const myListings = await fetchMyListings();

    if (!myListings || myListings.length === 0) {
      undercutStatus.innerText = "No marketplace listings found for your account.";
      undercutResultsBody.innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-gray-500">No listings found.</td></tr>`;
      return;
    }

    // For each listing, fetch public market and find undercuts.
    const results = [];
    for (let i = 0; i < myListings.length; i++) {
      const l = myListings[i];
      const itemId = l.itemId || l.itemid || l.item;
      const myPrice = Number(l.price || 0);
      const myQty = Number(l.quantity || 0);
      const myItemName = l.itemName;

      if (!itemId) continue;

      // update short status
      undercutStatus.innerText = `Scanning ${i + 1}/${myListings.length} — ${myItemName} ...`;

      // fetch public market for this item
      const marketUrl = `https://api.torn.com/v2/market/${itemId}/itemmarket?limit=50&key=${apiKey()}`;
      let marketJson = null;
      try {
        const resp = await fetchWithRateLimit(marketUrl);
        if (!resp.ok) throw new Error(resp.status);
        marketJson = await resp.json();
      } catch (e) {
        console.warn(`Failed to fetch market for item ${itemId}:`, e);
        marketJson = null;
      }

      let publicListings = [];
      if (marketJson) {
        // The v2 market endpoint generally returns itemmarket.listings as array
        publicListings = marketJson?.itemmarket?.listings || marketJson?.listings || [];
        // normalize structure
        publicListings = publicListings.map((p) => ({
          price: Number(p.price || p.cost_each || p.cost || 0),
          quantity: Number(p.quantity || p.amount || p.qty || (p.items && p.items[0] && p.items[0].qty) || 0),
          seller_id: p.seller_id || p.seller || p.user || null,
        }));
      }

      // filter undercuts
      const undercuts = publicListings.filter((p) => p.price < myPrice).sort((a,b) => a.price - b.price);

      results.push({
        itemId,
        name: (items && items[itemId] && items[itemId].name) || `ID ${itemId}`,
        myPrice,
        myQty,
        undercuts,
      });

      // small delay to be network-friendly
      await sleep(150);
    }

    renderUndercutResults(results);
    undercutStatus.innerText = `Scan complete — ${results.length} listings scanned.`;
    undercutStatus.classList.remove("text-gray-500");
    undercutStatus.classList.add("text-green-700");
  } catch (err) {
    console.error("findUndercuts error:", err);
    undercutStatus.innerText = `Undercut scan failed: ${err.message}`;
    undercutStatus.classList.remove("text-gray-500");
    undercutStatus.classList.add("text-red-500");
    undercutResultsBody.innerHTML = `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-red-500">Scan failed. See console for details.</td></tr>`;
  }
}

/**
 * Render results array with expandable undercut lists
 * [{ itemId, name, myPrice, myQty, undercuts: [{price, quantity, seller_id}] }]
 */
function renderUndercutResults(results) {
  if (!results || results.length === 0) {
    undercutResultsBody.innerHTML = 
      `<tr><td colspan="4" class="px-3 py-4 text-center text-sm text-gray-300">No listings matched.</td></tr>`;
    return;
  }

  const rows = results
    .map((r, index) => {
      const undercutCount = r.undercuts.length;
      const undercutTotalAmount = r.undercuts.reduce((sum, u) => sum + u.quantity, 0);
      const undercutSummary =
        undercutCount === 0
          ? `<span class="text-sm text-gray-400">None</span>`
          : `<span class="text-sm text-red-400 font-medium">${undercutTotalAmount} items in ${undercutCount} listings</span>`;

      const initialCount = 6;
      const hasMore = r.undercuts.length > initialCount;
      
      // Create details list with expand/collapse functionality
      const details = r.undercuts.length === 0 
        ? "" 
        : `<div class="mt-2 text-xs text-gray-300 space-y-1">
            ${r.undercuts
              .slice(0, initialCount)
              .map(u => `
                <div class="flex justify-between">
                  <span>${formatCurrency(u.price)} — x${u.quantity}</span>
                </div>
              `).join("")}
            
            ${hasMore ? `
              <div class="text-xs text-gray-400 mt-1 cursor-pointer hover:text-blue-400" 
                   onclick="toggleUndercutExpand(${index})" 
                   id="expand-toggle-${index}">
                ▼ Show ${r.undercuts.length - initialCount} more
              </div>
              <div id="expanded-content-${index}" class="hidden space-y-1">
                ${r.undercuts
                  .slice(initialCount)
                  .map(u => `
                    <div class="flex justify-between">
                      <span>${formatCurrency(u.price)} — x${u.quantity}</span>
                    </div>
                  `).join("")}
              </div>` 
            : ""}
           </div>`;

      return `
        <tr>
          <td class="px-3 py-3 align-top font-medium text-gray-200">${r.name}</td>
          <td class="px-3 py-3 align-top text-sm text-gray-300">${formatCurrency(r.myPrice)}</td>
          <td class="px-3 py-3 align-top text-sm text-gray-300">${r.myQty}</td>
          <td class="px-3 py-3 align-top text-sm">${undercutSummary}${details}</td>
        </tr>
      `;
    })
    .join("");

  undercutResultsBody.innerHTML = rows;
}

/**
 * Toggle expanded content visibility for a specific undercut listing
 */
function toggleUndercutExpand(index) {
  const toggle = document.getElementById(`expand-toggle-${index}`);
  const content = document.getElementById(`expanded-content-${index}`);
  
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    toggle.innerHTML = '▲ Show less';
    toggle.classList.add('text-indigo-400');
  } else {
    content.classList.add('hidden');
    toggle.innerHTML = `▼ Show ${content.children.length} more`;
    toggle.classList.remove('text-indigo-400');
  }
}

// Make toggleUndercutExpand available globally
window.toggleUndercutExpand = toggleUndercutExpand;

// Resolve item name to itemId (tries cache then server)
async function resolveItemIdByName(name) {
  const lookupName = name.split("—")[0].trim().toLowerCase();
  if (!lookupName) return null;

  // try cached items
  if (items && typeof items === "object" && Object.keys(items).length > 0) {
    for (const [id, obj] of Object.entries(items)) {
      const n = (obj.name || obj.item || obj.title || "").toLowerCase();
      if (n === lookupName) return id;
    }
    for (const [id, obj] of Object.entries(items)) {
      const n = (obj.name || obj.item || obj.title || "").toLowerCase();
      if (n.includes(lookupName)) return id;
    }
  }

  // fallback to server
  const resp = await fetch(`${BASE_URL}/item_data/${encodeURIComponent(lookupName)}`);
  if (!resp.ok) return null;
  const json = await resp.json();
  return json[lookupName] || null;
}

// Convert YYYY-MM-DD -> DD/MM/YYYY for backend expected format
function toBackendDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function fetchProfitForItem() {
  const rawName = (profitItemInput.value || "").trim();
  let itemId = null;
  if (rawName) {
    try {
      itemId = await resolveItemIdByName(rawName);
    } catch (e) {
      itemId = null;
    }
  }

  itemProfitStatus.textContent = "Resolving item...";
  itemProfitTotal.textContent = "";

  // validate dates
  const start = profitStartDate.value;
  const end = profitEndDate.value;
  if (!start || !end) {
    itemProfitStatus.textContent = "Select both start and end dates.";
    return;
  }

  itemProfitStatus.textContent = "Fetching profit data...";

  const backendStart = toBackendDate(start);
  const backendEnd = toBackendDate(end);

  try {
    const resp = await fetch(`${BASE_URL}/calculate_profit?itemId=${encodeURIComponent(itemId)}&start_date=${encodeURIComponent(backendStart)}&end_date=${encodeURIComponent(backendEnd)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!Array.isArray(data) || data.length === 0) {
      // clear chart if present
      if (itemProfitChartInstance) {
        itemProfitChartInstance.destroy();
        itemProfitChartInstance = null;
      }
      itemProfitStatus.textContent = "No profit records for the selected range.";
      itemProfitTotal.textContent = "";
      return;
    }

    // Aggregate by date (server should already give per-date entries but ensure ordering)
    data.sort((a, b) => a.date.localeCompare(b.date));
    const labels = data.map(r => r.date);
    const values = data.map(r => Number(r.profit) || 0);

    // destroy previous chart instance if any
    if (itemProfitChartInstance) {
      itemProfitChartInstance.destroy();
      itemProfitChartInstance = null;
    }

    itemProfitChartInstance = new Chart(itemProfitChartCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${rawName} — Profit`,
          data: values,
          borderColor: 'rgba(99,102,241,0.95)', // indigo-500
          backgroundColor: 'rgba(99,102,241,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#d1d5db' },
            grid: { color: 'rgba(255,255,255,0.03)' }
          },
          y: {
            ticks: {
              color: '#d1d5db',
              callback: v => formatCurrency(v)
            },
            grid: { color: 'rgba(255,255,255,0.03)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#d1d5db' } },
          tooltip: {
            callbacks: {
              label: ctx => `${formatCurrency(ctx.parsed.y)}`
            }
          }
        }
      }
    });

    const total = values.reduce((s, n) => s + n, 0);
    itemProfitStatus.textContent = "";
    itemProfitTotal.textContent = `TOTAL: ${formatCurrency(total)}`;

  } catch (err) {
    if (itemProfitChartInstance) {
      itemProfitChartInstance.destroy();
      itemProfitChartInstance = null;
    }
    itemProfitStatus.textContent = `Fetch failed: ${err.message}`;
    itemProfitTotal.textContent = "";
  }
}

// wire up listener
if (fetchItemProfitBtn) {
  fetchItemProfitBtn.addEventListener("click", fetchProfitForItem);
}

// ensure default profit date range on load
window.addEventListener("load", () => {
  try { setDefaultProfitDateRange(7); } catch (e) {}
});

// --- Rate-limited fetch wrapper ---
// Maintains a sliding window of request timestamps (ms). If requests in the last 60s exceed thresholds,
// the wrapper delays the fetch: >90 -> 10s delay, >75 -> 1s delay.
const _fetchTimestamps = []; // oldest first

function _cleanupOldTimestamps() {
  const cutoff = Date.now() - 60_000;
  while (_fetchTimestamps.length && _fetchTimestamps[0] < cutoff) {
    _fetchTimestamps.shift();
  }
}

/**
 * Wrapper around global fetch that applies a short delay when request-rate is high.
 * Usage: replace `fetch(...)` with `fetchWithRateLimit(...)` where needed.
 * @param {RequestInfo} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function fetchWithRateLimit(input, init) {
  _cleanupOldTimestamps();
  const recentCount = _fetchTimestamps.length;

  let delayMs = 0;
  if (recentCount > 90) {
    delayMs = 10_000;
  } else if (recentCount > 75) {
    delayMs = 1_000;
  }

  if (delayMs > 0) {
    await new Promise((res) => setTimeout(res, delayMs));
    // after waiting, clean up again to get an updated window
    _cleanupOldTimestamps();
  }

  // record this request timestamp and perform fetch
  _fetchTimestamps.push(Date.now());
  return fetch(input, init);
}
