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

async function fetchTorn(timestamp) {
  if (!timestamp) {
    timestamp = getMinTimestamp();
  } 
  queryRes = await fetchTornPartial(
    [],
    [],
    timestamp,
    Number.MAX_SAFE_INTEGER
  );
  updateStatus("Fetch complete, ready to parse");
  return queryRes;
}

function updateStatus(status) {
  const statusDiv = document.getElementById("dataStatus");
  statusDiv.innerText = status;
}

async function fetchBazaar(timestamp) {
  if (!timestamp) {
    timestamp = getMinTimestamp();
  } 
  queryRes = await fetchBazaarPartial([], [], timestamp);
  updateStatus("Fetch complete, ready to parse");
  return queryRes;
}

async function fetchBazaarPartial(
  buyRes,
  sellRes,
  fromTimestamp,
  toTimestamp,
  fetchCount
) {
  if (!fetchCount) {
    fetchCount = 0;
  }
  const apiKey = document.getElementById("apiKey").value;
  const fetchItemMarketUrl =
    "https://api.torn.com/user/3960421?selections=log&cat=" +
    CATEGORY_BAZAAR +
    "&key=" +
    API_KEY +
    "&from=" +
    fromTimestamp +
    "&to=" +
    toTimestamp;
  updateStatus("fetching: " + fetchCount);
  var res = await fetch(fetchItemMarketUrl);
  var jsonRes = await res.json();
  let minToTimestamp = toTimestamp;
  for (const [key, value] of Object.entries(jsonRes.log)) {
    minToTimestamp = Math.min(minToTimestamp, value.timestamp);
    value.logId = key;
    if (value.log === BAZAAR_BUY) {
      buyRes.push(value);
    } else if (value.log === BAZAAR_SELL) {
      sellRes.push(value);
    }
  }
  if (Object.entries(jsonRes.log).length === 100) {
    await sleep(600);
    console.log("Sending RPC");
    return fetchBazaarPartial(
      buyRes,
      sellRes,
      fromTimestamp,
      minToTimestamp - 1,
      fetchCount + 1
    );
  } else {
    return { sell: sellRes, buy: buyRes };
  }
}

async function fetchTornPartial(
  buyRes,
  sellRes,
  fromTimestamp,
  toTimestamp,
  fetchCount
) {
  if (!fetchCount) {
    fetchCount = 0;
  }
  const apiKey = document.getElementById("apiKey").value;
  const fetchItemMarketUrl =
    "https://api.torn.com/user/3960421?selections=log&cat=11&key=" +
    API_KEY +
    "&from=" +
    fromTimestamp +
    "&to=" +
    toTimestamp;
  updateStatus("fetching: " + fetchCount);
  var res = await fetch(fetchItemMarketUrl);
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
    console.log("Sending RPC");
    return fetchTornPartial(
      buyRes,
      sellRes,
      fromTimestamp,
      minToTimestamp - 1,
      fetchCount + 1
    );
  } else {
    return { sell: sellRes, buy: buyRes };
  }
}

async function pushToTableDemo() {
  const response = await fetch("http://localhost:5000/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trades: [
        { itemId: 2, itemName: "banana" },
        { itemId: 3, itemName: "hors" },
      ],
    }),
  });
}

async function syncData() {
    let res = await fetch("http://localhost:5000/most_recent");
    const jsonTimestamp = await res.json();
    const timestamp = jsonTimestamp["most_recent_timestamp"];

    updateStatus("Fetching market data");
    const marketData = await fetchTorn(timestamp);
    const marketDataCount = marketData.buy.length + marketData.sell.length;
    updateStatus("Pushing market data to table")
    await pushToTable(marketData);

    updateStatus("Fetching bazaar data")
    const bazaarData = await fetchBazaar(timestamp);
    const bazaarDataCount = bazaarData.buy.length + bazaarData.sell.length;
    updateStatus("Pushing bazaar data to table")
    await pushToTable(bazaarData);
    updateStatus(`Pushed ${marketDataCount} new trades from market, ${bazaarDataCount} from bazaar`);
}

async function pushToTable(items) {
    const data = generateTradeJson(items);
  // Need to be on the format {'trades': [{id: string, itemId: int, tradeType: string, quantity: int, price: int, timestamp: int}]}
  const response = await fetch("http://localhost:5000/data", {
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
    res.push(createTradeRequest(item, 'BUY'));
  }
  for (const item of items.sell) {
    res.push(createTradeRequest(item, 'SELL'));
  }
  return {'trades': res};
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

function generateSqlOutput() {
  let output = document.getElementById("output");
  output.textContent =
    "INSERT INTO MARKET_TRADES (id, itemId, tradeType, quantity, price, timestamp) VALUES ";
  for (const itemData of queryRes.buy) {
    const item = itemData.data;
    let sqlStr = `('${itemData.logId}', ${item.items[0].id}, 'BUY', ${item.items[0].qty}, ${item.cost_each}, ${itemData.timestamp}),
`;
    output.textContent += sqlStr;
  }
  for (const itemData of queryRes.sell) {
    const item = itemData.data;
    let sqlStr = `('${itemData.logId}', ${item.items[0].id}, 'SELL', ${item.items[0].qty}, ${item.cost_each}, ${itemData.timestamp}),
`;
    output.textContent += sqlStr;
  }
}

function parseBuys() {
  const res = {};
  for (const item of queryRes.buy) {
    parseItemBuy(item.data, res);
  }
  console.log(res);
  parsedBuy = res;
  updateStatus("parsing complete");
  return parsedBuy;
}

function parseItemBuy(item, result) {
  const itemType = item.items[0].id;
  const quantity = item.items[0].qty;
  const price = item.cost_each;
  if (!result[itemType]) {
    result[itemType] = { quantity: 0, totalPrice: 0 };
  }
  result[itemType].quantity += quantity;
  result[itemType].totalPrice += price * quantity;
}

function generateItemSql() {
  let output = document.getElementById("output");
  output.textContent =
    "INSERT INTO ITEM_DATA (itemId, itemName, sellValue, marketValue) VALUES ";
  for (const item of items.items) {
    let sqlStr = `(${item.id}, '${item.name.replaceAll("'", "")}', ${
      item.value.sell_price
    }, ${item.value.market_price}),
`;
    output.textContent += sqlStr;
  }
}

async function fetchItems() {
  updateStatus("Fetching items");
  const fetchItemsUrl =
    "https://api.torn.com/torn/?selections=items&key=ZtBwt22hMlryQVKM";
  var res = await fetch(fetchItemsUrl);
  var jsonRes = await res.json();
  updateStatus("items fetched");
  items = jsonRes;
}
