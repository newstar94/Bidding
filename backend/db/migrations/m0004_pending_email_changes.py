"""Store verified, expiring requests before changing an account email."""


VERSION = 4
NAME = "0004_pending_email_changes"


def apply(cursor, context):
    cursor.execute(
        """
        CREATE TABLE pending_email_changes (
            user_id TEXT PRIMARY KEY,
            current_email_norm TEXT NOT NULL CHECK(current_email_norm != ''),
            pending_email TEXT NOT NULL CHECK(pending_email != ''),
            pending_email_norm TEXT NOT NULL UNIQUE CHECK(pending_email_norm != ''),
            otp_hash TEXT NOT NULL CHECK(otp_hash != ''),
            requested_at INTEGER NOT NULL CHECK(requested_at > 0),
            expires_at INTEGER NOT NULL CHECK(expires_at > requested_at),
            verified_at INTEGER,
            requested_ip TEXT,
            FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE,
            CHECK (pending_email_norm != current_email_norm),
            CHECK (
                verified_at IS NULL
                OR (verified_at >= requested_at AND verified_at <= expires_at)
            )
        )
        """
    )
    cursor.execute(
        """CREATE INDEX idx_pending_email_changes_expiry
           ON pending_email_changes (expires_at)"""
    )
    cursor.execute(
        """
        CREATE TRIGGER trg_tai_khoan_verified_email_update
        BEFORE UPDATE OF email, email_norm ON tai_khoan
        FOR EACH ROW
        WHEN OLD.email_norm IS NOT NEW.email_norm
        BEGIN
            SELECT CASE WHEN NOT EXISTS (
                SELECT 1
                FROM pending_email_changes AS pending
                WHERE pending.user_id = OLD.id
                  AND pending.current_email_norm = OLD.email_norm
                  AND pending.pending_email_norm = NEW.email_norm
                  AND pending.pending_email = NEW.email
                  AND pending.verified_at IS NOT NULL
                  AND pending.verified_at <= pending.expires_at
                  AND CAST(strftime('%s', 'now') AS INTEGER) < pending.expires_at
            ) THEN RAISE(ABORT, 'verified email change required') END;
        END
        """
    )
    context.assert_foreign_key_integrity(cursor)
