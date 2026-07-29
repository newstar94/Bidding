"""Single-file registry for database upgrades after the clean schema baseline.

Fresh installations are created directly from ``backend.db.schema`` at the
latest registered version without replaying historical upgrades.
When a future release changes persisted data, add one upgrade function here and
append a ``DatabaseUpgrade`` entry to ``UPGRADES``. Upgrade versions must remain
contiguous and must never be rewritten after release.
"""

from dataclasses import dataclass
import uuid


BASELINE_SCHEMA_VERSION = 1
BASELINE_NAME = "canonical_schema"


@dataclass(frozen=True)
class DatabaseUpgrade:
    version: int
    name: str
    apply: object


@dataclass(frozen=True)
class DatabaseUpgradeContext:
    build_create_table_sql: object
    create_indexes_and_triggers: object
    assert_foreign_key_integrity: object
    create_foreign_keys: object = None


def _upgrade_to_v2_remove_mfa(cursor, context):
    """Remove persisted state belonging to the retired MFA feature."""

    del context
    cursor.execute("DROP TABLE IF EXISTS account_mfa")
    cursor.execute(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    )


def _upgrade_to_v3_reconcile_retired_mfa_schema(cursor, context):
    """Repair installations that recorded v2 before MFA cleanup completed.

    Released upgrade versions are immutable.  A database can therefore report
    v2 while still carrying the retired objects.  Repeating this idempotent
    cleanup in v3 repairs that state while preserving strict drift detection.
    """

    del context
    cursor.execute("DROP TABLE IF EXISTS account_mfa")
    cursor.execute(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    )


def _upgrade_to_v4_enforce_single_active_session(cursor, context):
    """Keep the newest session and enforce one active session per account."""

    del context
    cursor.execute(
        """
        WITH ranked_sessions AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id
                       ORDER BY created_at DESC, id DESC
                   ) AS active_rank
            FROM auth_sessions
            WHERE revoked_at IS NULL
        )
        UPDATE auth_sessions AS sessions
        SET revoked_at = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT
        FROM ranked_sessions AS ranked
        WHERE sessions.id = ranked.id AND ranked.active_rank > 1
        """
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS
           idx_auth_sessions_one_active_per_user
           ON auth_sessions (user_id)
           WHERE revoked_at IS NULL"""
    )


def _upgrade_to_v5_add_package_expert_updated_at(cursor, context):
    """Add the timestamp written by package expert relation upserts."""

    del context
    cursor.execute(
        """ALTER TABLE goi_thau_chuyen_gia
           ADD COLUMN IF NOT EXISTS updated_at
           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"""
    )


def _upgrade_to_v6_reconcile_record_ownership_constraint(cursor, context):
    """Reconcile the creator-lineage compatibility constraint from v6.

    Version 6 was already applied to some installations. The lineage table is
    retained for compatibility, while authorization still enforces manager-only
    deletion and assignment-scoped employee edits.
    """

    del context
    cursor.execute(
        """ALTER TABLE record_edit_ownership
           DROP CONSTRAINT IF EXISTS record_edit_ownership_table_name_check"""
    )
    cursor.execute(
        """ALTER TABLE record_edit_ownership
           ADD CONSTRAINT record_edit_ownership_table_name_check
           CHECK (table_name IN (
               'chu_dau_tu', 'ke_hoach_lcnt', 'goi_thau',
               'thong_tin_mo_thau', 'hop_dong', 'nha_thau', 'chuyen_gia'
           ))"""
    )


def _upgrade_to_v7_add_user_notifications(cursor, context):
    """Add transactional in-app notifications and general notification email."""

    del context
    cursor.execute(
        """ALTER TABLE email_delivery_status
           DROP CONSTRAINT IF EXISTS email_delivery_status_purpose_check"""
    )
    cursor.execute(
        """ALTER TABLE email_delivery_status
           ADD CONSTRAINT email_delivery_status_purpose_check
           CHECK (purpose IN ('google_temporary_password', 'user_notification'))"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS user_notifications (
               id TEXT PRIMARY KEY,
               user_id TEXT NOT NULL,
               organization_id TEXT,
               kind TEXT NOT NULL CHECK(kind IN (
                   'assignment_added', 'assignment_removed',
                   'organization_added', 'organization_removed'
               )),
               severity TEXT NOT NULL DEFAULT 'info'
                   CHECK(severity IN ('info', 'warning')),
               title TEXT NOT NULL CHECK(trim(title) != ''),
               message TEXT NOT NULL CHECK(trim(message) != ''),
               target_type TEXT CHECK(
                   target_type IS NULL OR target_type IN ('goithau', 'hopdong')
               ),
               target_id TEXT,
               route TEXT,
               read_at BIGINT,
               created_at BIGINT NOT NULL CHECK(created_at > 0),
               CONSTRAINT fk_user_notifications_user
                   FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
           )"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
           ON user_notifications (user_id, created_at DESC)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
           ON user_notifications (user_id, created_at DESC)
           WHERE read_at IS NULL"""
    )


def _upgrade_to_v8_add_session_active_role(cursor, context):
    """Persist the role mode selected in the current authenticated session."""

    del context
    cursor.execute(
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS active_role TEXT"
    )
    cursor.execute(
        """ALTER TABLE auth_sessions
           DROP CONSTRAINT IF EXISTS auth_sessions_active_role_check"""
    )
    cursor.execute(
        """ALTER TABLE auth_sessions
           ADD CONSTRAINT auth_sessions_active_role_check
           CHECK(active_role IS NULL OR active_role IN (
               'super_admin', 'manager', 'employee'
           ))"""
    )


def _upgrade_to_v9_normalize_package_technical_weight(cursor, context):
    """Remove technical weights from evaluation methods that do not use them."""

    del context
    cursor.execute(
        """UPDATE goi_thau
           SET trong_so_ky_thuat = NULL
           WHERE trong_so_ky_thuat IS NOT NULL
             AND COALESCE(TRIM(phuong_phap_danh_gia), '')
                 <> 'Kết hợp giữa kỹ thuật và giá'"""
    )


def _upgrade_to_v10_add_plan_submission_numbers(cursor, context):
    """Persist the submission document numbers used by plan approval flows."""

    del context
    cursor.execute(
        "ALTER TABLE ke_hoach_lcnt ADD COLUMN IF NOT EXISTS so_to_trinh_du_toan TEXT"
    )
    cursor.execute(
        "ALTER TABLE ke_hoach_lcnt ADD COLUMN IF NOT EXISTS so_to_trinh_ke_hoach TEXT"
    )
    cursor.execute(
        """ALTER TABLE ke_hoach_lcnt
           ADD COLUMN IF NOT EXISTS so_to_trinh_du_toan_ke_hoach TEXT"""
    )


def _upgrade_to_v11_replace_paper_status_with_contract_catalog(cursor, context):
    """Reconcile an older database with the fresh-install status model."""

    del context
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS danh_muc_trang_thai_hop_dong (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL CHECK(organization_id != ''),
               owner_type TEXT NOT NULL DEFAULT 'organization'
                   CHECK(owner_type IN ('organization', 'personal')),
               name TEXT NOT NULL CHECK(trim(name) != ''),
               color TEXT NOT NULL DEFAULT '#64748B'
                   CHECK(color ~ '^#[0-9A-Fa-f]{6}$'),
               sync_version BIGINT NOT NULL DEFAULT 0,
               row_version BIGINT NOT NULL DEFAULT 1 CHECK(row_version >= 1),
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE(organization_id, name)
           )"""
    )
    cursor.execute(
        """INSERT INTO danh_muc_trang_thai_hop_dong
               (id, organization_id, owner_type, name, color)
           SELECT 'tthd-' || md5(org.organization_id || ':' || status.name),
                  org.organization_id,
                  CASE WHEN org.organization_id LIKE '__personal__:%'
                       THEN 'personal' ELSE 'organization' END,
                  status.name,
                  status.color
           FROM (
               SELECT id AS organization_id FROM to_chuc
               UNION
               SELECT DISTINCT organization_id FROM hop_dong
           ) AS org
           CROSS JOIN (VALUES
               ('Chưa hiệu lực', '#64748B'),
               ('Đang thực hiện', '#2563EB'),
               ('Tạm dừng', '#D97706'),
               ('Đã hoàn thành', '#059669'),
               ('Đã thanh lý', '#0F766E'),
               ('Đã hủy', '#DC2626')
           ) AS status(name, color)
           ON CONFLICT (organization_id, name) DO NOTHING"""
    )
    cursor.execute(
        """DO $$
           DECLARE item RECORD;
           BEGIN
             FOR item IN
               SELECT conname FROM pg_constraint
               WHERE conrelid = 'hop_dong'::regclass
                 AND (pg_get_constraintdef(oid) ILIKE '%trang_thai_hop_dong%'
                      OR pg_get_constraintdef(oid) ILIKE '%trang_thai_ho_so%')
             LOOP
               EXECUTE format('ALTER TABLE hop_dong DROP CONSTRAINT IF EXISTS %I', item.conname);
             END LOOP;
           END $$"""
    )
    cursor.execute(
        """UPDATE hop_dong SET trang_thai_hop_dong = CASE trang_thai_hop_dong
               WHEN 'NOT_EFFECTIVE' THEN 'Chưa hiệu lực'
               WHEN 'ACTIVE' THEN 'Đang thực hiện'
               WHEN 'SUSPENDED' THEN 'Tạm dừng'
               WHEN 'COMPLETED' THEN 'Đã hoàn thành'
               WHEN 'LIQUIDATED' THEN 'Đã thanh lý'
               WHEN 'CANCELLED' THEN 'Đã hủy'
               ELSE COALESCE(NULLIF(trim(trang_thai_hop_dong), ''), 'Đang thực hiện')
           END"""
    )
    cursor.execute("ALTER TABLE hop_dong DROP COLUMN IF EXISTS trang_thai_ho_so CASCADE")
    cursor.execute("ALTER TABLE hop_dong ALTER COLUMN trang_thai_hop_dong SET DEFAULT 'Đang thực hiện'")
    cursor.execute(
        """ALTER TABLE hop_dong
           ADD CONSTRAINT hop_dong_contract_status_fk
           FOREIGN KEY (organization_id, trang_thai_hop_dong)
           REFERENCES danh_muc_trang_thai_hop_dong(organization_id, name)
           ON UPDATE CASCADE ON DELETE RESTRICT"""
    )
    cursor.execute("DROP TABLE IF EXISTS trang_thai_ho_so_giay CASCADE")
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_hop_dong_trang_thai
           ON hop_dong (organization_id, trang_thai_hop_dong)"""
    )


def _upgrade_to_v12_add_lot_selection_lifecycle(cursor, context):
    """Add stable lot identity and the lot-scoped selection lifecycle."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v12 requires the canonical table builder.")

    cursor.execute(
        """ALTER TABLE goi_thau_phan_lo
           ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_phan_lo
           ADD COLUMN IF NOT EXISTS row_version BIGINT NOT NULL DEFAULT 1
           CHECK(row_version > 0)"""
    )
    cursor.execute(
        """DO $$
           DECLARE item RECORD;
           BEGIN
             FOR item IN
               SELECT conname FROM pg_constraint
               WHERE conrelid = 'goi_thau'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) ILIKE '%AWARDED%'
                 AND pg_get_constraintdef(oid) ILIKE '%nha_thau_trung_thau_id%'
             LOOP
               EXECUTE format(
                   'ALTER TABLE goi_thau DROP CONSTRAINT IF EXISTS %I',
                   item.conname
               );
             END LOOP;
           END $$"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau
           ADD CONSTRAINT goi_thau_awarded_result_check
           CHECK(
               trang_thai != 'AWARDED'
               OR (
                   gia_trung_thau IS NOT NULL
                   AND so_quyet_dinh_ket_qua IS NOT NULL
                   AND trim(so_quyet_dinh_ket_qua) != ''
                   AND ngay_quyet_dinh_ket_qua IS NOT NULL
                   AND (
                       phan_lo = 'Có'
                       OR (
                           nha_thau_trung_thau_id IS NOT NULL
                           AND trim(nha_thau_trung_thau_id) != ''
                       )
                   )
               )
           )"""
    )

    lifecycle_tables = (
        "dot_xu_ly_phan_lo",
        "dot_xu_ly_phan_lo_chi_tiet",
        "nhom_phu_thuoc_phan_lo",
        "nhom_phu_thuoc_phan_lo_thanh_vien",
        "ho_so_nghiep_vu_lcnt",
        "ho_so_nghiep_vu_lcnt_phan_lo",
    )
    for table_name in lifecycle_tables:
        cursor.execute(
            context.build_create_table_sql(
                table_name,
                SCHEMA_DINH_NGHIA[table_name],
            )
        )

    indexes = (
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_phan_lo_active_code
           ON goi_thau_phan_lo (
               organization_id, goi_thau_id, lower(trim(ma_phan_lo))
           ) WHERE archived_at IS NULL AND ma_phan_lo IS NOT NULL
             AND trim(ma_phan_lo) <> ''""",
        """CREATE INDEX IF NOT EXISTS idx_lot_batch_package
           ON dot_xu_ly_phan_lo (organization_id, goi_thau_id, sequence_no)""",
        """CREATE INDEX IF NOT EXISTS idx_lot_batch_created_by
           ON dot_xu_ly_phan_lo (created_by_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lot_batch_detail_batch
           ON dot_xu_ly_phan_lo_chi_tiet (organization_id, batch_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lot_batch_detail_lot
           ON dot_xu_ly_phan_lo_chi_tiet (organization_id, lot_id)""",
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_batch_detail_one_active
           ON dot_xu_ly_phan_lo_chi_tiet (organization_id, lot_id)
           WHERE is_active = 1""",
        """CREATE INDEX IF NOT EXISTS idx_lot_dependency_package
           ON nhom_phu_thuoc_phan_lo (organization_id, goi_thau_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lot_dependency_member_group
           ON nhom_phu_thuoc_phan_lo_thanh_vien
               (organization_id, dependency_group_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lot_dependency_member_lot
           ON nhom_phu_thuoc_phan_lo_thanh_vien
               (organization_id, lot_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lcnt_artifact_batch
           ON ho_so_nghiep_vu_lcnt
               (organization_id, batch_id, artifact_type, revision)""",
        """CREATE INDEX IF NOT EXISTS idx_lcnt_artifact_lot
           ON ho_so_nghiep_vu_lcnt_phan_lo (organization_id, lot_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lcnt_artifact_finalized_by
           ON ho_so_nghiep_vu_lcnt (finalized_by_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lcnt_artifact_voided_by
           ON ho_so_nghiep_vu_lcnt (voided_by_id)""",
        """CREATE INDEX IF NOT EXISTS idx_lcnt_artifact_supersedes
           ON ho_so_nghiep_vu_lcnt (organization_id, supersedes_id)""",
    )
    for statement in indexes:
        cursor.execute(statement)


def _upgrade_to_v13_add_partial_package_result_status(cursor, context):
    """Allow a package status for official results that cover only some lots."""

    cursor.execute(
        """DO $$
           DECLARE item RECORD;
           BEGIN
             FOR item IN
               SELECT conname FROM pg_constraint
               WHERE conrelid = 'goi_thau'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) ILIKE '%trang_thai%'
                 AND pg_get_constraintdef(oid) ILIKE '%PREPARING%'
                 AND pg_get_constraintdef(oid) ILIKE '%CANCELLED%'
             LOOP
               EXECUTE format(
                   'ALTER TABLE goi_thau DROP CONSTRAINT IF EXISTS %I',
                   item.conname
               );
             END LOOP;
           END $$"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau
           ADD CONSTRAINT goi_thau_status_check
           CHECK(trang_thai IN (
               'PREPARING', 'INVITED', 'OPENED', 'EVALUATING',
               'PARTIALLY_AWARDED', 'AWARDED', 'CANCELLED'
           ))"""
    )


def _upgrade_to_v14_reconcile_canonical_schema(cursor, context):
    """Bring databases upgraded through v11/v12 in line with a fresh schema."""

    lifecycle_tables = (
        "dot_xu_ly_phan_lo",
        "dot_xu_ly_phan_lo_chi_tiet",
        "nhom_phu_thuoc_phan_lo",
        "nhom_phu_thuoc_phan_lo_thanh_vien",
        "ho_so_nghiep_vu_lcnt",
        "ho_so_nghiep_vu_lcnt_phan_lo",
    )
    if not callable(context.create_foreign_keys):
        raise RuntimeError(
            "Database upgrade v14 requires the canonical foreign-key builder."
        )
    if not callable(context.create_indexes_and_triggers):
        raise RuntimeError(
            "Database upgrade v14 requires the canonical schema-object builder."
        )

    cursor.execute(
        """UPDATE danh_muc_trang_thai_hop_dong
           SET owner_type = CASE
               WHEN organization_id LIKE 'personal:%'
               THEN 'personal' ELSE 'organization'
           END
           WHERE owner_type IS DISTINCT FROM CASE
               WHEN organization_id LIKE 'personal:%'
               THEN 'personal' ELSE 'organization'
           END"""
    )
    cursor.execute(
        """DO $$
           DECLARE primary_key_name TEXT;
           BEGIN
             SELECT conname INTO primary_key_name
             FROM pg_constraint
             WHERE conrelid = 'danh_muc_trang_thai_hop_dong'::regclass
               AND contype = 'p';
             IF primary_key_name IS NULL
                OR pg_get_constraintdef(
                    (SELECT oid FROM pg_constraint
                     WHERE conrelid = 'danh_muc_trang_thai_hop_dong'::regclass
                       AND conname = primary_key_name)
                ) <> 'PRIMARY KEY (organization_id, id)'
             THEN
               IF primary_key_name IS NOT NULL THEN
                 EXECUTE format(
                     'ALTER TABLE danh_muc_trang_thai_hop_dong DROP CONSTRAINT %I',
                     primary_key_name
                 );
               END IF;
               ALTER TABLE danh_muc_trang_thai_hop_dong
                   ADD CONSTRAINT danh_muc_trang_thai_hop_dong_pkey
                   PRIMARY KEY (organization_id, id);
             END IF;
           END $$"""
    )
    cursor.execute(
        """ALTER TABLE danh_muc_trang_thai_hop_dong
           DROP CONSTRAINT IF EXISTS
               danh_muc_trang_thai_hop_dong_owner_scope_check"""
    )
    cursor.execute(
        """ALTER TABLE danh_muc_trang_thai_hop_dong
           ADD CONSTRAINT danh_muc_trang_thai_hop_dong_owner_scope_check
           CHECK (
               (owner_type = 'personal' AND organization_id LIKE 'personal:%')
               OR
               (owner_type = 'organization'
                AND organization_id NOT LIKE 'personal:%')
           )"""
    )
    context.create_foreign_keys(
        cursor,
        lifecycle_tables,
        if_not_exists=True,
    )
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v15_add_package_documents(cursor, context):
    """Add one current uploaded file per package document type."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v15 requires the canonical table builder.")
    if not callable(context.create_foreign_keys):
        raise RuntimeError("Database upgrade v15 requires the canonical foreign-key builder.")
    create_sql = context.build_create_table_sql(
        "tai_lieu_goi_thau",
        SCHEMA_DINH_NGHIA["tai_lieu_goi_thau"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace(
            "CREATE TABLE",
            "CREATE TABLE IF NOT EXISTS",
            1,
        )
    cursor.execute(create_sql)
    context.create_foreign_keys(
        cursor,
        ("tai_lieu_goi_thau",),
        if_not_exists=True,
    )
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v16_extend_evaluation_criteria(cursor, context):
    """Restore the released additive criterion contract recorded by schema v16."""

    if not callable(context.create_foreign_keys):
        raise RuntimeError("Database upgrade v16 requires the canonical foreign-key builder.")
    cursor.execute(
        """ALTER TABLE tieu_chi_danh_gia
           ADD COLUMN IF NOT EXISTS nhom_danh_gia TEXT NOT NULL DEFAULT 'technical'"""
    )
    cursor.execute(
        """ALTER TABLE tieu_chi_danh_gia
           ADD COLUMN IF NOT EXISTS loai_ket_qua TEXT NOT NULL DEFAULT 'pass_fail'"""
    )
    cursor.execute(
        """ALTER TABLE tieu_chi_danh_gia
           ADD COLUMN IF NOT EXISTS bat_buoc BIGINT NOT NULL DEFAULT 1"""
    )
    cursor.execute(
        """ALTER TABLE tieu_chi_danh_gia
           ADD COLUMN IF NOT EXISTS tieu_chi_cha_id TEXT"""
    )
    for constraint_name, definition in (
        (
            "tieu_chi_danh_gia_nhom_danh_gia_check",
            "nhom_danh_gia IN ('validity', 'capacity', 'technical', 'financial')",
        ),
        (
            "tieu_chi_danh_gia_loai_ket_qua_check",
            "loai_ket_qua IN ('pass_fail', 'score', 'text', 'number')",
        ),
        ("tieu_chi_danh_gia_bat_buoc_check", "bat_buoc IN (0,1)"),
    ):
        cursor.execute(
            f"ALTER TABLE tieu_chi_danh_gia DROP CONSTRAINT IF EXISTS {constraint_name}"
        )
        cursor.execute(
            f"ALTER TABLE tieu_chi_danh_gia ADD CONSTRAINT {constraint_name} CHECK({definition})"
        )
    context.create_foreign_keys(
        cursor,
        ("tieu_chi_danh_gia",),
        if_not_exists=True,
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_tieu_chi_danh_gia_parent
           ON tieu_chi_danh_gia (organization_id, tieu_chi_cha_id)"""
    )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v17_add_detailed_bid_evaluations(cursor, context):
    """Add normalized per-round, per-opening detailed evaluation reports."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v17 requires the canonical table builder.")
    if not callable(context.create_foreign_keys):
        raise RuntimeError("Database upgrade v17 requires the canonical foreign-key builder.")
    tables = (
        "bao_cao_danh_gia_nha_thau",
        "chi_tiet_danh_gia_nha_thau",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name,
            SCHEMA_DINH_NGHIA[table_name],
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
        cursor.execute(create_sql)
    context.create_foreign_keys(cursor, tables, if_not_exists=True)
    for statement in (
        """CREATE INDEX IF NOT EXISTS idx_detailed_evaluation_report_round
           ON bao_cao_danh_gia_nha_thau (organization_id, vong_danh_gia_id)""",
        """CREATE INDEX IF NOT EXISTS idx_detailed_evaluation_report_opening
           ON bao_cao_danh_gia_nha_thau (organization_id, thong_tin_mo_thau_id)""",
        """CREATE INDEX IF NOT EXISTS idx_detailed_evaluation_report_grader
           ON bao_cao_danh_gia_nha_thau (nguoi_cham_id)""",
        """CREATE INDEX IF NOT EXISTS idx_detailed_evaluation_row_report
           ON chi_tiet_danh_gia_nha_thau
              (organization_id, bao_cao_danh_gia_nha_thau_id)""",
        """CREATE INDEX IF NOT EXISTS idx_detailed_evaluation_row_criterion
           ON chi_tiet_danh_gia_nha_thau
              (organization_id, tieu_chi_danh_gia_id)""",
    ):
        cursor.execute(statement)
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v18_add_sync_mutation_request_hash(cursor, context):
    """Bind an idempotency key to the canonical request that first used it."""

    del context
    cursor.execute(
        """ALTER TABLE sync_mutations
           ADD COLUMN IF NOT EXISTS request_hash TEXT"""
    )


def _upgrade_to_v19_retire_evaluation_actor_infrastructure(cursor, context):
    """Stop indexing and validating reviewer identities no longer written by the app."""

    del context
    for statement in (
        "DROP TRIGGER IF EXISTS trg_vong_danh_gia_actor ON vong_danh_gia",
        """DROP TRIGGER IF EXISTS trg_ket_qua_danh_gia_nha_thau_actor
           ON ket_qua_danh_gia_nha_thau""",
        """ALTER TABLE vong_danh_gia
           DROP CONSTRAINT IF EXISTS fk_vong_danh_gia_2_cee96f5c""",
        """ALTER TABLE bao_cao_danh_gia_nha_thau
           DROP CONSTRAINT IF EXISTS fk_bao_cao_danh_gia_nha_thau_3_cee96f5c""",
        """ALTER TABLE ket_qua_danh_gia_nha_thau
           DROP CONSTRAINT IF EXISTS fk_ket_qua_danh_gia_nha_thau_4_cee96f5c""",
        "DROP INDEX IF EXISTS idx_detailed_evaluation_report_grader",
        "DROP INDEX IF EXISTS idx_ket_qua_nguoi_cham",
        "DROP INDEX IF EXISTS idx_vong_danh_gia_nguoi_cham",
        "DROP FUNCTION IF EXISTS bf_validate_evaluation_actor()",
    ):
        cursor.execute(statement)


def _upgrade_to_v20_add_bid_evaluation_prices(cursor, context):
    """Persist ranking and proposed award prices for each evaluated bid."""

    del context
    for statement in (
        """ALTER TABLE ket_qua_danh_gia_nha_thau
           ADD COLUMN IF NOT EXISTS gia_xep_hang BIGINT
           CHECK(gia_xep_hang IS NULL OR gia_xep_hang >= 0)""",
        """ALTER TABLE ket_qua_danh_gia_nha_thau
           ADD COLUMN IF NOT EXISTS gia_de_nghi_trung_thau BIGINT
           CHECK(gia_de_nghi_trung_thau IS NULL OR gia_de_nghi_trung_thau >= 0)""",
    ):
        cursor.execute(statement)


def _upgrade_to_v21_add_low_proposed_award_price_acceptance(cursor, context):
    """Persist the evaluator's decision for a proposed award price below 50%."""

    del context
    cursor.execute(
        """ALTER TABLE ket_qua_danh_gia_nha_thau
           ADD COLUMN IF NOT EXISTS chap_thuan_gia_de_nghi_trung_thau_duoi_50 INTEGER
           CHECK(chap_thuan_gia_de_nghi_trung_thau_duoi_50 IS NULL
                 OR chap_thuan_gia_de_nghi_trung_thau_duoi_50 IN (0, 1))"""
    )


def _upgrade_to_v22_add_package_goods(cursor, context):
    """Add normalized requested-goods rows for goods procurement packages."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "goi_thau_hang_hoa",
        SCHEMA_DINH_NGHIA["goi_thau_hang_hoa"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(cursor, ("goi_thau_hang_hoa",), if_not_exists=True)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_goi_thau_hang_hoa_parent ON goi_thau_hang_hoa (organization_id, goi_thau_id, phan_lo_id, sort_order, id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_hang_hoa_code_no_lot ON goi_thau_hang_hoa (organization_id, goi_thau_id, lower(trim(ma_hang_hoa))) WHERE phan_lo_id IS NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_hang_hoa_code_by_lot ON goi_thau_hang_hoa (organization_id, goi_thau_id, phan_lo_id, lower(trim(ma_hang_hoa))) WHERE phan_lo_id IS NOT NULL",
    ):
        cursor.execute(statement)
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v23_add_bidder_goods(cursor, context):
    """Add normalized goods offered by each opened bid."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "hang_hoa_du_thau_nha_thau",
        SCHEMA_DINH_NGHIA["hang_hoa_du_thau_nha_thau"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("hang_hoa_du_thau_nha_thau",),
            if_not_exists=True,
        )
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_bidder_goods_scope ON hang_hoa_du_thau_nha_thau (organization_id, goi_thau_id, thong_tin_mo_thau_id, phan_lo_id, sort_order, id)",
        "CREATE INDEX IF NOT EXISTS idx_bidder_goods_import_batch ON hang_hoa_du_thau_nha_thau (organization_id, import_batch_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bidder_goods_requirement ON hang_hoa_du_thau_nha_thau (organization_id, thong_tin_mo_thau_id, goi_thau_hang_hoa_id) WHERE goi_thau_hang_hoa_id IS NOT NULL",
    ):
        cursor.execute(statement)
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v24_scope_package_documents_by_evaluation_batch(cursor, context):
    """Keep one document type per package scope or lot-evaluation batch."""

    cursor.execute(
        """ALTER TABLE tai_lieu_goi_thau
           ADD COLUMN IF NOT EXISTS evaluation_batch_id TEXT"""
    )
    cursor.execute(
        """DO $$
           DECLARE item RECORD;
           BEGIN
             FOR item IN
               SELECT conname
               FROM pg_constraint
               WHERE conrelid = 'tai_lieu_goi_thau'::regclass
                 AND contype = 'u'
                 AND pg_get_constraintdef(oid) ILIKE '%organization_id%'
                 AND pg_get_constraintdef(oid) ILIKE '%goi_thau_id%'
                 AND pg_get_constraintdef(oid) ILIKE '%document_type%'
                 AND pg_get_constraintdef(oid) NOT ILIKE '%evaluation_batch_id%'
             LOOP
               EXECUTE format(
                   'ALTER TABLE tai_lieu_goi_thau DROP CONSTRAINT IF EXISTS %I',
                   item.conname
               );
             END LOOP;
           END $$"""
    )
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("tai_lieu_goi_thau",),
            if_not_exists=True,
        )
    for statement in (
        "DROP INDEX IF EXISTS idx_package_documents_package",
        "CREATE INDEX idx_package_documents_package ON tai_lieu_goi_thau (organization_id, goi_thau_id, evaluation_batch_id, document_type)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_package_documents_general_type ON tai_lieu_goi_thau (organization_id, goi_thau_id, document_type) WHERE evaluation_batch_id IS NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_package_documents_batch_type ON tai_lieu_goi_thau (organization_id, goi_thau_id, evaluation_batch_id, document_type) WHERE evaluation_batch_id IS NOT NULL",
    ):
        cursor.execute(statement)
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v25_add_multi_assignee_activity_log(cursor, context):
    """Allow assignment sets and add an immutable user-facing activity log."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    cursor.execute("DROP INDEX IF EXISTS idx_phan_cong_owner_target")
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_phan_cong_owner_target
           ON phan_cong_nhan_su
           (organization_id, id_muc_tieu, loai_doi_tuong, id_nhan_vien)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_phan_cong_owner_assignee
           ON phan_cong_nhan_su
           (organization_id, id_nhan_vien, loai_doi_tuong, id_muc_tieu)"""
    )
    create_sql = context.build_create_table_sql(
        "nhat_ky_thuc_hien",
        SCHEMA_DINH_NGHIA["nhat_ky_thuc_hien"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("nhat_ky_thuc_hien",),
            if_not_exists=True,
        )
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v26_preserve_activity_actor_snapshot(cursor, context):
    """Keep immutable activity rows readable after an account is deleted."""

    cursor.execute(
        """DO $$
           DECLARE item RECORD;
           BEGIN
             FOR item IN
               SELECT conname
               FROM pg_constraint
               WHERE conrelid = 'nhat_ky_thuc_hien'::regclass
                 AND contype = 'f'
                 AND pg_get_constraintdef(oid) ILIKE '%actor_user_id%'
             LOOP
               EXECUTE format(
                   'ALTER TABLE nhat_ky_thuc_hien DROP CONSTRAINT IF EXISTS %I',
                   item.conname
               );
             END LOOP;
           END $$"""
    )
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


UPGRADES = (
    DatabaseUpgrade(2, "remove_mfa", _upgrade_to_v2_remove_mfa),
    DatabaseUpgrade(
        3,
        "reconcile_retired_mfa_schema",
        _upgrade_to_v3_reconcile_retired_mfa_schema,
    ),
    DatabaseUpgrade(
        4,
        "enforce_single_active_session",
        _upgrade_to_v4_enforce_single_active_session,
    ),
    DatabaseUpgrade(
        5,
        "add_package_expert_updated_at",
        _upgrade_to_v5_add_package_expert_updated_at,
    ),
    DatabaseUpgrade(
        6,
        "reconcile_record_ownership_constraint",
        _upgrade_to_v6_reconcile_record_ownership_constraint,
    ),
    DatabaseUpgrade(
        7,
        "add_user_notifications",
        _upgrade_to_v7_add_user_notifications,
    ),
    DatabaseUpgrade(
        8,
        "add_session_active_role",
        _upgrade_to_v8_add_session_active_role,
    ),
    DatabaseUpgrade(
        9,
        "normalize_package_technical_weight",
        _upgrade_to_v9_normalize_package_technical_weight,
    ),
    DatabaseUpgrade(
        10,
        "add_plan_submission_numbers",
        _upgrade_to_v10_add_plan_submission_numbers,
    ),
    DatabaseUpgrade(
        11,
        "replace_paper_status_with_contract_catalog",
        _upgrade_to_v11_replace_paper_status_with_contract_catalog,
    ),
    DatabaseUpgrade(
        12,
        "add_lot_selection_lifecycle",
        _upgrade_to_v12_add_lot_selection_lifecycle,
    ),
    DatabaseUpgrade(
        13,
        "add_partial_package_result_status",
        _upgrade_to_v13_add_partial_package_result_status,
    ),
    DatabaseUpgrade(
        14,
        "reconcile_canonical_schema",
        _upgrade_to_v14_reconcile_canonical_schema,
    ),
    DatabaseUpgrade(
        15,
        "add_package_documents",
        _upgrade_to_v15_add_package_documents,
    ),
    DatabaseUpgrade(
        16,
        "extend_evaluation_criteria",
        _upgrade_to_v16_extend_evaluation_criteria,
    ),
    DatabaseUpgrade(
        17,
        "add_detailed_bid_evaluations",
        _upgrade_to_v17_add_detailed_bid_evaluations,
    ),
    DatabaseUpgrade(
        18,
        "add_sync_mutation_request_hash",
        _upgrade_to_v18_add_sync_mutation_request_hash,
    ),
    DatabaseUpgrade(
        19,
        "retire_evaluation_actor_infrastructure",
        _upgrade_to_v19_retire_evaluation_actor_infrastructure,
    ),
    DatabaseUpgrade(
        20,
        "add_bid_evaluation_prices",
        _upgrade_to_v20_add_bid_evaluation_prices,
    ),
    DatabaseUpgrade(
        21,
        "add_low_proposed_award_price_acceptance",
        _upgrade_to_v21_add_low_proposed_award_price_acceptance,
    ),
    DatabaseUpgrade(
        22,
        "add_package_goods",
        _upgrade_to_v22_add_package_goods,
    ),
    DatabaseUpgrade(
        23,
        "add_bidder_goods",
        _upgrade_to_v23_add_bidder_goods,
    ),
    DatabaseUpgrade(
        24,
        "scope_package_documents_by_evaluation_batch",
        _upgrade_to_v24_scope_package_documents_by_evaluation_batch,
    ),
    DatabaseUpgrade(
        25,
        "add_multi_assignee_activity_log",
        _upgrade_to_v25_add_multi_assignee_activity_log,
    ),
    DatabaseUpgrade(
        26,
        "preserve_activity_actor_snapshot",
        _upgrade_to_v26_preserve_activity_actor_snapshot,
    ),
)


DB_SCHEMA_VERSION = (
    UPGRADES[-1].version if UPGRADES else BASELINE_SCHEMA_VERSION
)


def read_database_version(cursor):
    """Return the installed version, or ``None`` for a database without metadata."""
    metadata_exists = cursor.execute(
        """SELECT 1
           FROM information_schema.tables
           WHERE table_schema = current_schema()
             AND table_name = 'database_metadata'"""
    ).fetchone()
    if not metadata_exists:
        return None
    row = cursor.execute(
        "SELECT schema_version FROM database_metadata WHERE id = 1"
    ).fetchone()
    if not row:
        raise RuntimeError("database_metadata is missing its singleton version row.")
    return int(row[0])


def record_database_version(cursor, version, *, baseline=BASELINE_NAME):
    version = int(version)
    cursor.execute(
        """INSERT INTO database_metadata (id, schema_version, baseline, installation_id)
           VALUES (1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               baseline = excluded.baseline,
               updated_at = CURRENT_TIMESTAMP""",
        (version, baseline, str(uuid.uuid4())),
    )


def apply_database_upgrades(cursor, current_version, context):
    """Apply future upgrades registered in this file inside the caller transaction."""
    current_version = int(current_version)
    if current_version < BASELINE_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported database schema version: {current_version}."
        )
    if current_version > DB_SCHEMA_VERSION:
        raise RuntimeError(
            "Database schema is newer than this application version."
        )

    expected_version = BASELINE_SCHEMA_VERSION + 1
    for upgrade in UPGRADES:
        if upgrade.version != expected_version:
            raise RuntimeError(
                "Database upgrade versions must be contiguous after the baseline."
            )
        expected_version += 1
        if upgrade.version <= current_version:
            continue
        upgrade.apply(cursor, context)
        record_database_version(cursor, upgrade.version)
        current_version = upgrade.version

    if current_version != DB_SCHEMA_VERSION:
        raise RuntimeError(
            f"No upgrade path from schema version {current_version} "
            f"to {DB_SCHEMA_VERSION}."
        )
    return current_version
