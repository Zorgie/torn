from flask import Flask, jsonify, request, render_template
from flask_cors import CORS # Import the CORS extension
from google.cloud.sql.connector import Connector, IPTypes
from flask import abort
from time import strftime, localtime
import time
import datetime
import os # Import os for path handling
import pymysql
import sqlalchemy

# --- Configuration (Kept for clarity, but only relevant for MySQL) ---
# DATABASE = 'torn.db' # REMOVED: No longer using SQLite

# --- Database Connection (Cloud SQL / SQLAlchemy) ---
def connect_with_connector() -> sqlalchemy.engine.base.Engine:
    """
    Initializes a connection pool for a Cloud SQL instance of MySQL.
    """
    # Using environment variables as before
    instance_connection_name = os.environ[
        "INSTANCE_CONNECTION_NAME"
    ] # e.g. 'project:region:instance'
    db_user = os.environ["DB_USER"] # e.g. 'my-db-user'
    db_pass = os.environ["DB_PASS"] # e.g. 'my-db-password'
    db_name = os.environ["DB_NAME"] # e.g. 'my-database'

    ip_type = IPTypes.PUBLIC # if os.environ.get("PRIVATE_IP") else IPTypes.PUBLIC

    # initialize Cloud SQL Python Connector object
    # Note: Use pool_size=1 to prevent connection exhaustion in simple apps
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
        # Pool size and timeout settings are good practice for production
        pool_size=5, 
        max_overflow=2,
        pool_timeout=30, # seconds
        pool_recycle=1800, # seconds
    )
    return pool

# --- Database Initialization (Now uses Cloud SQL/SQLAlchemy) ---

def initialize_database(pool: sqlalchemy.engine.base.Engine):
    """
    Initializes tables (MARKET_TRADES, ITEM_DATA) and view (DAILY_SUMMARY) 
    in the MySQL database if they do not exist.
    """
    with pool.connect() as db_conn:
        # Create MARKET_TRADES Table
        # Using VARCHAR for id, primary key.
        # userId is added here as it's used in add_data and calculate_profit.
        db_conn.execute(sqlalchemy.text('''
            CREATE TABLE IF NOT EXISTS MARKET_TRADES (
                id VARCHAR(255) PRIMARY KEY,
                userId VARCHAR(255),
                itemId INT,
                tradeType ENUM('BUY', 'SELL'), -- MySQL uses ENUM, not CHECK
                quantity INT,
                price INT,
                timestamp INT,
                INDEX idx_userId (userId),
                INDEX idx_itemId (itemId),
                INDEX idx_timestamp (timestamp)
            );
        '''))

        # Create ITEM_DATA Table
        db_conn.execute(sqlalchemy.text('''
            CREATE TABLE IF NOT EXISTS ITEM_DATA (
                itemId INT PRIMARY KEY,
                itemName VARCHAR(255),
                sellValue INT,
                marketValue INT
            );
        '''))
        
        # Create DAILY_SUMMARY View (Need to drop and re-create if it exists)
        # Note: MySQL's date formatting is different (DATE_FORMAT and FROM_UNIXTIME)
        db_conn.execute(sqlalchemy.text("DROP VIEW IF EXISTS DAILY_SUMMARY;"))
        db_conn.execute(sqlalchemy.text('''
            CREATE VIEW DAILY_SUMMARY AS 
            SELECT 
                t.userId,
                t.itemId, 
                DATE(FROM_UNIXTIME(t.timestamp)) AS isodate, 
                SUM(CASE WHEN t.tradeType = 'BUY' THEN t.quantity ELSE 0 END) AS buyCount,
                COALESCE(SUM(CASE WHEN t.tradeType = 'BUY' THEN t.price * t.quantity ELSE 0 END) / NULLIF(SUM(CASE WHEN t.tradeType = 'BUY' THEN t.quantity ELSE 0 END), 0), 0) AS avgBuyPrice,
                SUM(CASE WHEN t.tradeType = 'SELL' THEN t.quantity ELSE 0 END) AS sellCount,
                COALESCE(ROUND(SUM(CASE WHEN t.tradeType = 'SELL' THEN t.price * t.quantity * 0.95 ELSE 0 END)) / NULLIF(SUM(CASE WHEN t.tradeType = 'SELL' THEN t.quantity ELSE 0 END), 0), 0) AS avgSellPrice,
                SUM(CASE WHEN t.tradeType = 'SELL' THEN t.quantity ELSE 0 END) * (
                    COALESCE(ROUND(SUM(CASE WHEN t.tradeType = 'SELL' THEN t.price * t.quantity * 0.95 ELSE 0 END)) / NULLIF(SUM(CASE WHEN t.tradeType = 'SELL' THEN t.quantity ELSE 0 END), 0), 0) - 
                    COALESCE(SUM(CASE WHEN t.tradeType = 'BUY' THEN t.price * t.quantity ELSE 0 END) / NULLIF(SUM(CASE WHEN t.tradeType = 'BUY' THEN t.quantity ELSE 0 END), 0), 0)
                ) AS profit
            FROM MARKET_TRADES t
            GROUP BY 1, 2, 3;
        '''))
        db_conn.commit()


# Initialize the Flask app and the database
app = Flask(__name__)
db_pool = connect_with_connector() # Connect once globally (pool)

# --- CORS Configuration ---
CORS(app)

# --- Authorization Helper ---
def authorize(user_id, secret):
    """Placeholder for authorization logic using the Cloud SQL pool."""
    with db_pool.connect() as db_conn:
        userIdLookup = db_conn.execute(
            sqlalchemy.text("SELECT id FROM USER_ID_LOOKUP WHERE id =:user_Id AND secret =:secret"), 
            {"user_Id": user_id, "secret": secret}
        ).fetchone()
    return userIdLookup is not None


# --- API Endpoints ---
@app.route('/most_recent', methods=['GET'])
def get_most_recent():
    userId = request.headers.get('X-User-Id') # None if missing
    secret = request.headers.get('X-Secret')
    
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    
    with db_pool.connect() as db_conn:
        result = db_conn.execute(sqlalchemy.text("SELECT MAX(timestamp) FROM MARKET_TRADES WHERE userId=:userId"), {"userId": userId}).fetchone()

    most_recent_timestamp = result[0] if result and result[0] is not None else None
    
    return jsonify({"most_recent_timestamp": most_recent_timestamp})


@app.route('/data', methods=['POST'])
def add_data():
    if not request.is_json:
        return jsonify({"error": "Missing JSON in request"}), 400
    
    item_data = request.get_json()
    trades = item_data.get('trades')
    userId = request.headers.get('X-User-Id') # None if missing
    secret = request.headers.get('X-Secret')
    
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    
    with db_pool.connect() as db_conn:
        # Use executemany for efficiency
        trade_params = []
        for trade in trades:
             # Ensure trade has all required keys or handle missing ones gracefully
            trade_params.append({
                "userId": int(userId), 
                "id": trade['id'], 
                "itemId": trade['itemId'], 
                "tradeType": trade['tradeType'], 
                "quantity": trade['quantity'], 
                "price": trade['price'], 
                "timestamp": trade['timestamp']
            })
            
        # The query must be modified to include userId in the INSERT/UPDATE
        db_conn.execute(
            sqlalchemy.text("""
                            INSERT INTO MARKET_TRADES (userId, id, itemId, tradeType, quantity, price, timestamp) 
                            VALUES (:userId, :id, :itemId, :tradeType, :quantity, :price, :timestamp)
                            """), 
            trade_params # Pass the list of dictionaries
        )
        db_conn.commit()
            
    return jsonify({"message": "Items added successfully"}), 201

@app.route('/item_data/<itemName>', methods=['GET'])
def get_item_data(itemName):
    # Uses global db_pool
    try:
        with db_pool.connect() as db_conn:
            # Select itemId from ITEM_DATA
            result = db_conn.execute(
                sqlalchemy.text('SELECT itemId FROM ITEM_DATA WHERE UPPER(itemName) = UPPER(:itemName)'), 
                {'itemName': itemName}
            ).fetchone()
    
        itemId = result[0] if result and result[0] is not None else None
        
        return jsonify({itemName: itemId})

    except Exception as e: # Catching a broader exception for DB issues
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/daily_summary', methods=['GET', 'POST'])
def get_daily_summary():
    userId = request.headers.get('X-User-Id') # None if missing
    secret = request.headers.get('X-Secret')
    
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    with db_pool.connect() as db_conn:
        if request.method == 'POST':
            dates = request.json.get('dates', [])
            if not dates:
                return jsonify({'error': 'No dates provided'}), 400
            
            # Using SQLAlchemy's text with bound parameters for safe IN clause
            query = sqlalchemy.text('''
                SELECT itemId, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
                FROM DAILY_SUMMARY 
                WHERE isodate IN :dates AND userId = :userId
                ORDER BY isodate DESC, profit DESC
            ''').bindparams(dates=tuple(dates), userId=userId) # Pass as a tuple to bind to :dates
            
            results = db_conn.execute(query).fetchall()
        else:
            start_date = request.args.get('start_date')
            end_date = request.args.get('end_date')
            
            if not start_date or not end_date:
                return jsonify({'error': 'start_date and end_date parameters are required'}), 400
            
            query = sqlalchemy.text('''
                SELECT itemId, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
                FROM DAILY_SUMMARY 
                WHERE isodate BETWEEN :start_date AND :end_date
                ORDER BY isodate DESC, profit DESC
            ''')
            results = db_conn.execute(query, {'start_date': start_date, 'end_date': end_date}).fetchall()
    
    # Convert SQLAlchemy Rows to dictionary list
    return jsonify([ix._asdict() for ix in results])

@app.route('/profit_by_date', methods=['GET'])
def get_profit_by_date():
    userId = request.headers.get('X-User-Id') # None if missing
    secret = request.headers.get('X-Secret')
    
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    query = sqlalchemy.text("SELECT isodate, SUM(profit) AS profit FROM DAILY_SUMMARY WHERE userId=:userId GROUP BY 1 ORDER BY isodate DESC;", {"userId": userId})
    
    with db_pool.connect() as db_conn:
        results = db_conn.execute(query).fetchall()
    
    # Convert SQLAlchemy Rows to dictionary list
    return jsonify([ix._asdict() for ix in results])

@app.route('/total_summary', methods=['GET'])
def get_total_summary():
    userId = request.headers.get('X-User-Id') # None if missing
    secret = request.headers.get('X-Secret')
    
    if not authorize(userId, secret):
        return jsonify({"error": "Unauthorized"}), 401
    query = sqlalchemy.text('''
        SELECT
            itemId,
            SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) AS buyCount,
            COALESCE(SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / NULLIF(SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END), 0), 0) AS avgBuyPrice,
            SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) AS sellCount,
            COALESCE(ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / NULLIF(SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END), 0), 0) AS avgSellPrice,
            SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) * (
                COALESCE(ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / NULLIF(SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END), 0), 0) -
                COALESCE(SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / NULLIF(SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END), 0), 0)
            ) AS profit
        FROM MARKET_TRADES WHERE userId=:userId
        GROUP BY 1
        ORDER BY profit DESC;
    ''')

    with db_pool.connect() as db_conn:
        results = db_conn.execute(query, {"userId": userId}).fetchall()

    return jsonify([ix._asdict() for ix in results])

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
    app.run(host='0.0.0.0', port=5000, debug=True)