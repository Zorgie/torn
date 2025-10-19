from flask import Flask, jsonify, request
from flask_cors import CORS # Import the CORS extension
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