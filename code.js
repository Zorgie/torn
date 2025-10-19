// The client-side JavaScript uses 'localhost' but will work on your local IP if accessed that way.
const BASE_URL = "http://192.168.2.44:5000";

const dataListContainer = document.getElementById("data-list-container");
const recentTimestampOutput = document.getElementById(
  "recent-timestamp-output"
);
const fetchRecentBtn = document.getElementById("fetch-recent-btn");
const refreshDataBtn = document.getElementById("refresh-data-btn");
const syncDataBtn = document.getElementById("sync-data-btn");

// Item search selectors
const searchItemDataBtn = document.getElementById("search-item-btn");
const searchNameInput = document.getElementById('search-name-input');
const searchResultsBody = document.getElementById('search-results-body');

// Daily summary selectors
const dailyDateInput = document.getElementById('daily-date-input');
const generateSummaryBtn = document.getElementById('generate-summary-btn');
const summaryResultsBody = document.getElementById('summary-results-body');

// --- Utility Functions ---

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<span class="font-semibold">Error:</span> ${message}`;
    element.classList.remove("text-green-700", "bg-green-50");
    element.classList.add("text-red-700", "bg-red-100");
  }
}

// --- Utility Functions ---
function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `<span class="font-semibold">Error:</span> ${message}`;
        element.classList.remove('text-green-700', 'bg-green-50');
        element.classList.add('text-red-700', 'bg-red-100');
    }
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
    }).format(value);
}

// --- API Call Handlers ---

async function fetchAllData() {
  dataListContainer.innerHTML =
    '<p id="data-loading" class="text-center text-indigo-500 animate-pulse">Loading items...</p>';

  try {
    const response = await fetch(`${BASE_URL}/data`);
    if (!response.ok) {
      throw new Error(`HTTP Status: ${response.status}`);
    }
    const items = await response.json();
    renderDataList(items);
  } catch (error) {
    dataListContainer.innerHTML = `<p class="text-red-500 p-4 border border-red-300 bg-red-50 rounded-lg">Failed to load data: ${error.message}. Please ensure the server is running and accessible.</p>`;
  }
}

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
      recentTimestampOutput.textContent = `Latest Timestamp: ${date.toLocaleString()}`;
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

function renderDataList(items) {
  if (items.length === 0) {
    dataListContainer.innerHTML =
      '<p class="text-center text-gray-500 p-4 bg-yellow-50 rounded-lg">The "items" table is empty. Use a POST request to add data.</p>';
    return;
  }

  dataListContainer.innerHTML = items
    .map(
      (item) => `
                <div class="flex justify-between items-center p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <span class="font-medium text-gray-700">ID: ${item.id} | Name: ${item.name}</span>
                    <span class="font-bold text-indigo-600 text-lg">$${item.value}</span>
                </div>
            `
    )
    .join("");
}

// --- Initialization ---

// Set up event listeners
fetchRecentBtn.addEventListener("click", fetchMostRecentTimestamp);
syncDataBtn.addEventListener("click", syncData);
searchItemDataBtn.addEventListener("click", searchItemData);
generateSummaryBtn.addEventListener('click', generateDailySummary); // NEW listener

// Initial load of data when the page loads
window.onload = () => {
  fetchAllData();
  fetchMostRecentTimestamp();
};

const API_KEY = "ZtBwt22hMlryQVKM";
const MARKET_BUY = 1112;
const MARKET_SELL = 1113;
const CATEGORY_MARKET = 11;
const CATEGORY_BAZAAR = 18;
const BAZAAR_BUY = 1225;
const BAZAAR_SELL = 0;
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

async function fetchItemMarket(timestamp) {
  if (!timestamp) {
    timestamp = getMinTimestamp();
  }
  const itemMarketBaseUrl = "https://api.torn.com/user/3960421?selections=log&cat=11&key=" + API_KEY
  queryRes = await fetchPartial([], [], timestamp, itemMarketBaseUrl, Number.MAX_SAFE_INTEGER);
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
  const bazaarUrl = `https://api.torn.com/user/3960421?selections=log&cat=${CATEGORY_BAZAAR}&key=${API_KEY}`;
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
  fetchCount,
) {
  if (!fetchCount) {
    fetchCount = 0;
  }
  const fetchUrl = `${baseUrl}&from=${fromTimestamp}&to=${toTimestamp}`;
  updateStatus("fetching: " + fetchCount);
  var res = await fetch(fetchUrl);
  var jsonRes = await res.json();
  let minToTimestamp = toTimestamp;
  for (const [key, value] of Object.entries(jsonRes.log)) {
    minToTimestamp = Math.min(minToTimestamp, value.timestamp);
    value.logId = key;
    if (value.log === MARKET_BUY) {
      buyRes.push(value);
    } else if (value.log === MARKET_SELL) {
      sellRes.push(value);
    }
  }
  if (Object.entries(jsonRes.log).length === 100) {
    await sleep(600);
    return fetchPartial(
      buyRes,
      sellRes,
      fromTimestamp,
      baseUrl,
      minToTimestamp - 1,
      fetchCount + 1,
    );
  } else {
    return { sell: sellRes, buy: buyRes };
  }
}

async function syncData() {
  let res = await fetch(`${BASE_URL}/most_recent`);
  const jsonTimestamp = await res.json();
  const timestamp = jsonTimestamp["most_recent_timestamp"];

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
    `Pushed ${marketDataCount} new trades from market, ${bazaarDataCount} from bazaar`
  );
}

async function pushToTable(items) {
  const data = generateTradeJson(items);
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

// Fetches all the different item types for local db storage
async function fetchItems() {
  updateStatus("Fetching items");
  const fetchItemsUrl =
    "https://api.torn.com/torn/?selections=items&key=ZtBwt22hMlryQVKM";
  var res = await fetch(fetchItemsUrl);
  var jsonRes = await res.json();
  updateStatus("items fetched");
  items = jsonRes;
}

async function searchItemData() {
    const itemName = searchNameInput.value.trim().toLowerCase();
    if (!itemName) {
        searchResultsBody.innerHTML = '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Please enter an item name.</td></tr>';
        return;
    }

    searchResultsBody.innerHTML = '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-teal-500 animate-pulse">Searching for trades...</td></tr>';

    try {
        // Get the itemId
        const itemIdResponse = await fetch(`${BASE_URL}/item_data/${itemName}`); 
        if (!itemIdResponse.ok) {
            throw new Error(`HTTP Status: ${itemIdResponse.status}`);
        }
        
        // Assuming response data is an array of {Price: number, Quantity: number} objects
        const itemIdJson = await itemIdResponse.json(); 
        const itemId = itemIdJson[itemName]
        const itemMarketResponse = await fetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?limit=20&offset=0&key=${API_KEY}`)
        const itemMarketJson = await itemMarketResponse.json();
        const listings = itemMarketJson["itemmarket"]["listings"];
        renderSearchResults(listings);

    } catch (error) {
        searchResultsBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Search failed: ${error.message}. Check your server logs.</td></tr>`;
    }
}


function renderSearchResults(results) {
    if (results.length === 0) {
        searchResultsBody.innerHTML = '<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">No trades found for this item.</td></tr>';
        return;
    }

    searchResultsBody.innerHTML = results.map(trade => {
        // Format price as dollar value (e.g., $1,234.56)
        const formattedPrice = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
        }).format(trade.price); 
        
        return `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${formattedPrice}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${trade.amount}</td>
            </tr>
        `;
    }).join('');
}

async function generateDailySummary() {
    const rawDates = dailyDateInput.value.trim();
    if (!rawDates) {
        summaryResultsBody.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-red-500">Please enter at least one date.</td></tr>';
        return;
    }

    // Convert comma-separated string into an array of trimmed date strings
    const datesArray = rawDates.split(',').map(d => d.trim()).filter(d => d);

    summaryResultsBody.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-purple-500 animate-pulse">Generating summary...</td></tr>';
    
    try {
        const response = await fetch(`${BASE_URL}/daily_summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dates: datesArray })
        });

        if (!response.ok) {
            throw new Error(`HTTP Status: ${response.status}`);
        }
        
        const summaryData = await response.json(); 
        renderDailySummaryResults(summaryData);

    } catch (error) {
        summaryResultsBody.innerHTML = `<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-red-500">Summary failed: ${error.message}. Check server logs.</td></tr>`;
    }
}

function renderDailySummaryResults(summary) {
    if (summary.length === 0) {
        summaryResultsBody.innerHTML = '<tr><td colspan="7" class="px-2 py-4 text-center text-sm text-gray-500">No summary data found for the selected dates.</td></tr>';
        return;
    }

    summaryResultsBody.innerHTML = summary.map(row => `
        <tr>
            <td class="px-2 py-2 whitespace-nowrap text-sm font-medium text-gray-900">${row["itemName"]}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${row["isodate"]}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${row["buyCount"]}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-green-600">${formatCurrency(row["avgBuyPrice"])}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">${row["sellCount"]}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm text-red-600">${formatCurrency(row["avgSellPrice"])}</td>
            <td class="px-2 py-2 whitespace-nowrap text-sm font-bold text-indigo-700">${formatCurrency(row.profit)}</td>
        </tr>
    `).join('');
}