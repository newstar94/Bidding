import os
import sqlite3
from pathlib import Path

from backend.shared.paths import DATA_DIR, PROJECT_ROOT


class SQLiteDatabase:
    def __init__(self, db_path=None):
        default_path = DATA_DIR / "bidding.db"
        configured_path = db_path or os.environ.get("BIDDING_DB_PATH") or default_path
        if not os.path.isabs(configured_path):
            configured_path = PROJECT_ROOT / configured_path
        self.db_path = os.path.abspath(configured_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def acquire_writer_lease(self):
        """Hold the process-wide single-writer lease for this SQLite file."""
        lease = SQLiteWriterLease(f"{self.db_path}.writer.lock")
        lease.acquire()
        return lease

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


class SQLiteWriterLease:
    """Portable non-blocking advisory lock used to enforce one app process.

    SQLite safely supports concurrent connections inside this process. The
    lease prevents accidentally starting a second ASGI instance against the
    same file, which the application architecture does not support.
    """

    def __init__(self, lock_path):
        self.lock_path = str(Path(lock_path).resolve())
        self._handle = None

    def acquire(self):
        if self._handle is not None:
            return self
        Path(self.lock_path).parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.lock_path, "a+b")
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle.seek(0)
            handle.truncate()
            handle.write(str(os.getpid()).encode("ascii"))
            handle.flush()
            self._handle = handle
            return self
        except OSError as exc:
            handle.close()
            raise RuntimeError(
                "Another BiddingFlow process already owns this SQLite database. "
                "Run exactly one application instance or migrate to PostgreSQL."
            ) from exc

    def release(self):
        handle = self._handle
        if handle is None:
            return
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            self._handle = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, exc_type, exc_value, traceback):
        del exc_type, exc_value, traceback
        self.release()


models = None
database = SQLiteDatabase()


def load_and_register(name, filepath):
    return database if name == "database" else models
