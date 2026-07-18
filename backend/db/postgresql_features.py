"""PostgreSQL indexes, invariant triggers and Vietnamese search baseline."""


VERSIONED_TABLES = (
    "chu_dau_tu",
    "ke_hoach_lcnt",
    "goi_thau",
    "nha_thau",
    "chuyen_gia",
    "hop_dong",
)
SYNCED_TABLES = VERSIONED_TABLES + (
    "phan_cong_nhan_su",
    "trang_thai_ho_so_giay",
    "thong_tin_mo_thau",
    "ma_tran_phan_quyen",
)
OWNER_TYPED_TABLES = SYNCED_TABLES + ("cau_hinh_bien_word",)
POSTGRESQL_SEARCH_COLUMNS = {
    "ke_hoach_lcnt": ("ma_ke_hoach", "ten_ke_hoach", "ten_du_an_du_toan"),
    "goi_thau": ("ma_goi_thau", "ten_goi_thau"),
    "chu_dau_tu": (
        "ma_chu_dau_tu",
        "ten_chu_dau_tu",
        "ten_viet_tat",
        "ma_so_thue",
    ),
    "nha_thau": ("ma_nha_thau", "ten_nha_thau", "ten_viet_tat", "ma_so_thue"),
    "hop_dong": ("so_hop_dong", "ten_hop_dong"),
}


POSTGRESQL_EXTENSIONS = (
    "CREATE EXTENSION IF NOT EXISTS unaccent;",
    "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
)


POSTGRESQL_FUNCTIONS = (
    """
    CREATE OR REPLACE FUNCTION bidding_immutable_unaccent(value TEXT)
    RETURNS TEXT
    LANGUAGE SQL
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $$ SELECT public.unaccent('public.unaccent', value) $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_lineage_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF TG_OP = 'INSERT' AND (NEW.id_goc IS NULL OR btrim(NEW.id_goc) = '') THEN
            NEW.id_goc := NEW.id;
        ELSIF TG_OP = 'UPDATE'
          AND OLD.id_goc IS NOT NULL
          AND btrim(OLD.id_goc) <> ''
          AND NEW.id_goc IS DISTINCT FROM OLD.id_goc THEN
            RAISE EXCEPTION 'LINEAGE_IMMUTABLE' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_assignment_tenant_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW.loai_doi_tuong NOT IN ('kehoach', 'goithau', 'hopdong')
           OR (NEW.loai_doi_tuong = 'kehoach' AND NOT EXISTS (
                SELECT 1 FROM ke_hoach_lcnt
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
           ))
           OR (NEW.loai_doi_tuong = 'goithau' AND NOT EXISTS (
                SELECT 1 FROM goi_thau
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
           ))
           OR (NEW.loai_doi_tuong = 'hopdong' AND NOT EXISTS (
                SELECT 1 FROM hop_dong
                WHERE organization_id = NEW.organization_id AND id = NEW.id_muc_tieu
           )) THEN
            RAISE EXCEPTION 'ASSIGNMENT_TENANT_MISMATCH' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_evaluation_actor_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW.nguoi_cham_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM thanh_vien_to_chuc
            WHERE organization_id = NEW.organization_id
              AND user_id = NEW.nguoi_cham_id
        ) THEN
            RAISE EXCEPTION 'EVALUATION_ACTOR_TENANT_MISMATCH' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_contract_package_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM hop_dong hd
            JOIN ke_hoach_lcnt hdkh
              ON hdkh.organization_id = hd.organization_id AND hdkh.id = hd.ke_hoach_id
            JOIN goi_thau gt
              ON gt.organization_id = NEW.organization_id AND gt.id = NEW.goi_thau_id
            JOIN ke_hoach_lcnt gtkh
              ON gtkh.organization_id = gt.organization_id AND gtkh.id = gt.ke_hoach_id
            WHERE hd.organization_id = NEW.organization_id
              AND hd.id = NEW.hop_dong_id
              AND hd.archived_at IS NULL
              AND gt.archived_at IS NULL
              AND COALESCE(NULLIF(hdkh.id_goc, ''), hdkh.id)
                  = COALESCE(NULLIF(gtkh.id_goc, ''), gtkh.id)
              AND (
                  hd.co_qd_chi_dinh = 1
                  OR (
                      gt.trang_thai = 'AWARDED'
                      AND gt.nha_thau_trung_thau_id IS NOT NULL
                      AND gt.nha_thau_trung_thau_id = hd.nha_thau_id
                  )
              )
        ) THEN
            RAISE EXCEPTION 'CONTRACT_PACKAGE_BUSINESS_MISMATCH' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_sync_before_update()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE next_version BIGINT;
    BEGIN
        IF OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at
           AND COALESCE(OLD.sync_version, 0) = COALESCE(NEW.sync_version, 0)
           AND NEW.organization_id IS NOT NULL
           AND NEW.organization_id <> '' THEN
            INSERT INTO sync_metadata (organization_id, current_version)
            VALUES (NEW.organization_id, 0)
            ON CONFLICT (organization_id) DO NOTHING;

            UPDATE sync_metadata
            SET current_version = current_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = NEW.organization_id
            RETURNING current_version INTO next_version;

            NEW.updated_at := CURRENT_TIMESTAMP;
            NEW.sync_version := next_version;
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_sync_after_delete()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE next_version BIGINT;
    BEGIN
        IF OLD.organization_id IS NOT NULL AND OLD.organization_id <> '' THEN
            INSERT INTO sync_metadata (organization_id, current_version)
            VALUES (OLD.organization_id, 0)
            ON CONFLICT (organization_id) DO NOTHING;

            UPDATE sync_metadata
            SET current_version = current_version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = OLD.organization_id
            RETURNING current_version INTO next_version;

            INSERT INTO deleted_records (
                table_name, record_id, organization_id, deleted_at, delete_version
            ) VALUES (
                TG_TABLE_NAME, OLD.id, OLD.organization_id, CURRENT_TIMESTAMP, next_version
            )
            ON CONFLICT (organization_id, table_name, record_id) DO UPDATE SET
                deleted_at = EXCLUDED.deleted_at,
                delete_version = GREATEST(
                    COALESCE(deleted_records.delete_version, 0),
                    COALESCE(EXCLUDED.delete_version, 0)
                );
        END IF;
        RETURN OLD;
    END;
    $$;
    """,
    """
    CREATE OR REPLACE FUNCTION bidding_verified_email_change_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD.email_norm IS DISTINCT FROM NEW.email_norm AND NOT EXISTS (
            SELECT 1
            FROM pending_email_changes AS pending
            WHERE pending.user_id = OLD.id
              AND pending.current_email_norm = OLD.email_norm
              AND pending.pending_email_norm = NEW.email_norm
              AND pending.pending_email = NEW.email
              AND pending.verified_at IS NOT NULL
              AND pending.verified_at <= pending.expires_at
              AND EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT < pending.expires_at
        ) THEN
            RAISE EXCEPTION 'verified email change required' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    """,
)


def postgresql_search_expression(table_name):
    columns = POSTGRESQL_SEARCH_COLUMNS.get(table_name)
    if not columns:
        raise ValueError(f"PostgreSQL search is not configured for {table_name!r}.")
    concatenated = " || ' ' || ".join(
        f"COALESCE({column}, '')" for column in columns
    )
    return f"bidding_immutable_unaccent(lower({concatenated}))"


def _deduplicate(statements):
    return list(dict.fromkeys(statement.strip() for statement in statements))


def build_postgresql_indexes():
    statements = []
    for table in VERSIONED_TABLES:
        statements.extend(
            (
                f"CREATE INDEX idx_{table}_owner_updated ON {table} (organization_id, updated_at);",
                f"CREATE INDEX idx_{table}_owner_latest ON {table} (organization_id, is_latest);",
                f"CREATE INDEX idx_{table}_owner_root ON {table} (organization_id, id_goc);",
            )
        )
    for table in SYNCED_TABLES:
        statements.extend(
            (
                f"CREATE INDEX idx_{table}_owner_type_owner ON {table} (owner_type, organization_id);",
                f"CREATE INDEX idx_{table}_owner_sync_version ON {table} (organization_id, sync_version);",
            )
        )
    for table in OWNER_TYPED_TABLES:
        statements.append(
            f"CREATE INDEX idx_{table}_owner_type_owner ON {table} (owner_type, organization_id);"
        )
    for table, date_column in (
        ("ke_hoach_lcnt", "ngay_phe_duyet"),
        ("goi_thau", "ngay_quyet_dinh"),
        ("hop_dong", "ngay_ky"),
    ):
        statements.extend(
            (
                f"CREATE INDEX idx_{table}_latest_date ON {table} (organization_id, is_latest, archived_at, {date_column});",
                f"CREATE INDEX idx_{table}_latest_month ON {table} (organization_id, is_latest, archived_at, (EXTRACT(MONTH FROM {date_column})));",
            )
        )
    for table in ("chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "chuyen_gia", "hop_dong"):
        statements.extend(
            (
                f"CREATE UNIQUE INDEX idx_{table}_unique_version ON {table} (organization_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban);",
                f"CREATE UNIQUE INDEX idx_{table}_unique_latest ON {table} (organization_id, COALESCE(NULLIF(id_goc, ''), id)) WHERE is_latest = 1;",
            )
        )
    statements.extend(
        (
            "CREATE UNIQUE INDEX idx_goi_thau_unique_plan_snapshot_version ON goi_thau (organization_id, COALESCE(NULLIF(id_goc, ''), id), phien_ban, ke_hoach_id);",
            "CREATE UNIQUE INDEX idx_goi_thau_unique_latest ON goi_thau (organization_id, COALESCE(NULLIF(id_goc, ''), id), COALESCE(ke_hoach_id, '')) WHERE is_latest = 1;",
        )
    )
    for table, column in (
        ("chu_dau_tu", "ma_chu_dau_tu"),
        ("chu_dau_tu", "ma_so_thue"),
        ("ke_hoach_lcnt", "ma_ke_hoach"),
        ("nha_thau", "ma_nha_thau"),
        ("nha_thau", "ma_so_thue"),
        ("chuyen_gia", "so_cccd"),
        ("hop_dong", "so_hop_dong"),
    ):
        statements.append(
            f"CREATE UNIQUE INDEX idx_{table}_{column}_owner_latest_unique "
            f"ON {table} (organization_id, lower(btrim({column}))) "
            f"WHERE is_latest = 1 AND {column} IS NOT NULL AND btrim({column}) <> '';"
        )
    statements.extend(
        (
            "CREATE UNIQUE INDEX idx_goi_thau_ma_goi_thau_owner_plan_latest_unique ON goi_thau (organization_id, COALESCE(ke_hoach_id, ''), lower(btrim(ma_goi_thau))) WHERE is_latest = 1 AND ma_goi_thau IS NOT NULL AND btrim(ma_goi_thau) <> '';",
            "CREATE INDEX idx_goi_thau_owner_code_id ON goi_thau (organization_id, ma_goi_thau, id);",
            "CREATE INDEX idx_goi_thau_ke_hoach ON goi_thau (ke_hoach_id);",
            "CREATE INDEX idx_goi_thau_nha_thau_trung ON goi_thau (nha_thau_trung_thau_id);",
            "CREATE INDEX idx_ke_hoach_cong_viec_parent ON ke_hoach_cong_viec (organization_id, ke_hoach_id, loai, sort_order);",
            "CREATE INDEX idx_goi_thau_phan_lo_parent ON goi_thau_phan_lo (organization_id, goi_thau_id, sort_order);",
            "CREATE INDEX idx_goi_thau_tuy_chon_parent ON goi_thau_tuy_chon_mua_them (organization_id, goi_thau_id, sort_order);",
            "CREATE INDEX idx_goi_thau_gia_han_parent ON goi_thau_gia_han (organization_id, goi_thau_id, sort_order);",
            "CREATE INDEX idx_goi_thau_lam_ro_parent ON goi_thau_lam_ro (organization_id, goi_thau_id, loai, sort_order);",
            "CREATE INDEX idx_nha_thau_lien_danh_parent ON nha_thau_lien_danh_thanh_vien (organization_id, nha_thau_id, sort_order);",
            "CREATE INDEX idx_mo_thau_lien_danh_parent ON thong_tin_mo_thau_lien_danh_thanh_vien (organization_id, thong_tin_mo_thau_id, sort_order);",
            "CREATE UNIQUE INDEX idx_nha_thau_lien_danh_one_leader ON nha_thau_lien_danh_thanh_vien (organization_id, nha_thau_id) WHERE vai_tro = 'Đứng đầu liên danh';",
            "CREATE UNIQUE INDEX idx_mo_thau_lien_danh_one_leader ON thong_tin_mo_thau_lien_danh_thanh_vien (organization_id, thong_tin_mo_thau_id) WHERE vai_tro = 'Đứng đầu liên danh';",
            "CREATE INDEX idx_nha_thau_tham_du_mo_thau_bid ON nha_thau_tham_du_mo_thau (organization_id, thong_tin_mo_thau_id);",
            "CREATE INDEX idx_vong_danh_gia_package ON vong_danh_gia (organization_id, goi_thau_id, thu_tu);",
            "CREATE INDEX idx_tieu_chi_danh_gia_round ON tieu_chi_danh_gia (organization_id, vong_danh_gia_id, thu_tu);",
            "CREATE INDEX idx_ket_qua_danh_gia_opening ON ket_qua_danh_gia_nha_thau (organization_id, thong_tin_mo_thau_id);",
            "CREATE INDEX idx_hop_dong_ke_hoach ON hop_dong (ke_hoach_id);",
            "CREATE INDEX idx_hop_dong_chu_dau_tu ON hop_dong (chu_dau_tu_id);",
            "CREATE INDEX idx_hop_dong_nha_thau ON hop_dong (nha_thau_id);",
            "CREATE INDEX idx_hop_dong_goi_thau_owner_hd ON hop_dong_goi_thau (organization_id, hop_dong_id);",
            "CREATE INDEX idx_hop_dong_goi_thau_owner_gt ON hop_dong_goi_thau (organization_id, goi_thau_id);",
            "CREATE INDEX idx_goi_thau_chuyen_gia_owner_gt ON goi_thau_chuyen_gia (organization_id, goi_thau_id, loai);",
            "CREATE INDEX idx_goi_thau_chuyen_gia_owner_cg ON goi_thau_chuyen_gia (organization_id, chuyen_gia_id);",
            "CREATE INDEX idx_thong_tin_mo_thau_goi_thau ON thong_tin_mo_thau (goi_thau_id);",
            "CREATE INDEX idx_thong_tin_mo_thau_nha_thau ON thong_tin_mo_thau (nha_thau_id);",
            "CREATE UNIQUE INDEX idx_thong_tin_mo_thau_active_business_key ON thong_tin_mo_thau (organization_id, goi_thau_id, nha_thau_id, ma_phan_lo) WHERE archived_at IS NULL;",
            "CREATE UNIQUE INDEX idx_phan_cong_owner_target ON phan_cong_nhan_su (organization_id, id_muc_tieu, loai_doi_tuong);",
            "CREATE INDEX idx_auth_sessions_user_active ON auth_sessions (user_id, revoked_at, absolute_expires_at);",
            "CREATE INDEX idx_document_worker_leases_expires ON document_worker_leases (expires_at);",
            "CREATE INDEX idx_auth_sessions_expiry ON auth_sessions (idle_expires_at, absolute_expires_at, revoked_at);",
            "CREATE INDEX idx_dinh_danh_ngoai_user ON dinh_danh_ngoai (user_id);",
            "CREATE INDEX idx_password_reset_user_active ON password_reset_tokens (user_id, used_at, expires_at);",
            "CREATE INDEX idx_password_reset_expires ON password_reset_tokens (expires_at);",
            "CREATE INDEX idx_rate_limit_expires ON rate_limit_buckets (expires_at);",
            "CREATE INDEX idx_thanh_vien_to_chuc_to_chuc ON thanh_vien_to_chuc (organization_id);",
            "CREATE INDEX idx_organization_subscriptions_status_expiry ON organization_subscriptions (status, expires_at);",
            "CREATE INDEX idx_api_idempotency_created ON api_idempotency (created_at);",
            "CREATE INDEX idx_deleted_records_owner_deleted ON deleted_records (organization_id, deleted_at);",
            "CREATE INDEX idx_deleted_records_owner_delete_version ON deleted_records (organization_id, delete_version);",
            "CREATE INDEX idx_deleted_records_owner_table ON deleted_records (organization_id, table_name);",
            "CREATE INDEX idx_sync_mutations_owner_created ON sync_mutations (organization_id, created_at);",
            "CREATE INDEX idx_audit_log_owner_created ON audit_log (organization_id, created_at);",
            "CREATE INDEX idx_audit_log_actor_created ON audit_log (actor_user_id, created_at);",
            "CREATE INDEX idx_audit_log_action_created ON audit_log (action, created_at);",
            "CREATE UNIQUE INDEX idx_deleted_records_unique_record ON deleted_records (organization_id, table_name, record_id);",
            "CREATE INDEX idx_record_edit_ownership_user ON record_edit_ownership (organization_id, user_id, table_name);",
            "CREATE INDEX idx_goi_thau_moc_tien_do_package ON goi_thau_moc_tien_do (organization_id, goi_thau_id, sort_order, ma_moc);",
            "CREATE INDEX idx_goi_thau_moc_tien_do_status ON goi_thau_moc_tien_do (organization_id, trang_thai, ngay_du_kien);",
            "CREATE INDEX idx_pending_email_changes_expiry ON pending_email_changes (expires_at);",
            "CREATE INDEX idx_document_export_capabilities_user ON document_export_capabilities (user_id, organization_id);",
            "CREATE UNIQUE INDEX idx_audit_log_single_successor ON audit_log (previous_hash);",
        )
    )
    for table, columns in POSTGRESQL_SEARCH_COLUMNS.items():
        del columns
        statements.append(
            f"CREATE INDEX idx_{table}_search_trgm ON {table} USING GIN "
            f"({postgresql_search_expression(table)} gin_trgm_ops);"
        )
    return _deduplicate(statements)


def build_postgresql_triggers():
    statements = []
    for table in VERSIONED_TABLES:
        statements.append(
            f"CREATE TRIGGER trg_{table}_lineage_guard BEFORE INSERT OR UPDATE OF id_goc "
            f"ON {table} FOR EACH ROW EXECUTE FUNCTION bidding_lineage_guard();"
        )
    statements.append(
        "CREATE TRIGGER trg_phan_cong_tenant_guard BEFORE INSERT OR UPDATE "
        "ON phan_cong_nhan_su FOR EACH ROW EXECUTE FUNCTION bidding_assignment_tenant_guard();"
    )
    for table in ("vong_danh_gia", "ket_qua_danh_gia_nha_thau"):
        statements.append(
            f"CREATE TRIGGER trg_{table}_actor_guard BEFORE INSERT OR UPDATE OF nguoi_cham_id, organization_id "
            f"ON {table} FOR EACH ROW EXECUTE FUNCTION bidding_evaluation_actor_guard();"
        )
    statements.append(
        "CREATE TRIGGER trg_hop_dong_goi_thau_business_guard BEFORE INSERT OR UPDATE "
        "ON hop_dong_goi_thau FOR EACH ROW EXECUTE FUNCTION bidding_contract_package_guard();"
    )
    for table in SYNCED_TABLES:
        statements.extend(
            (
                f"CREATE TRIGGER trg_{table}_sync_before_update BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION bidding_sync_before_update();",
                f"CREATE TRIGGER trg_{table}_sync_after_delete AFTER DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION bidding_sync_after_delete();",
            )
        )
    statements.append(
        "CREATE TRIGGER trg_tai_khoan_verified_email_update "
        "BEFORE UPDATE OF email, email_norm ON tai_khoan FOR EACH ROW "
        "EXECUTE FUNCTION bidding_verified_email_change_guard();"
    )
    return statements


def build_postgresql_trigger_source_map():
    mapping = {}
    for table in VERSIONED_TABLES:
        target = f"trg_{table}_lineage_guard"
        mapping[f"trg_{table}_lineage_fill"] = target
        mapping[f"trg_{table}_lineage_immutable"] = target
    for table in SYNCED_TABLES:
        mapping[f"trg_{table}_updated_at"] = f"trg_{table}_sync_before_update"
        mapping[f"trg_{table}_deleted_log"] = f"trg_{table}_sync_after_delete"
    for table in POSTGRESQL_SEARCH_COLUMNS:
        for suffix in ("ai", "ad", "au"):
            mapping[f"trg_{table}_fts_{suffix}"] = f"idx_{table}_search_trgm"
    for operation in ("insert", "update"):
        mapping[f"trg_phan_cong_tenant_{operation}"] = "trg_phan_cong_tenant_guard"
        mapping[f"trg_hop_dong_goi_thau_business_{operation}"] = (
            "trg_hop_dong_goi_thau_business_guard"
        )
        for table in ("vong_danh_gia", "ket_qua_danh_gia_nha_thau"):
            mapping[f"trg_{table}_actor_{operation}"] = f"trg_{table}_actor_guard"
    mapping["trg_tai_khoan_verified_email_update"] = (
        "trg_tai_khoan_verified_email_update"
    )
    return mapping
