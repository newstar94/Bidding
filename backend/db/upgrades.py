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
