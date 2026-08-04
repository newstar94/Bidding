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


def _upgrade_to_v27_add_goods_preference(cursor, context):
    """Add auditable goods-preference inputs and authoritative results."""

    bidder_goods_columns = (
        "ma_uu_dai SMALLINT NOT NULL DEFAULT 0 CHECK(ma_uu_dai BETWEEN 0 AND 5)",
        "he_so_uu_dai_goc_bp SMALLINT NOT NULL DEFAULT 0 CHECK(he_so_uu_dai_goc_bp BETWEEN 0 AND 1500)",
        "he_so_cong_uu_dai_bp SMALLINT NOT NULL DEFAULT 0 CHECK(he_so_cong_uu_dai_bp BETWEEN 0 AND 1500)",
        "gia_tri_co_so_sau_giam_gia BIGINT CHECK(gia_tri_co_so_sau_giam_gia IS NULL OR gia_tri_co_so_sau_giam_gia >= 0)",
        "gia_tri_cong_uu_dai BIGINT CHECK(gia_tri_cong_uu_dai IS NULL OR gia_tri_cong_uu_dai >= 0)",
        "thanh_tien_sau_uu_dai BIGINT CHECK(thanh_tien_sau_uu_dai IS NULL OR thanh_tien_sau_uu_dai >= 0)",
        "uu_dai_source_sheet TEXT NOT NULL DEFAULT ''",
        "uu_dai_source_row INTEGER CHECK(uu_dai_source_row IS NULL OR uu_dai_source_row > 0)",
        "uu_dai_match_method TEXT NOT NULL DEFAULT 'no_15a'",
        "uu_dai_match_status TEXT NOT NULL DEFAULT 'matched'",
        "uu_dai_source_payload TEXT NOT NULL DEFAULT ''",
        "uu_dai_manual_override BOOLEAN NOT NULL DEFAULT FALSE",
        "uu_dai_manual_actor_id TEXT",
        "uu_dai_manual_updated_at TIMESTAMPTZ",
        "uu_dai_manual_reason TEXT NOT NULL DEFAULT ''",
        "trang_thai_uu_dai TEXT NOT NULL DEFAULT 'empty'",
    )
    for definition in bidder_goods_columns:
        cursor.execute(
            f"ALTER TABLE hang_hoa_du_thau_nha_thau ADD COLUMN IF NOT EXISTS {definition}"
        )
    opening_columns = (
        "tong_gia_tri_cong_uu_dai BIGINT CHECK(tong_gia_tri_cong_uu_dai IS NULL OR tong_gia_tri_cong_uu_dai >= 0)",
        "gia_so_sanh_sau_uu_dai BIGINT CHECK(gia_so_sanh_sau_uu_dai IS NULL OR gia_so_sanh_sau_uu_dai >= 0)",
        "gia_danh_gia_sau_uu_dai BIGINT CHECK(gia_danh_gia_sau_uu_dai IS NULL OR gia_danh_gia_sau_uu_dai >= 0)",
        "trang_thai_tinh_uu_dai TEXT NOT NULL DEFAULT 'empty'",
        "uu_dai_tinh_luc TIMESTAMPTZ",
        "uu_dai_input_hash TEXT NOT NULL DEFAULT ''",
    )
    for definition in opening_columns:
        cursor.execute(
            f"ALTER TABLE thong_tin_mo_thau ADD COLUMN IF NOT EXISTS {definition}"
        )
    cursor.execute(
        "UPDATE hang_hoa_du_thau_nha_thau SET ma_uu_dai = 0 WHERE ma_uu_dai IS NULL"
    )
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(cursor, ("hang_hoa_du_thau_nha_thau",), if_not_exists=True)
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v28_drop_retired_evaluation_actor_columns(cursor, context):
    """Drop reviewer columns retired by v19 after a loss-prevention preflight."""

    retired_columns = (
        ("vong_danh_gia", "nguoi_cham_id"),
        ("bao_cao_danh_gia_nha_thau", "nguoi_cham_id"),
        ("ket_qua_danh_gia_nha_thau", "nguoi_cham_id"),
    )
    for table_name, column_name in retired_columns:
        preflight_sql = f"SELECT COUNT(*) FROM {table_name} WHERE {column_name} IS NOT NULL"  # noqa: S608 - fixed migration identifiers
        populated = cursor.execute(preflight_sql).fetchone()
        if populated and int(populated[0] or 0) > 0:
            raise RuntimeError(
                f"Cannot drop retired column {table_name}.{column_name}: "
                f"{int(populated[0])} rows still contain legacy reviewer data. "
                "Export or clear those values after taking a verified backup, then retry."
            )

    for table_name, column_name in retired_columns:
        # Deliberately omit CASCADE. An unexpected dependency must stop the
        # migration instead of silently removing another production object.
        cursor.execute(
            f"ALTER TABLE {table_name} DROP COLUMN IF EXISTS {column_name}"
        )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_goi_thau_hang_hoa_lot_fk
           ON goi_thau_hang_hoa (organization_id, phan_lo_id)
           WHERE phan_lo_id IS NOT NULL"""
    )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v29_cover_remaining_foreign_keys(cursor, context):
    """Add child-side indexes for every FK that lacked a usable left prefix."""

    for statement in (
        """CREATE INDEX IF NOT EXISTS idx_bidder_goods_lot_fk
           ON hang_hoa_du_thau_nha_thau (organization_id, phan_lo_id)
           WHERE phan_lo_id IS NOT NULL""",
        """CREATE INDEX IF NOT EXISTS idx_bidder_goods_requirement_fk
           ON hang_hoa_du_thau_nha_thau (organization_id, goi_thau_hang_hoa_id)
           WHERE goi_thau_hang_hoa_id IS NOT NULL""",
        """CREATE INDEX IF NOT EXISTS idx_bidder_goods_manual_actor_fk
           ON hang_hoa_du_thau_nha_thau (uu_dai_manual_actor_id)
           WHERE uu_dai_manual_actor_id IS NOT NULL""",
        """CREATE INDEX IF NOT EXISTS idx_package_documents_batch_fk
           ON tai_lieu_goi_thau (organization_id, evaluation_batch_id)
           WHERE evaluation_batch_id IS NOT NULL""",
    ):
        cursor.execute(statement)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v30_add_tombstone_restore_evidence(cursor, _context):
    """Retain the bounded evidence required by the explicit restore command."""

    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS record_snapshot_json TEXT"
    )
    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS delete_actor_user_id TEXT"
    )
    cursor.execute(
        "ALTER TABLE deleted_records ADD COLUMN IF NOT EXISTS delete_mutation_id TEXT"
    )


def _upgrade_to_v31_add_durable_assets_and_export_scope(cursor, _context):
    """Add crash-safe asset staging and authorization scope for export jobs."""

    for column in (
        "organization_id TEXT",
        "user_id TEXT",
        "package_id TEXT",
        "filename TEXT",
        "content_type TEXT",
        "cancelled_at INTEGER",
    ):
        cursor.execute(
            f"ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS {column}"
        )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS asset_journal (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL CHECK(organization_id != ''),
               client_mutation_id TEXT NOT NULL CHECK(client_mutation_id != ''),
               staging_path TEXT NOT NULL CHECK(staging_path != ''),
               managed_path TEXT NOT NULL CHECK(managed_path != ''),
               sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
               size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
               status TEXT NOT NULL DEFAULT 'staged'
                   CHECK(status IN ('staged', 'promoted', 'failed')),
               attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
               last_error_code TEXT,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE(organization_id, client_mutation_id, managed_path)
           )"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_asset_journal_reconcile
           ON asset_journal (status, created_at, id)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_document_jobs_owner
           ON document_jobs (organization_id, user_id, status, created_at)
           WHERE organization_id IS NOT NULL AND user_id IS NOT NULL"""
    )


def _upgrade_to_v32_add_websocket_delivery_state(cursor, _context):
    """Add retry/dead-letter evidence to the multi-consumer event log."""

    for column in (
        "status TEXT NOT NULL DEFAULT 'pending'",
        "attempt_count INTEGER NOT NULL DEFAULT 0",
        "available_at INTEGER NOT NULL DEFAULT 0",
        "delivered_at INTEGER",
        "last_error_code TEXT",
    ):
        cursor.execute(
            f"ALTER TABLE websocket_events ADD COLUMN IF NOT EXISTS {column}"
        )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_websocket_events_pending
           ON websocket_events (status, available_at, id)
           WHERE status IN ('pending', 'retry')"""
    )


def _upgrade_to_v33_add_effective_timeline_model(cursor, _context):
    """Add stable timeline identities and the tri-state appraisal decision."""

    cursor.execute(
        """ALTER TABLE goi_thau
           ADD COLUMN IF NOT EXISTS yeu_cau_tham_dinh_hsmt_code TEXT
           NOT NULL DEFAULT 'UNDETERMINED'"""
    )
    # These updates only backfill derived columns.  Older local/test databases
    # can contain orphaned workspace rows, and the owner trigger must not turn
    # an unrelated additive migration into a data-write failure.  PostgreSQL
    # rolls DDL back with the migration transaction if the update fails.
    cursor.execute(
        "ALTER TABLE goi_thau DISABLE TRIGGER trg_goi_thau_workspace_owner"
    )
    cursor.execute(
        """UPDATE goi_thau
           SET yeu_cau_tham_dinh_hsmt_code = CASE
             WHEN lower(trim(COALESCE(yeu_cau_tham_dinh_hsmt, ''))) IN ('có', 'co', 'true', '1', 'required') THEN 'REQUIRED'
             WHEN lower(trim(COALESCE(yeu_cau_tham_dinh_hsmt, ''))) IN ('không', 'khong', 'false', '0', 'not_required') THEN 'NOT_REQUIRED'
             ELSE 'UNDETERMINED'
           END"""
    )
    cursor.execute(
        "ALTER TABLE goi_thau ENABLE TRIGGER trg_goi_thau_workspace_owner"
    )
    cursor.execute(
        """ALTER TABLE goi_thau
           DROP CONSTRAINT IF EXISTS goi_thau_yeu_cau_tham_dinh_hsmt_code_check"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau
           ADD CONSTRAINT goi_thau_yeu_cau_tham_dinh_hsmt_code_check
           CHECK (yeu_cau_tham_dinh_hsmt_code IN ('UNDETERMINED', 'REQUIRED', 'NOT_REQUIRED'))"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           ADD COLUMN IF NOT EXISTS milestone_key TEXT NOT NULL DEFAULT ''"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           ADD COLUMN IF NOT EXISTS instance_key TEXT NOT NULL DEFAULT ''"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           ADD COLUMN IF NOT EXISTS source_entity_id TEXT NOT NULL DEFAULT ''"""
    )
    cursor.execute(
        "ALTER TABLE goi_thau_moc_tien_do DISABLE TRIGGER trg_goi_thau_moc_tien_do_workspace_owner"
    )
    cursor.execute(
        """UPDATE goi_thau_moc_tien_do
           SET milestone_key = CASE ma_moc
             WHEN '1.1' THEN 'VALUATION_EVIDENCE'
             WHEN '1.2' THEN 'PLAN_TEAM_ESTABLISHMENT'
             WHEN '1.3' THEN 'COST_ESTIMATE_SUBMISSION'
             WHEN '1.4' THEN 'COST_ESTIMATE_APPROVAL'
             WHEN '1.5' THEN 'PLAN_SUBMISSION'
             WHEN '1.6' THEN 'PLAN_APPROVAL'
             WHEN '1.7' THEN 'COMBINED_COST_PLAN_SUBMISSION'
             WHEN '1.8' THEN 'COMBINED_COST_PLAN_APPROVAL'
             WHEN '2.1' THEN 'PREPARATION_CONSULTANT_INVITATION'
             WHEN '2.2' THEN 'PREPARATION_CONSULTANT_APPLICATION'
             WHEN '2.3' THEN 'PREPARATION_CONSULTANT_CONTRACT_FINALIZATION'
             WHEN '2.4' THEN 'PREPARATION_CONSULTANT_APPOINTMENT_SUBMISSION'
             WHEN '2.5' THEN 'PREPARATION_CONSULTANT_APPOINTMENT'
             WHEN '2.6' THEN 'PREPARATION_CONSULTANT_CONTRACT'
             WHEN '2.7' THEN 'EXPERT_TEAM_ESTABLISHMENT'
             WHEN '2.8' THEN 'E_HSMT_ACCEPTANCE'
             WHEN '2.9' THEN 'EVALUATION_REPORT_ACCEPTANCE'
             WHEN '2.10' THEN 'PREPARATION_CONSULTANT_COMPLETION_VOLUME'
             WHEN '2.11' THEN 'PREPARATION_CONSULTANT_PAYMENT_REQUEST'
             WHEN '2.12' THEN 'PREPARATION_CONSULTANT_LIQUIDATION'
             WHEN '3.1' THEN 'APPRAISAL_CONSULTANT_INVITATION'
             WHEN '3.2' THEN 'APPRAISAL_CONSULTANT_APPLICATION'
             WHEN '3.3' THEN 'APPRAISAL_CONSULTANT_CONTRACT_FINALIZATION'
             WHEN '3.4' THEN 'APPRAISAL_CONSULTANT_APPOINTMENT_SUBMISSION'
             WHEN '3.5' THEN 'APPRAISAL_CONSULTANT_APPOINTMENT'
             WHEN '3.6' THEN 'APPRAISAL_CONSULTANT_CONTRACT'
             WHEN '3.7' THEN 'APPRAISAL_TEAM_ESTABLISHMENT'
             WHEN '3.8' THEN 'E_HSMT_APPRAISAL_ACCEPTANCE'
             WHEN '3.9' THEN 'RESULT_APPRAISAL_ACCEPTANCE'
             WHEN '3.10' THEN 'APPRAISAL_CONSULTANT_COMPLETION_VOLUME'
             WHEN '3.11' THEN 'APPRAISAL_CONSULTANT_PAYMENT_REQUEST'
             WHEN '3.12' THEN 'APPRAISAL_CONSULTANT_LIQUIDATION'
             WHEN '4.1' THEN 'E_HSMT_SUBMISSION'
             WHEN '4.2' THEN 'E_HSMT_APPRAISAL_REPORT'
             WHEN '4.3' THEN 'E_HSMT_APPROVAL'
             WHEN '5.1' THEN 'BID_OPENING_MINUTES'
             WHEN '5.2' THEN 'BID_EVALUATION_REPORT'
             WHEN '5.3' THEN 'TECHNICAL_RESULT_APPRAISAL'
             WHEN '5.4' THEN 'TECHNICAL_QUALIFIED_APPROVAL'
             WHEN '5.5' THEN 'FINANCIAL_OPENING_MINUTES'
             WHEN '5.6' THEN 'FINANCIAL_EVALUATION_REPORT'
             WHEN '5.7' THEN 'DOCUMENT_RECONCILIATION_INVITATION'
             WHEN '5.8' THEN 'DOCUMENT_RECONCILIATION_MINUTES'
             WHEN '5.9' THEN 'CONTRACT_NEGOTIATION'
             WHEN '5.10' THEN 'CONTRACTOR_SELECTION_RESULT_APPRAISAL'
             WHEN '5.11' THEN 'CONTRACTOR_SELECTION_RESULT_APPROVAL'
             WHEN '5.12' THEN 'CONTRACT_AWARD_NOTICE'
             WHEN '5.13' THEN 'CONTRACT_FINALIZATION_MINUTES'
             ELSE CONCAT('LEGACY_', ma_moc)
           END
           WHERE milestone_key = ''"""
    )
    cursor.execute(
        "ALTER TABLE goi_thau_moc_tien_do ENABLE TRIGGER trg_goi_thau_moc_tien_do_workspace_owner"
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           DROP CONSTRAINT IF EXISTS goi_thau_moc_tien_do_organization_id_goi_thau_id_ma_moc_key"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           DROP CONSTRAINT IF EXISTS goi_thau_moc_tien_do_sort_order_check"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau_moc_tien_do
           ADD CONSTRAINT goi_thau_moc_tien_do_sort_order_check
           CHECK (sort_order BETWEEN 0 AND 9999)"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_goi_thau_moc_tien_do_stable
           ON goi_thau_moc_tien_do (organization_id, goi_thau_id, milestone_key, instance_key)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS goi_thau_dieu_chinh_hsmt (
           id TEXT PRIMARY KEY,
           organization_id TEXT NOT NULL,
           owner_type TEXT NOT NULL DEFAULT 'organization' CHECK (owner_type IN ('organization', 'personal')),
           goi_thau_id TEXT NOT NULL,
           sequence INTEGER NOT NULL CHECK (sequence > 0),
           reason TEXT NOT NULL DEFAULT '',
           submission_number TEXT NOT NULL DEFAULT '',
           submission_date DATE,
           appraisal_report_number TEXT NOT NULL DEFAULT '',
           appraisal_report_date DATE,
           approval_decision_number TEXT NOT NULL DEFAULT '',
           approval_decision_date DATE,
           published_at TIMESTAMPTZ,
           archived_at TIMESTAMPTZ,
           created_by_id TEXT,
           updated_by_id TEXT,
           sync_version INTEGER NOT NULL DEFAULT 0,
           row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
           created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
           CONSTRAINT goi_thau_dieu_chinh_hsmt_package_fk
             FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE,
           CONSTRAINT goi_thau_dieu_chinh_hsmt_created_by_fk
             FOREIGN KEY (created_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL,
           CONSTRAINT goi_thau_dieu_chinh_hsmt_updated_by_fk
             FOREIGN KEY (updated_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL,
           CONSTRAINT goi_thau_dieu_chinh_hsmt_sequence_unique
             UNIQUE (organization_id, goi_thau_id, sequence)
        )"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_goi_thau_dieu_chinh_hsmt_package
           ON goi_thau_dieu_chinh_hsmt (organization_id, goi_thau_id, sequence)"""
    )


def _upgrade_to_v34_index_ehsmt_adjustment_actors(cursor, _context):
    """Cover adjustment audit-actor foreign keys on existing databases."""

    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_goi_thau_dieu_chinh_hsmt_created_by
           ON goi_thau_dieu_chinh_hsmt (created_by_id)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_goi_thau_dieu_chinh_hsmt_updated_by
           ON goi_thau_dieu_chinh_hsmt (updated_by_id)"""
    )


def _upgrade_to_v35_sparse_word_mapping_overrides(cursor, context):
    """Replace per-scope Word defaults with shared defaults plus sparse overrides."""

    if context.build_create_table_sql is None:
        raise RuntimeError(
            "Database upgrade v35 requires the canonical table builder."
        )
    from backend.db.schema import SCHEMA_DINH_NGHIA
    from backend.documents.word_mapping_registry import migrate_seeded_word_mappings

    cursor.execute(
        context.build_create_table_sql(
            "word_mapping_overrides",
            SCHEMA_DINH_NGHIA["word_mapping_overrides"],
        )
    )
    migrate_seeded_word_mappings(cursor)


def _upgrade_to_v36_persist_canonical_lot_codes(cursor, _context):
    """Backfill canonical lot codes and index the stored representation."""

    from backend.shared.text_utils import normalize_lot_code

    def value(row, name, position):
        if hasattr(row, "keys") and name in row.keys():
            return row[name]
        return row[position]

    lot_rows = cursor.execute(
        """SELECT id, organization_id, goi_thau_id, ma_phan_lo, archived_at
           FROM goi_thau_phan_lo"""
    ).fetchall()
    opening_rows = cursor.execute(
        """SELECT id, organization_id, goi_thau_id, nha_thau_id,
                  ma_phan_lo, archived_at
           FROM thong_tin_mo_thau"""
    ).fetchall()

    collisions = []
    seen_lots = {}
    for row in lot_rows:
        normalized = normalize_lot_code(value(row, "ma_phan_lo", 3))
        if value(row, "archived_at", 4) is not None or not normalized:
            continue
        key = (
            str(value(row, "organization_id", 1)),
            str(value(row, "goi_thau_id", 2)),
            normalized,
        )
        previous = seen_lots.setdefault(key, str(value(row, "id", 0)))
        if previous != str(value(row, "id", 0)):
            collisions.append(("goi_thau_phan_lo", previous, str(value(row, "id", 0))))

    seen_openings = {}
    for row in opening_rows:
        normalized = normalize_lot_code(value(row, "ma_phan_lo", 4))
        if value(row, "archived_at", 5) is not None:
            continue
        key = (
            str(value(row, "organization_id", 1)),
            str(value(row, "goi_thau_id", 2)),
            str(value(row, "nha_thau_id", 3)),
            normalized,
        )
        previous = seen_openings.setdefault(key, str(value(row, "id", 0)))
        if previous != str(value(row, "id", 0)):
            collisions.append(("thong_tin_mo_thau", previous, str(value(row, "id", 0))))

    if collisions:
        tables = ", ".join(sorted({item[0] for item in collisions}))
        raise RuntimeError(
            "Canonical lot-code migration found active-key collisions in "
            f"{tables}; resolve duplicates before retrying schema upgrade."
        )

    cursor.execute(
        """ALTER TABLE goi_thau_phan_lo
           ADD COLUMN IF NOT EXISTS ma_phan_lo_normalized TEXT"""
    )
    cursor.execute(
        """ALTER TABLE thong_tin_mo_thau
           ADD COLUMN IF NOT EXISTS ma_phan_lo_normalized TEXT"""
    )
    cursor.executemany(
        "UPDATE goi_thau_phan_lo SET ma_phan_lo_normalized = ? WHERE id = ?",
        [
            (normalize_lot_code(value(row, "ma_phan_lo", 3)), value(row, "id", 0))
            for row in lot_rows
        ],
    )
    cursor.executemany(
        "UPDATE thong_tin_mo_thau SET ma_phan_lo_normalized = ? WHERE id = ?",
        [
            (normalize_lot_code(value(row, "ma_phan_lo", 4)), value(row, "id", 0))
            for row in opening_rows
        ],
    )
    for table_name in ("goi_thau_phan_lo", "thong_tin_mo_thau"):
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ALTER COLUMN ma_phan_lo_normalized SET DEFAULT ''"""
        )
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ALTER COLUMN ma_phan_lo_normalized SET NOT NULL"""
        )
    cursor.execute("DROP INDEX IF EXISTS idx_goi_thau_phan_lo_active_code")
    cursor.execute(
        """CREATE UNIQUE INDEX idx_goi_thau_phan_lo_active_code
           ON goi_thau_phan_lo (
               organization_id, goi_thau_id, ma_phan_lo_normalized
           ) WHERE archived_at IS NULL AND ma_phan_lo_normalized <> ''"""
    )
    cursor.execute(
        "DROP INDEX IF EXISTS idx_thong_tin_mo_thau_active_business_key"
    )
    cursor.execute(
        """CREATE UNIQUE INDEX idx_thong_tin_mo_thau_active_business_key
           ON thong_tin_mo_thau (
               organization_id, goi_thau_id, nha_thau_id,
               ma_phan_lo_normalized
           ) WHERE archived_at IS NULL"""
    )


def _upgrade_to_v37_add_document_export_capabilities(cursor, _context):
    """Preserve legacy access while allowing new plans to grant formats separately."""

    statements = []
    for column in (
        "document_export_word",
        "document_export_excel",
        "document_export_award_result_excel",
    ):
        statements.extend((
            f"""ALTER TABLE goi_dich_vu
                ADD COLUMN IF NOT EXISTS {column} INTEGER DEFAULT 1""",
            f"UPDATE goi_dich_vu SET {column} = 1 WHERE {column} IS NULL",  # noqa: S608 - column comes from the fixed capability tuple above
            f"""ALTER TABLE goi_dich_vu
                ALTER COLUMN {column} SET DEFAULT 1""",
            f"""ALTER TABLE goi_dich_vu
                ALTER COLUMN {column} SET NOT NULL""",
            f"""ALTER TABLE goi_dich_vu
                DROP CONSTRAINT IF EXISTS goi_dich_vu_{column}_check""",
            f"""ALTER TABLE goi_dich_vu
                ADD CONSTRAINT goi_dich_vu_{column}_check
                CHECK ({column} IN (0, 1))""",
        ))
    for statement in statements:
        cursor.execute(statement)


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
    DatabaseUpgrade(
        27,
        "add_goods_preference",
        _upgrade_to_v27_add_goods_preference,
    ),
    DatabaseUpgrade(
        28,
        "drop_retired_evaluation_actor_columns",
        _upgrade_to_v28_drop_retired_evaluation_actor_columns,
    ),
    DatabaseUpgrade(
        29,
        "cover_remaining_foreign_keys",
        _upgrade_to_v29_cover_remaining_foreign_keys,
    ),
    DatabaseUpgrade(
        30,
        "add_tombstone_restore_evidence",
        _upgrade_to_v30_add_tombstone_restore_evidence,
    ),
    DatabaseUpgrade(
        31,
        "add_durable_assets_and_export_scope",
        _upgrade_to_v31_add_durable_assets_and_export_scope,
    ),
    DatabaseUpgrade(
        32,
        "add_websocket_delivery_state",
        _upgrade_to_v32_add_websocket_delivery_state,
    ),
    DatabaseUpgrade(
        33,
        "add_effective_timeline_model",
        _upgrade_to_v33_add_effective_timeline_model,
    ),
    DatabaseUpgrade(
        34,
        "index_ehsmt_adjustment_actors",
        _upgrade_to_v34_index_ehsmt_adjustment_actors,
    ),
    DatabaseUpgrade(
        35,
        "sparse_word_mapping_overrides",
        _upgrade_to_v35_sparse_word_mapping_overrides,
    ),
    DatabaseUpgrade(
        36,
        "persist_canonical_lot_codes",
        _upgrade_to_v36_persist_canonical_lot_codes,
    ),
    DatabaseUpgrade(
        37,
        "add_document_export_capabilities",
        _upgrade_to_v37_add_document_export_capabilities,
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
