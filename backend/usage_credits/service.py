"""Deep module for FEFO grants and exact-revision usage reservations."""

from __future__ import annotations

import time

from backend.commercial_policy.document import canonical_json
from backend.commercial_policy.errors import (
    CommercialPolicyError,
    DECISION_REQUIRED,
    QUOTA_EXHAUSTED,
)
from backend.commercial_policy.repository import new_id

from .types import (
    FEATURE_PROCUREMENT_SOURCE_FETCH,
    SourceRevisionCandidate,
    UsageOwner,
)


class UsageCreditService:
    """Reserve before an external fetch and consume only after snapshot commit.

    The caller owns the surrounding transaction. All mutating methods lock grants
    before changing counters, so the database remains the concurrency authority.
    """

    DEFAULT_LEASE_SECONDS = 15 * 60

    def __init__(self, cursor, *, clock=None):
        self.cursor = cursor
        self.clock = clock or time.time

    @staticmethod
    def _owner_clause(owner):
        if owner.kind == "account":
            return "account_user_id = ? AND organization_id IS NULL", (owner.identifier,)
        return "organization_id = ? AND account_user_id IS NULL", (owner.identifier,)

    def get_balance(self, owner, feature=FEATURE_PROCUREMENT_SOURCE_FETCH, *, at=None):
        owner = owner if isinstance(owner, UsageOwner) else UsageOwner(**owner)
        if feature != FEATURE_PROCUREMENT_SOURCE_FETCH:
            raise ValueError("Unsupported usage feature.")
        now = int(self.clock() if at is None else at)
        clause, parameters = self._owner_clause(owner)
        row = self.cursor.execute(
            f"""SELECT COALESCE(SUM(total), 0),
                       COALESCE(SUM(remaining), 0),
                       COALESCE(SUM(reserved), 0), MIN(expires_at)
                  FROM usage_credit_grants
                 WHERE {clause} AND owner_kind = ? AND feature = ?
                   AND expires_at > ? AND remaining > 0""",  # noqa: S608 - clause is generated from fixed owner kinds
            (*parameters, owner.kind, feature, now),
        ).fetchone()
        total = int(row[0] or 0) if row else 0
        remaining = int(row[1] or 0) if row else 0
        reserved = int(row[2] or 0) if row else 0
        return {
            "ownerKind": owner.kind,
            "ownerId": owner.identifier,
            "feature": feature,
            "total": total,
            "used": max(0, total - remaining),
            "remaining": remaining,
            "reserved": reserved,
            "available": max(0, remaining - reserved),
            "nextExpiryAt": int(row[3]) if row and row[3] is not None else None,
        }

    def grant(
        self,
        owner,
        quantity,
        *,
        source,
        release_id,
        policy_checksum,
        issued_at,
        expires_at,
        order_item_id=None,
        metadata=None,
    ):
        owner = owner if isinstance(owner, UsageOwner) else UsageOwner(**owner)
        quantity = int(quantity)
        issued_at = int(issued_at)
        expires_at = int(expires_at)
        if quantity <= 0 or expires_at <= issued_at:
            raise ValueError("Invalid usage grant quantity or expiry.")
        if source not in {"plan", "purchase", "admin"}:
            raise ValueError("Invalid usage grant source.")
        if len(str(policy_checksum)) != 64:
            raise ValueError("Invalid usage policy checksum.")
        grant_id = new_id("usage-grant")
        self.cursor.execute(
            """INSERT INTO usage_credit_grants
                   (id, account_user_id, organization_id, owner_kind, feature,
                    total, remaining, reserved, source, order_item_id,
                    release_id, policy_checksum, issued_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
            (
                grant_id,
                owner.account_user_id,
                owner.organization_id,
                owner.kind,
                FEATURE_PROCUREMENT_SOURCE_FETCH,
                quantity,
                quantity,
                source,
                order_item_id,
                str(release_id),
                str(policy_checksum),
                issued_at,
                expires_at,
            ),
        )
        self._ledger(grant_id, None, "grant", quantity, quantity, metadata or {})
        return grant_id

    def list_missing_source_revisions(self, candidates, authoritative_identity_exists):
        """Normalize, deduplicate and remove revisions already held authoritatively."""

        unique = {}
        for value in candidates or []:
            candidate = (
                value
                if isinstance(value, SourceRevisionCandidate)
                else SourceRevisionCandidate(**value)
            )
            unique.setdefault(candidate.identity, candidate)
        return [
            candidate
            for candidate in unique.values()
            if not authoritative_identity_exists(candidate)
        ]

    def reserve_source_fetch_batch(
        self,
        owner,
        candidates,
        job_key,
        *,
        partial_batch_policy,
        lease_seconds=DEFAULT_LEASE_SECONDS,
    ):
        owner = owner if isinstance(owner, UsageOwner) else UsageOwner(**owner)
        job_key = str(job_key or "").strip()
        if not job_key or len(job_key) > 200:
            raise ValueError("Invalid usage reservation job key.")
        normalized = self.list_missing_source_revisions(candidates, lambda _item: False)
        if not normalized:
            return []
        policy_kind = str((partial_batch_policy or {}).get("kind") or "")
        if policy_kind == "blocked_decision" and len(normalized) > 1:
            raise CommercialPolicyError(
                DECISION_REQUIRED,
                "Chưa chốt hành vi khi quota chỉ đủ một phần batch.",
                status_code=409,
                details={"decision": "partialBatch"},
            )
        if policy_kind not in {"blocked_decision", "reject_all", "process_affordable_in_stable_order"}:
            raise CommercialPolicyError(
                DECISION_REQUIRED,
                "Policy partial batch không được hỗ trợ.",
                status_code=409,
            )
        existing = []
        pending = []
        for candidate in normalized:
            reservation = self._find_reservation(owner, candidate, lock=True)
            if reservation and reservation["state"] in {"reserved", "consumed"}:
                existing.append(self._reservation_payload(reservation))
            else:
                pending.append((candidate, reservation))
        grants = self._lock_available_grants(owner)
        available = sum(int(row["remaining"]) - int(row["reserved"]) for row in grants)
        if available < len(pending) and policy_kind in {"blocked_decision", "reject_all"}:
            code = DECISION_REQUIRED if policy_kind == "blocked_decision" and len(normalized) > 1 else QUOTA_EXHAUSTED
            raise CommercialPolicyError(
                code,
                "Số dư lượt tra cứu không đủ cho batch đã chọn.",
                status_code=409,
                details={"required": len(pending), "available": available},
            )
        if policy_kind == "process_affordable_in_stable_order":
            pending = pending[:available]
        reservations = list(existing)
        lease_expires_at = int(self.clock()) + max(60, int(lease_seconds))
        grant_index = 0
        for candidate, old_reservation in pending:
            while grant_index < len(grants) and (
                int(grants[grant_index]["remaining"])
                - int(grants[grant_index]["reserved"])
                <= 0
            ):
                grant_index += 1
            if grant_index >= len(grants):
                break
            grant = grants[grant_index]
            grant["reserved"] = int(grant["reserved"]) + 1
            self.cursor.execute(
                "UPDATE usage_credit_grants SET reserved = reserved + 1 WHERE id = ?",
                (grant["id"],),
            )
            if old_reservation:
                reservation_id = old_reservation["id"]
                self.cursor.execute(
                    """UPDATE usage_reservations
                          SET grant_id = ?, state = 'reserved', job_key = ?,
                              lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND state = 'released'""",
                    (grant["id"], job_key, lease_expires_at, reservation_id),
                )
            else:
                reservation_id = new_id("usage-reservation")
                self.cursor.execute(
                    """INSERT INTO usage_reservations
                           (id, account_user_id, organization_id, owner_kind,
                            feature, provider, entity_kind, source_code,
                            source_revision, job_key, grant_id, state,
                            lease_expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)""",
                    (
                        reservation_id,
                        owner.account_user_id,
                        owner.organization_id,
                        owner.kind,
                        FEATURE_PROCUREMENT_SOURCE_FETCH,
                        *candidate.identity,
                        job_key,
                        grant["id"],
                        lease_expires_at,
                    ),
                )
            self._ledger(
                grant["id"], reservation_id, "reserve", -1,
                int(grant["remaining"]) - int(grant["reserved"]),
                {"jobKey": job_key, "candidate": candidate.identity},
            )
            reservations.append({
                "id": reservation_id,
                "state": "reserved",
                "grantId": grant["id"],
                "provider": candidate.provider,
                "entityKind": candidate.entity_kind,
                "sourceCode": candidate.source_code,
                "sourceRevision": candidate.source_revision,
                "leaseExpiresAt": lease_expires_at,
            })
        return reservations

    def consume_reservation_item(self, reservation_id, committed_snapshot):
        reservation = self._get_reservation(reservation_id, lock=True)
        if not reservation:
            raise ValueError("Usage reservation not found.")
        if reservation["state"] == "consumed":
            return self._reservation_payload(reservation)
        if reservation["state"] != "reserved":
            raise CommercialPolicyError(
                QUOTA_EXHAUSTED,
                "Reservation đã được giải phóng; không thể consume.",
                status_code=409,
            )
        if not isinstance(committed_snapshot, dict) or not committed_snapshot.get("id"):
            raise ValueError("Authoritative committed snapshot is required.")
        grant = self._get_grant(reservation["grant_id"], lock=True)
        updated = self.cursor.execute(
            """UPDATE usage_reservations SET state = 'consumed',
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND state = 'reserved'""",
            (reservation_id,),
        )
        if updated.rowcount != 1:
            return self._reservation_payload(self._get_reservation(reservation_id))
        self.cursor.execute(
            """UPDATE usage_credit_grants
                  SET remaining = remaining - 1, reserved = reserved - 1
                WHERE id = ? AND remaining > 0 AND reserved > 0""",
            (grant["id"],),
        )
        self._ledger(
            grant["id"], reservation_id, "consume", -1,
            int(grant["remaining"]) - 1,
            {"snapshotId": str(committed_snapshot["id"])},
        )
        return {**self._reservation_payload(reservation), "state": "consumed"}

    def release_reservation_item(self, reservation_id, reason):
        reservation = self._get_reservation(reservation_id, lock=True)
        if not reservation:
            raise ValueError("Usage reservation not found.")
        if reservation["state"] != "reserved":
            return self._reservation_payload(reservation)
        grant = self._get_grant(reservation["grant_id"], lock=True)
        updated = self.cursor.execute(
            """UPDATE usage_reservations SET state = 'released',
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND state = 'reserved'""",
            (reservation_id,),
        )
        if updated.rowcount == 1:
            self.cursor.execute(
                """UPDATE usage_credit_grants SET reserved = reserved - 1
                    WHERE id = ? AND reserved > 0""",
                (grant["id"],),
            )
            self._ledger(
                grant["id"], reservation_id, "release", 1,
                int(grant["remaining"]) - int(grant["reserved"]) + 1,
                {"reason": str(reason or "unspecified")[:500]},
            )
        return {**self._reservation_payload(reservation), "state": "released"}

    def release_expired_reservations(self, *, limit=100):
        now = int(self.clock())
        rows = self.cursor.execute(
            """SELECT id FROM usage_reservations
                WHERE state = 'reserved' AND lease_expires_at <= ?
                ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED""",
            (now, max(1, min(1000, int(limit)))),
        ).fetchall()
        released = []
        for row in rows:
            reservation_id = row["id"] if hasattr(row, "keys") else row[0]
            released.append(self.release_reservation_item(reservation_id, "lease_expired"))
        return released

    def _lock_available_grants(self, owner):
        clause, parameters = self._owner_clause(owner)
        rows = self.cursor.execute(
            f"""SELECT id, remaining, reserved, expires_at, issued_at
                  FROM usage_credit_grants
                 WHERE {clause} AND owner_kind = ? AND feature = ?
                   AND expires_at > ? AND remaining > reserved
                 ORDER BY expires_at, issued_at, id FOR UPDATE""",  # noqa: S608 - clause is generated from fixed owner kinds
            (*parameters, owner.kind, FEATURE_PROCUREMENT_SOURCE_FETCH, int(self.clock())),
        ).fetchall()
        return [dict(row) for row in rows]

    def _find_reservation(self, owner, candidate, *, lock=False):
        clause, parameters = self._owner_clause(owner)
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            f"""SELECT id, grant_id, state, provider, entity_kind, source_code,
                       source_revision, lease_expires_at
                  FROM usage_reservations
                 WHERE {clause} AND owner_kind = ? AND feature = ?
                   AND provider = ? AND entity_kind = ? AND source_code = ?
                   AND source_revision = ?""" + suffix,  # noqa: S608 - clause and suffix are fixed internal fragments
            (*parameters, owner.kind, FEATURE_PROCUREMENT_SOURCE_FETCH, *candidate.identity),
        ).fetchone()
        return dict(row) if row else None

    def _get_reservation(self, reservation_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            """SELECT id, grant_id, state, provider, entity_kind, source_code,
                      source_revision, lease_expires_at
                 FROM usage_reservations WHERE id = ?""" + suffix,  # noqa: S608 - suffix is a fixed lock clause
            (reservation_id,),
        ).fetchone()
        return dict(row) if row else None

    def _get_grant(self, grant_id, *, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self.cursor.execute(
            "SELECT id, remaining, reserved FROM usage_credit_grants WHERE id = ?" + suffix,  # noqa: S608 - suffix is a fixed lock clause
            (grant_id,),
        ).fetchone()
        if not row:
            raise ValueError("Usage grant not found.")
        return dict(row)

    @staticmethod
    def _reservation_payload(row):
        return {
            "id": row["id"],
            "state": row["state"],
            "grantId": row["grant_id"],
            "provider": row["provider"],
            "entityKind": row["entity_kind"],
            "sourceCode": row["source_code"],
            "sourceRevision": row["source_revision"],
            "leaseExpiresAt": int(row["lease_expires_at"]),
        }

    def _ledger(self, grant_id, reservation_id, entry_type, quantity, balance_after, metadata):
        self.cursor.execute(
            """INSERT INTO usage_ledger
                   (id, grant_id, reservation_id, entry_type, quantity,
                    balance_after, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                new_id("usage-ledger"), grant_id, reservation_id, entry_type,
                int(quantity), int(balance_after), canonical_json(metadata or {}),
            ),
        )
