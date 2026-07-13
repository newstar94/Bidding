import os
import sqlite3


current_dir = os.path.dirname(os.path.abspath(__file__))


class SQLiteDatabase:
    def __init__(self, db_path=None):
        default_path = os.path.join(current_dir, "bidding.db")
        self.db_path = os.path.abspath(db_path or os.environ.get("BIDDING_DB_PATH") or default_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=15, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        self._apply_pragmas(conn)
        return conn

    @staticmethod
    def _apply_pragmas(conn):
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA busy_timeout = 15000")
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA cache_size = -65536")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA temp_store = MEMORY")


models = None
database = SQLiteDatabase()


def load_and_register(name, filepath):
    return database if name == "database" else models
