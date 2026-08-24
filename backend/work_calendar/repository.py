"""Persistence for stable calendar event revision heads."""

from backend.db.id_utils import generate_record_id
from backend.shared.idempotency import acquire_idempotency_lock


class CalendarRepository:
    def __init__(self, cursor):
        self.cursor = cursor

    def resolve_head(self, organization_id, event_key, uid, payload_hash,
                     source_fingerprint, policy_version, source_type, source_id):
        acquire_idempotency_lock(
            self.cursor, "work_calendar_event", organization_id, event_key
        )
        row = self.cursor.execute(
            """SELECT id, significant_payload_hash, sequence,
                      canonical_revision_at, source_type, source_id
                 FROM calendar_event_head
                WHERE organization_id = ? AND event_key = ? FOR UPDATE""",
            (organization_id, event_key),
        ).fetchone()
        if row and row[4] is not None and (
            str(row[4]) != str(source_type) or str(row[5]) != str(source_id)
        ):
            raise RuntimeError("Calendar event source identity cannot change.")
        if row and row[4] is None:
            self.cursor.execute(
                """UPDATE calendar_event_head SET source_type = ?, source_id = ?
                    WHERE organization_id = ? AND id = ? AND source_type IS NULL""",
                (source_type, source_id, organization_id, row[0]),
            )
        if row and row[1] == payload_hash:
            return {"id": row[0], "sequence": int(row[2]),
                    "canonicalRevisionAt": row[3]}
        if row:
            sequence = int(row[2]) + 1
            updated = self.cursor.execute(
                """UPDATE calendar_event_head
                      SET significant_payload_hash = ?, sequence = ?,
                          canonical_revision_at = CURRENT_TIMESTAMP,
                          source_fingerprint = ?, policy_version = ?,
                          source_type = ?, source_id = ?,
                          row_version = row_version + 1
                    WHERE organization_id = ? AND id = ?
                RETURNING canonical_revision_at""",
                (payload_hash, sequence, source_fingerprint, policy_version,
                 source_type, source_id,
                 organization_id, row[0]),
            ).fetchone()
            head_id, revision_at = row[0], updated[0]
        else:
            head_id = generate_record_id("calendar-event")
            sequence = 0
            inserted = self.cursor.execute(
                """INSERT INTO calendar_event_head
                     (organization_id, id, event_key, uid,
                      significant_payload_hash, sequence, source_fingerprint,
                      policy_version, source_type, source_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING canonical_revision_at""",
                (organization_id, head_id, event_key, uid, payload_hash,
                 sequence, source_fingerprint, policy_version,
                 source_type, source_id),
            ).fetchone()
            revision_at = inserted[0]
        self.cursor.execute(
            """INSERT INTO calendar_event_revision
                 (organization_id, id, event_head_id, sequence,
                  significant_payload_hash, canonical_revision_at,
                  source_fingerprint, policy_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (organization_id, generate_record_id("calendar-revision"), head_id,
             sequence, payload_hash, revision_at, source_fingerprint,
             policy_version),
        )
        return {"id": head_id, "sequence": sequence,
                "canonicalRevisionAt": revision_at}
