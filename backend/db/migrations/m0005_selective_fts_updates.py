"""Refresh FTS rows only when indexed identity or text columns change."""


VERSION = 5
NAME = "0005_selective_fts_updates"


_FTS_INDEX_SPECS = {
    "ke_hoach_lcnt": ["ma_ke_hoach", "ten_ke_hoach", "ten_du_an_du_toan"],
    "goi_thau": ["ma_goi_thau", "ten_goi_thau"],
    "chu_dau_tu": ["ma_chu_dau_tu", "ten_chu_dau_tu", "ten_viet_tat", "ma_so_thue"],
    "nha_thau": ["ma_nha_thau", "ten_nha_thau", "ten_viet_tat", "ma_so_thue"],
    "hop_dong": ["so_hop_dong", "ten_hop_dong"],
}


def apply(cursor, context):
    del context
    for table, columns in _FTS_INDEX_SPECS.items():
        fts_table = f"fts_{table}"
        if cursor.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (fts_table,),
        ).fetchone() is None:
            continue

        cols_sql = ", ".join(columns)
        new_cols = ", ".join(f"new.{column}" for column in columns)
        changed_terms = [
            "old.organization_id IS NOT new.organization_id",
            "old.id IS NOT new.id",
            *(f"old.{column} IS NOT new.{column}" for column in columns),
        ]
        cursor.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fts_au")
        cursor.execute(f"""
            CREATE TRIGGER trg_{table}_fts_au AFTER UPDATE ON {table}
            FOR EACH ROW
            WHEN {" OR ".join(changed_terms)}
            BEGIN
                DELETE FROM {fts_table} WHERE rowid = old.rowid;
                INSERT OR REPLACE INTO {fts_table}(rowid, organization_id, id, {cols_sql})
                VALUES (new.rowid, new.organization_id, new.id, {new_cols});
            END
        """)
