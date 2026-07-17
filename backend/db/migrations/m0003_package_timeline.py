"""Add organization-scoped package timeline checklist rows."""


VERSION = 3
NAME = "0003_package_timeline"


def apply(cursor, context):
    cursor.execute(
        """
        CREATE TABLE goi_thau_moc_tien_do (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL CHECK(organization_id != ''),
            owner_type TEXT NOT NULL DEFAULT 'organization'
                CHECK(owner_type IN ('organization', 'personal')),
            goi_thau_id TEXT NOT NULL CHECK(trim(goi_thau_id) != ''),
            ma_nhom TEXT NOT NULL CHECK(ma_nhom IN ('I', 'II', 'III', 'IV', 'V')),
            ten_nhom TEXT NOT NULL CHECK(length(trim(ten_nhom)) BETWEEN 1 AND 160),
            ma_moc TEXT NOT NULL CHECK(length(trim(ma_moc)) BETWEEN 3 AND 10),
            cong_viec TEXT NOT NULL CHECK(length(trim(cong_viec)) BETWEEN 1 AND 300),
            don_vi_ban_hanh TEXT NOT NULL DEFAULT '' CHECK(length(don_vi_ban_hanh) <= 300),
            so_van_ban TEXT NOT NULL DEFAULT '' CHECK(length(so_van_ban) <= 300),
            ngay_du_kien TEXT CHECK(
                ngay_du_kien IS NULL OR
                (length(ngay_du_kien) = 10 AND date(ngay_du_kien) IS NOT NULL)
            ),
            ngay_thuc_te TEXT CHECK(
                ngay_thuc_te IS NULL OR
                (length(ngay_thuc_te) = 10 AND date(ngay_thuc_te) IS NOT NULL)
            ),
            ghi_chu TEXT NOT NULL DEFAULT '' CHECK(length(ghi_chu) <= 2000),
            source_key TEXT NOT NULL DEFAULT '' CHECK(length(source_key) <= 160),
            source_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_mode IN ('AUTO', 'MANUAL')),
            is_optional INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(is_optional) = 'integer' AND is_optional IN (0, 1)),
            trang_thai TEXT NOT NULL DEFAULT 'PENDING'
                CHECK(trang_thai IN ('PENDING', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE')),
            sort_order INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(sort_order) = 'integer' AND sort_order BETWEEN 0 AND 499),
            template_version INTEGER NOT NULL DEFAULT 1
                CHECK(typeof(template_version) = 'integer' AND template_version >= 1),
            sync_version INTEGER NOT NULL DEFAULT 0
                CHECK(typeof(sync_version) = 'integer' AND sync_version >= 0),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(organization_id, id),
            UNIQUE(organization_id, goi_thau_id, ma_moc),
            FOREIGN KEY (organization_id, goi_thau_id)
                REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE
        )
        """
    )
    cursor.execute(
        """CREATE INDEX idx_goi_thau_moc_tien_do_package
           ON goi_thau_moc_tien_do
              (organization_id, goi_thau_id, sort_order, ma_moc)"""
    )
    cursor.execute(
        """CREATE INDEX idx_goi_thau_moc_tien_do_status
           ON goi_thau_moc_tien_do
              (organization_id, trang_thai, ngay_du_kien)"""
    )
    context.assert_foreign_key_integrity(cursor)
