"""Preserve departed memberships and immutable assignment history."""


VERSION = 8
NAME = "0008_member_offboarding"


def apply(cursor, context):
    columns = {row[1] for row in cursor.execute("PRAGMA table_info(thanh_vien_to_chuc)")}
    if "trang_thai_thanh_vien" not in columns:
        cursor.execute("ALTER TABLE thanh_vien_to_chuc ADD COLUMN trang_thai_thanh_vien TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai_thanh_vien IN ('active', 'left'))")
    if "left_at" not in columns:
        cursor.execute("ALTER TABLE thanh_vien_to_chuc ADD COLUMN left_at TEXT")
    if "left_by" not in columns:
        cursor.execute("ALTER TABLE thanh_vien_to_chuc ADD COLUMN left_by TEXT")
    cursor.execute(
        """CREATE TABLE phan_cong_nhan_su_lich_su (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               organization_id TEXT NOT NULL,
               assignment_id TEXT NOT NULL,
               id_nhan_vien TEXT NOT NULL,
               id_muc_tieu TEXT NOT NULL,
               loai_doi_tuong TEXT NOT NULL CHECK(loai_doi_tuong IN ('kehoach', 'goithau', 'hopdong')),
               assigned_at TEXT,
               ended_at TEXT NOT NULL DEFAULT (datetime('now')),
               ended_by TEXT,
               successor_user_id TEXT,
               reason TEXT NOT NULL DEFAULT 'member_left',
               UNIQUE(organization_id, assignment_id, ended_at)
           )"""
    )
    cursor.execute("CREATE INDEX idx_assignment_history_member ON phan_cong_nhan_su_lich_su (organization_id, id_nhan_vien, ended_at)")
    context.assert_foreign_key_integrity(cursor)
