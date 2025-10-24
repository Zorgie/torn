from flask import Flask, jsonify, request
from flask_cors import CORS # Import the CORS extension
from flask import abort, request
import time 
import os # Import os for path handling
import sqlite3

# --- Configuration ---
DATABASE = 'torn.db' # Name of your SQLite file

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

@app.route('/data', methods=['GET'])
def get_data():
    conn = get_db_connection()
    items = conn.execute('SELECT * FROM TEST_TABLE LIMIT 10').fetchall()
    conn.close()
    
    # Convert rows to a list of dictionaries for JSON response
    # items = [dict(row) for row in items] # Already handled by row_factory above, but good to know
    
    return jsonify([dict(ix) for ix in items])

@app.route('/most_recent', methods=['GET'])
def get_most_recent():
    conn = get_db_connection()
    result = conn.execute('SELECT MAX(timestamp) FROM MARKET_TRADES').fetchone();
    conn.close()

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
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        for trade in trades:
            print("Inserting")
            print(trade)
            cursor.execute("INSERT OR REPLACE INTO MARKET_TRADES (id, itemId, tradeType, quantity, price, timestamp) VALUES (?, ?, ?, ?, ?, ?)", (trade['id'], trade['itemId'], trade['tradeType'], trade['quantity'], trade['price'], trade['timestamp']))
            print("execute done")
        conn.commit()
        
    except sqlite3.Error as e:
        conn.rollback()
        print("exception")
        print(e)
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
    # Optionally, return the newly created item's ID
    return jsonify({"message": "Item added successfully"}), 201

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
                SELECT itemName, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
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
                SELECT itemName, isodate, buyCount, avgBuyPrice, sellCount, avgSellPrice, profit
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
                itemName,
                SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) as buyCount,
                SUM(CASE WHEN tradeType = 'BUY' THEN price * quantity ELSE 0 END) / SUM(CASE WHEN tradeType = 'BUY' THEN quantity ELSE 0 END) AS avgBuyPrice,
                SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) as sellCount,
                ROUND(SUM(CASE WHEN tradeType = 'SELL' THEN price * quantity * 0.95 ELSE 0 END)) / SUM(CASE WHEN tradeType = 'SELL' THEN quantity ELSE 0 END) AS avgSellPrice
            FROM MARKET_TRADES NATURAL INNER JOIN ITEM_DATA
            GROUP BY 1)
            ORDER BY profit DESC;
'''
    conn = get_db_connection()
    results = conn.execute(query).fetchall()
    conn.close()
    return jsonify([dict(ix) for ix in results])

@app.route('/')
def serve_frontend():
    # Construct the path to the HTML file in the same directory as app.py
    frontend_filepath = os.path.join(os.getcwd(), 'index.html')
    
    try:
        # Read the content of the HTML file
        with open(frontend_filepath, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Return the content. Flask automatically sets the Content-Type to text/html.
        return html_content
    except FileNotFoundError:
        # Use Flask's abort to return a clean 404 error
        return abort(404, description="Frontend file (index.html) not found in the current directory.")

@app.route('/code')
def serve_js():
    # Construct the path to the HTML file in the same directory as app.py
    frontend_filepath = os.path.join(os.getcwd(), 'code.js')
    
    try:
        # Read the content of the HTML file
        with open(frontend_filepath, 'r', encoding='utf-8') as f:
            js_content = f.read()
        
        # Return the content. Flask automatically sets the Content-Type to text/html.
        return js_content
    except FileNotFoundError:
        # Use Flask's abort to return a clean 404 error
        return abort(404, description="Frontend file (code.js) not found in the current directory.")
# --- Run Server ---

if __name__ == '__main__':
    # '0.0.0.0' makes the server reachable from other devices on the local network.
    # '127.0.0.1' or 'localhost' would restrict it to the host machine only.
    app.run(host='0.0.0.0', port=5000, debug=True)