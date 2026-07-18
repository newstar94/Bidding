"""Small DB-API compatibility layer for shared application SQL."""

import re

from backend.db.postgresql_types import BOOLEAN_COLUMNS, DATE_COLUMNS


_BOOLEAN_PARAMETER = "CASE WHEN (%s)::text IN ('1', 'true', 't') THEN TRUE ELSE FALSE END"


def _split_sql_list(source):
    parts = []
    start = 0
    depth = 0
    quote = None
    index = 0
    while index < len(source):
        character = source[index]
        if quote:
            if character == quote:
                following = source[index + 1] if index + 1 < len(source) else ""
                if following == quote:
                    index += 1
                else:
                    quote = None
        elif character in {"'", '"'}:
            quote = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        elif character == "," and depth == 0:
            parts.append(source[start:index].strip())
            start = index + 1
        index += 1
    parts.append(source[start:].strip())
    return parts


def _rewrite_boolean_insert(match):
    columns = [column.strip().strip('"').casefold() for column in _split_sql_list(match.group("columns"))]
    values = _split_sql_list(match.group("values"))
    if len(columns) != len(values):
        return match.group(0)
    for index, column in enumerate(columns):
        if column not in BOOLEAN_COLUMNS:
            continue
        value = values[index].strip()
        if value == "%s":
            values[index] = _BOOLEAN_PARAMETER
        elif value in {"0", "1"}:
            values[index] = "TRUE" if value == "1" else "FALSE"
    return (
        f"{match.group('prefix')}({match.group('columns')}) VALUES "
        f"({', '.join(values)})"
    )


def _rewrite_boolean_sql(sql):
    converted = re.sub(
        r"(?P<prefix>INSERT\s+INTO\s+[\"A-Za-z_][\"A-Za-z0-9_]*\s*)"
        r"\((?P<columns>[^;]+?)\)\s+VALUES\s*\((?P<values>[^;]+?)\)",
        _rewrite_boolean_insert,
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for column in sorted(BOOLEAN_COLUMNS, key=len, reverse=True):
        converted = re.sub(
            rf"\b({column})\s*=\s*%s",
            rf"\1 = {_BOOLEAN_PARAMETER}",
            converted,
            flags=re.IGNORECASE,
        )
        converted = re.sub(
            rf"\b({column})\s*=\s*1\b",
            rf"\1 = TRUE",
            converted,
            flags=re.IGNORECASE,
        )
        converted = re.sub(
            rf"\b({column})\s*=\s*0\b",
            rf"\1 = FALSE",
            converted,
            flags=re.IGNORECASE,
        )
    return converted


def qmark_to_postgresql(sql):
    """Convert qmark placeholders outside SQL literals/comments to ``%s``."""

    source = str(sql)
    output = []
    index = 0
    state = "sql"
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if state == "sql":
            if char == "'":
                state = "single"
            elif char == '"':
                state = "double"
            elif char == "-" and following == "-":
                state = "line_comment"
            elif char == "/" and following == "*":
                state = "block_comment"
            elif char == "?":
                output.append("%s")
                index += 1
                continue
        elif state == "single" and char == "'":
            if following == "'":
                output.extend((char, following))
                index += 2
                continue
            state = "sql"
        elif state == "double" and char == '"':
            if following == '"':
                output.extend((char, following))
                index += 2
                continue
            state = "sql"
        elif state == "line_comment" and char in "\r\n":
            state = "sql"
        elif state == "block_comment" and char == "*" and following == "/":
            output.extend((char, following))
            index += 2
            state = "sql"
            continue
        output.append(char)
        index += 1
    return "".join(output)


def sqlite_sql_to_postgresql(sql):
    converted = qmark_to_postgresql(sql)
    converted = re.sub(
        r"^\s*BEGIN\s+IMMEDIATE\s*;?\s*$",
        "BEGIN",
        converted,
        flags=re.IGNORECASE,
    )
    converted = _rewrite_boolean_sql(converted)
    converted = re.sub(
        r"^\s*PRAGMA\s+(?:journal_mode|busy_timeout)\b.*$",
        "SELECT 1",
        converted,
        flags=re.IGNORECASE,
    )
    converted = re.sub(
        r"SELECT\s+1\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*%s",
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = %s",
        converted,
        flags=re.IGNORECASE,
    )
    converted = re.sub(
        r"datetime\(\s*'now'\s*\)",
        "CURRENT_TIMESTAMP",
        converted,
        flags=re.IGNORECASE,
    )
    converted = re.sub(
        r"date\(\s*'now'\s*\)",
        "CURRENT_DATE",
        converted,
        flags=re.IGNORECASE,
    )
    for column in DATE_COLUMNS:
        converted = re.sub(
            rf"substr\(\s*({column})\s*,\s*6\s*,\s*2\s*\)\s*=\s*%s",
            rf"EXTRACT(MONTH FROM \1) = CAST(%s AS INTEGER)",
            converted,
            flags=re.IGNORECASE,
        )
    ignore_insert = bool(
        re.search(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", converted, re.IGNORECASE)
    )
    converted = re.sub(
        r"\bINSERT\s+OR\s+IGNORE\s+INTO\b",
        "INSERT INTO",
        converted,
        flags=re.IGNORECASE,
    )
    if ignore_insert:
        stripped = converted.rstrip()
        suffix = ";" if stripped.endswith(";") else ""
        if suffix:
            stripped = stripped[:-1].rstrip()
        converted = f"{stripped} ON CONFLICT DO NOTHING{suffix}"
    converted = re.sub(
        r"MAX\(\s*COALESCE\(deleted_records\.delete_version,\s*0\),\s*"
        r"COALESCE\((?:excluded|EXCLUDED)\.delete_version,\s*0\)\s*\)",
        "GREATEST(COALESCE(deleted_records.delete_version, 0), "
        "COALESCE(EXCLUDED.delete_version, 0))",
        converted,
        flags=re.IGNORECASE,
    )
    return converted


class PostgreSQLCursorAdapter:
    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql, parameters=None):
        converted = sqlite_sql_to_postgresql(sql)
        normalized = " ".join(converted.casefold().split())
        if normalized == "select entry_hash from audit_log order by id desc limit 1":
            # Serialize audit head selection even while the table is empty.
            # A row-level FOR UPDATE lock alone cannot protect the first append.
            self._cursor.execute("SELECT pg_advisory_xact_lock(4273312026)")
        if parameters is None:
            self._cursor.execute(converted)
        else:
            self._cursor.execute(converted, parameters)
        return self

    def executemany(self, sql, parameters):
        self._cursor.executemany(sqlite_sql_to_postgresql(sql), parameters)
        return self

    def __iter__(self):
        return iter(self._cursor)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class PostgreSQLConnectionAdapter:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self, *args, **kwargs):
        return PostgreSQLCursorAdapter(self._connection.cursor(*args, **kwargs))

    def execute(self, sql, parameters=None):
        cursor = self.cursor()
        return cursor.execute(sql, parameters)

    def executemany(self, sql, parameters):
        cursor = self.cursor()
        return cursor.executemany(sql, parameters)

    @property
    def in_transaction(self):
        from psycopg.pq import TransactionStatus

        return self._connection.info.transaction_status != TransactionStatus.IDLE

    def close(self):
        """Return only an idle connection to the pool.

        PostgreSQL starts a transaction for ordinary SELECT statements. Most
        SQLite call sites close after reads without an explicit rollback, so
        normalize that behavior here instead of making the pool repair and
        warn about every returned connection.
        """
        from psycopg.pq import TransactionStatus

        if self._connection.closed:
            return
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            self._connection.rollback()
        self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return self._connection.__exit__(exc_type, exc_value, traceback)

    def __getattr__(self, name):
        return getattr(self._connection, name)
