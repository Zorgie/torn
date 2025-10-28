from flask import Flask, jsonify, request
from flask_cors import CORS # Import the CORS extension
from google.cloud.sql.connector import Connector, IPTypes
from flask import abort, request, render_template
from time import strftime, localtime
import datetime
import time 
import os # Import os for path handling
import sqlite3
import pymysql
import sqlalchemy

# --- Configuration ---
DATABASE = 'torn.db' # Name of your SQLite file

def connect_with_connector() -> sqlalchemy.engine.base.Engine:
    """
    Initializes a connection pool for a Cloud SQL instance of MySQL.

    Uses the Cloud SQL Python Connector package.
    """
    # Note: Saving credentials in environment variables is convenient, but not
    # secure - consider a more secure solution such as
    # Cloud Secret Manager (https://cloud.google.com/secret-manager) to help
    # keep secrets safe.

    instance_connection_name = os.environ[
        "INSTANCE_CONNECTION_NAME"
    ]  # e.g. 'project:region:instance'
    db_user = os.environ["DB_USER"]  # e.g. 'my-db-user'
    db_pass = os.environ["DB_PASS"]  # e.g. 'my-db-password'
    db_name = os.environ["DB_NAME"]  # e.g. 'my-database'

    ip_type = IPTypes.PUBLIC # if os.environ.get("PRIVATE_IP") else IPTypes.PUBLIC

    # initialize Cloud SQL Python Connector object
    connector = Connector(ip_type=ip_type, refresh_strategy="LAZY")

    def getconn() -> pymysql.connections.Connection:
        conn: pymysql.connections.Connection = connector.connect(
            instance_connection_name,
            "pymysql",
            user=db_user,
            password=db_pass,
            db=db_name,
        )
        return conn

    pool = sqlalchemy.create_engine(
        "mysql+pymysql://",
        creator=getconn,
        # ...
    )
    return pool

def get_db_connection():
    # Establishes a connection to the SQLite database.
    # The 'check_same_thread=False' is important for Flask to avoid thread errors
    # when handling multiple requests concurrently.
    conn = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row # Allows accessing columns by name
    return conn

def init_db():
    # Initializes the database with a simple table if it doesn't exist.
    conn = get_db_connection()
    cursor = conn.cursor()
    marketTradeTable = cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='MARKET_TRADES';").fetchone()
    if not marketTradeTable:
        cursor.execute('''
            CREATE TABLE MARKET_TRADES (
                id TEXT PRIMARY KEY,
                itemId int,
                tradeType TEXT CHECK (tradeType IN ('BUY', 'SELL')),
                quantity int,
                price int,
                timestamp int
            );
            ''')
    itemDataTable = cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ITEM_DATA';").fetchone()
    if not itemDataTable:
        cursor.execute('''
            CREATE TABLE ITEM_DATA (
                itemId int PRIMARY KEY,
                itemName TEXT,
                sellValue int,
                marketValue int
            );
            ''')
        
    dailySummaryTable = cursor.execute("SELECT name FROM sqlite_master WHERE type='view' AND name='DAILY_SUMMARY';").fetchone()
    if not dailySummaryTable:
        cursor.execute('''
            CREATE VIEW DAILY_SUMMARY AS SELECT *, sellCount * (avgSellPrice - avgBuyPrice) as profit FROM (
            SELECT
                itemId,
                strftime('%Y-%m-%d', DATETIME(ROUND(timestamp), 'unixepoch')) AS isodate, 
                SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) as buyCount,
                SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) AS avgBuyPrice,
                SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) as sellCount,
                ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) AS avgSellPrice
            FROM MARKET_TRADES
            GROUP BY 1, 2)
            ORDER BY profit DESC;
            ''')
    conn.commit()
    conn.close()

# Initialize the Flask app and the database
app = Flask(__name__)

init_db()

# --- CORS Configuration ---
# It enables CORS for all routes (/*) and allows all origins (*).
# For a local network/development environment, this is the simplest and most effective approach.
CORS(app)

# --- API Endpoints ---
@app.route('/most_recent', methods=['GET'])
def get_most_recent():
    pool = connect_with_connector()
    with pool.connect() as db_conn:
        result = db_conn.execute(sqlalchemy.text("SELECT MAX(timestamp) FROM MARKET_TRADES")).fetchone()

    if result and result[0] is not None:
        # result[0] accesses the value from the first (and only) column
        most_recent_timestamp = result[0] 
    else:
        most_recent_timestamp = None
        
    # Return the value directly as a simple JSON object
    return jsonify({"most_recent_timestamp": most_recent_timestamp})


@app.route('/data', methods=['POST'])
def add_data():
    if not request.is_json:
        return jsonify({"error": "Missing JSON in request"}), 400
    
    item_data = request.get_json()
    trades = item_data.get('trades')
    userId = request.headers.get('X-User-Id')   # None if missing
    secret  = request.headers.get('X-Secret')
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    
    pool = connect_with_connector()
    with pool.connect() as db_conn:
        for trade in trades:
            db_conn.execute(sqlalchemy.text("INSERT INTO MARKET_TRADES (userId, id, itemId, tradeType, quantity, price, timestamp) VALUES (:userId, :id, :itemId, :tradeType, :quantity, :price, :timestamp) ON DUPLICATE KEY UPDATE itemId=:itemId, tradeType=:tradeType, quantity=:quantity, price=:price, timestamp=:timestamp"), 
                            {"userId": userId, "id": trade['id'], "itemId": trade['itemId'], "tradeType": trade['tradeType'], "quantity": trade['quantity'], "price": trade['price'], "timestamp": trade['timestamp']})
            db_conn.commit()
            print("row added")
            
    return jsonify({"message": "Items added successfully"}), 201

def authorize(user_id, secret):
    # Placeholder for authorization logic
    # Return True if authorized, False otherwise
    pool = connect_with_connector()
    with pool.connect() as db_conn:
        userIdLookup = db_conn.execute(sqlalchemy.text("SELECT id FROM USER_ID_LOOKUP WHERE id =:user_Id AND secret =:secret"), {"user_Id": user_id, "secret": secret}).fetchone()
    return userIdLookup is not None

@app.route('/item_data/<itemName>', methods=['GET'])
def get_item_data(itemName):
    # The item name is passed as part of the URL path
    conn = get_db_connection()
    
    try:
        # Select price and quantity for the given symbol, limited to 20 most recent results
        result = conn.execute(
            'SELECT itemId FROM ITEM_DATA WHERE UPPER(itemName) = UPPER(?)', 
            (itemName,)
        ).fetchone()
    
        conn.close()
        
        if result and result[0] is not None:
            # result[0] accesses the value from the first (and only) column
            itemId = result[0] 
        else:
            itemId = None
            
        # Return the value directly as a simple JSON object
        return jsonify({itemName: itemId})

    except sqlite3.Error as e:
        conn.close()
        # Return a 500 error if there's a database issue
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/daily_summary', methods=['GET', 'POST'])
def get_daily_summary():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            dates = request.json.get('dates', [])
            if not dates:
                return jsonify({'error': 'No dates provided'}), 400
            
            placeholders = ','.join('?' * len(dates))
            query = f'''
                SELECT itemId, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
                FROM DAILY_SUMMARY 
                WHERE isodate IN ({placeholders})
                ORDER BY isodate DESC, profit DESC
            '''
            results = conn.execute(query, dates).fetchall()
        else:
            start_date = request.args.get('start_date')
            end_date = request.args.get('end_date')
            
            if not start_date or not end_date:
                return jsonify({'error': 'start_date and end_date parameters are required'}), 400
            
            query = '''
                SELECT itemId, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
                FROM DAILY_SUMMARY 
                WHERE isodate BETWEEN ? AND ?
                ORDER BY isodate DESC, profit DESC
            '''
            results = conn.execute(query, (start_date, end_date)).fetchall()
    
        return jsonify([dict(ix) for ix in results])

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/profit_by_date', methods=['GET'])
def get_profit_by_date():
    conn = get_db_connection()
    results = conn.execute("SELECT isodate, sum(profit) as profit FROM DAILY_SUMMARY GROUP BY 1;").fetchall()
    conn.close()
    
    return jsonify([dict(ix) for ix in results])

@app.route('/total_summary', methods=['GET'])
def get_total_summary():
    query = '''
            SELECT *, sellCount * (avgSellPrice - avgBuyPrice) as profit FROM (
            SELECT
                itemId,
                SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) as buyCount,
                SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) AS avgBuyPrice,
                SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) as sellCount,
                ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) AS avgSellPrice
            FROM MARKET_TRADES
            GROUP BY 1)
            ORDER BY profit DESC;
'''
    conn = get_db_connection()
    results = conn.execute(query).fetchall()
    conn.close()
    return jsonify([dict(ix) for ix in results])

@app.route('/')
def root():
    return render_template("index.html")

@app.route('/calculate_profit', methods=['GET'])
def calculate_profit():
    # conn = get_db_connection()
    
    # Get optional filters from query parameters
    item_id = request.args.get('itemId')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    userId = request.headers.get('X-User-Id')   # None if missing
    secret  = request.headers.get('X-Secret')
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401

    # Build the query based on filters
    query = 'SELECT * FROM MARKET_TRADES'
    pool = connect_with_connector()
    with pool.connect() as db_conn:
        result = db_conn.execute(
            sqlalchemy.text("SELECT * FROM MARKET_TRADES WHERE userId=:userId ORDER BY timestamp ASC"),
            {"userId": userId}
        )
        # .mappings().all() returns a list of dict-like rows
        trades = result.mappings().all()

    filters = []
    if item_id and item_id != 'null':
        filters.append('itemId = ?')
    if start_date and end_date:
        start_timestamp = time.mktime(datetime.datetime.strptime(start_date, "%d/%m/%Y").timetuple())
        end_timestamp = time.mktime(datetime.datetime.strptime(end_date, "%d/%m/%Y").timetuple()) + 86399  # Include the entire end day
        filters.append('timestamp BETWEEN ? AND ?')
    
    if filters:
        query += ' WHERE ' + ' AND '.join(filters)
    query += ' ORDER BY timestamp ASC'
    
    # Execute the query with parameters
    params = []
    if item_id and item_id != 'null':
        params.append(item_id)
    if start_date and end_date:
        params.extend([start_timestamp, end_timestamp])
    
    # trades = conn.execute(query, params).fetchall()
    # conn.close()

    stock = {}
    total_buy_price = {}
    profit_dict = {}

    for trade in trades:
        item_id   = trade.get('itemId')
        trade_type = trade.get('tradeType')
        quantity  = int(trade.get('quantity') or 0)
        price     = int(trade.get('price') or 0)
        ts        = int(trade.get('timestamp') or 0)

        if item_id not in stock:
            stock[item_id] = 0
            total_buy_price[item_id] = 0.0

        if trade_type == 'BUY':
            stock[item_id] += quantity
            total_buy_price[item_id] += price * quantity
        elif trade_type == 'SELL':
            avg_buy_price = (total_buy_price[item_id] / stock[item_id]) if stock[item_id] > 0 else 0
            stock[item_id] -= quantity
            stock[item_id] = max(stock[item_id], 0)  # Prevent negative stock
            total_buy_price[item_id] -= avg_buy_price * quantity
            total_buy_price[item_id] = max(total_buy_price[item_id], 0)
            profit = quantity * (price * 0.95 - avg_buy_price)

            date = strftime('%Y-%m-%d', localtime(ts))
            if date not in profit_dict:
                profit_dict[date] = 0.0
            profit_dict[date] += profit

    profit_results = []
    for date, profit in profit_dict.items():
        profit_results.append({
            'date': date,
            'profit': profit
        })

    return jsonify(profit_results), 200    
# --- Run Server ---

if __name__ == '__main__':
    # '0.0.0.0' makes the server reachable from other devices on the local network.
    # '127.0.0.1' or 'localhost' would restrict it to the host machine only.
    app.run(host='0.0.0.0', port=5000, debug=True)