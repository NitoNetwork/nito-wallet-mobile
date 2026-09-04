"""Test-only SQLite connection. No wallet secrets, native modules or dependencies."""
import json
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1], isolation_level=None)
db.row_factory = sqlite3.Row
for line in sys.stdin:
    request = json.loads(line)
    try:
        if request["operation"] == "close":
            db.close()
            print(json.dumps({"id": request["id"], "result": None}), flush=True)
            break
        if request["operation"] == "exec":
            # executescript would implicitly commit an open transaction. Execute
            # complete statements separately to retain expo-sqlite semantics.
            statement = ""
            for char in request["sql"]:
                statement += char
                if char == ";" and sqlite3.complete_statement(statement):
                    db.execute(statement)
                    statement = ""
            if statement.strip():
                db.execute(statement)
            result = None
        else:
            cursor = db.execute(request["sql"], request.get("params", []))
            result = ([dict(row) for row in cursor.fetchall()]
                      if request["operation"] == "read"
                      else {"changes": max(0, cursor.rowcount), "lastInsertRowId": cursor.lastrowid})
        response = {"id": request["id"], "result": result}
    except Exception as error:
        response = {"id": request["id"], "error": str(error)}
    print(json.dumps(response), flush=True)
