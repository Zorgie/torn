CREATE VIEW DAILY_SUMMARY AS SELECT *, sellCount * (avgSellPrice - avgBuyPrice) as profit FROM (
SELECT
    itemName,
    strftime('%Y-%m-%d', DATETIME(ROUND(timestamp), 'unixepoch')) AS isodate, 
    SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) as buyCount,
    SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) AS avgBuyPrice,
    SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) as sellCount,
    ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) AS avgSellPrice
FROM MARKET_TRADES NATURAL INNER JOIN ITEM_DATA
GROUP BY 1, 2)
ORDER BY profit DESC;