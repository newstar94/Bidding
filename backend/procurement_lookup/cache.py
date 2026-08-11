"""Shared PostgreSQL cache for stable procurement lookup DTOs."""

from __future__ import annotations

import hashlib
import json
import time

from backend.procurement_lookup.domain import LOOKUP_SCHEMA_VERSION


_CACHE_NAMESPACE = "procurement-lookup-v1"


class PostgresProcurementLookupCache:
    """Persist only normalized DTOs in the existing bounded shared cache table."""

    def __init__(
        self,
        *,
        database,
        epoch_clock=time.time,
        max_payload_bytes=512 * 1024,
    ):
        self.database = database
        self.epoch_clock = epoch_clock
        self.max_payload_bytes = max(
            65_536, min(int(max_payload_bytes), 1024 * 1024)
        )

    @staticmethod
    def _cache_key(key):
        if not isinstance(key, tuple) or len(key) != 4:
            raise ValueError("Invalid procurement cache key")
        material = "\0".join((_CACHE_NAMESPACE, *(str(item) for item in key)))
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    @staticmethod
    def _valid_contract(value, key):
        return bool(
            isinstance(value, dict)
            and value.get("schemaVersion") == LOOKUP_SCHEMA_VERSION
            and value.get("kind") == key[1]
            and value.get("canonicalCode") == key[2]
        )

    def get(self, key):
        cache_key = self._cache_key(key)
        connection = self.database.get_connection()
        try:
            row = connection.execute(
                """SELECT result_json FROM partner_lookup_cache
                   WHERE cache_key = ? AND found = 1 AND expires_at > ?""",
                (cache_key, int(self.epoch_clock())),
            ).fetchone()
            if row is None:
                return None
            try:
                value = json.loads(row["result_json"] or "")
            except (TypeError, json.JSONDecodeError):
                return None
            return value if self._valid_contract(value, key) else None
        finally:
            connection.close()

    def put(self, key, value, ttl_seconds):
        if not self._valid_contract(value, key):
            raise ValueError("Invalid procurement cache value")
        serialized = json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        if len(serialized.encode("utf-8")) > self.max_payload_bytes:
            return False
        now = int(self.epoch_clock())
        expires_at = now + max(1, min(int(ttl_seconds), 86400))
        connection = self.database.get_connection()
        try:
            connection.execute(
                """INSERT INTO partner_lookup_cache
                   (cache_key, result_json, found, expires_at, updated_at)
                   VALUES (?, ?, 1, ?, ?)
                   ON CONFLICT (cache_key) DO UPDATE SET
                       result_json = excluded.result_json,
                       found = 1,
                       expires_at = excluded.expires_at,
                       updated_at = excluded.updated_at""",
                (self._cache_key(key), serialized, expires_at, now),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return True
