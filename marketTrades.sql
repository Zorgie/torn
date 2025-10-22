CREATE TABLE MARKET_TRADES (
    id TEXT PRIMARY KEY,
    itemId int,
    tradeType TEXT CHECK (tradeType IN ('BUY', 'SELL')),
    quantity int,
    price int,
    timestamp int
);