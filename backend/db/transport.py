"""Resolve the PostgreSQL TLS option checked and consumed at startup."""

from urllib.parse import parse_qsl, urlsplit


SSL_MODES = frozenset({"disable", "allow", "prefer", "require", "verify-ca", "verify-full"})


def resolve_sslmode(database_url, environ):
    query = {key.casefold(): value for key, value in parse_qsl(
        urlsplit(database_url).query, keep_blank_values=True,
    )}
    value = environ.get("DATABASE_SSLMODE", query.get("sslmode"))
    if value is None:
        return None
    mode = str(value).strip().casefold()
    if mode not in SSL_MODES:
        raise ValueError("PostgreSQL sslmode is invalid.")
    return mode
