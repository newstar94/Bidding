"""Single-file registry for database upgrades after the clean schema baseline.

Fresh installations are created directly from ``backend.db.schema`` at the
latest registered version without replaying historical upgrades.
When a future release changes persisted data, add one upgrade function here and
append a ``DatabaseUpgrade`` entry to ``UPGRADES``. Upgrade versions must remain
contiguous and must never be rewritten after release.
"""

from dataclasses import dataclass, replace
import uuid


BASELINE_SCHEMA_VERSION = 1
BASELINE_NAME = "canonical_schema"


REQUIRED_POST_V64_FK_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_bulk_operation_actor ON bulk_operation (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_calendar_connection_user ON calendar_connection (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_calendar_delivery_head ON calendar_delivery_outbox (organization_id, event_head_id)",
    "CREATE INDEX IF NOT EXISTS idx_calendar_binding_head ON calendar_event_binding (organization_id, event_head_id)",
    "CREATE INDEX IF NOT EXISTS idx_calendar_oauth_user ON calendar_oauth_state (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_conflict_draft_actor ON conflict_resolution_drafts (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_generated_document_creator ON generated_document_provenance (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_policy_publisher ON legal_applicability_policy_version (published_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_instrument_creator ON legal_instrument (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_instrument_draft_instrument ON legal_instrument_draft (instrument_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_instrument_draft_updater ON legal_instrument_draft (updated_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_instrument_version_publisher ON legal_instrument_version (published_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_profile_creator ON legal_source_profile (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_profile_draft_profile ON legal_source_profile_draft (profile_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_profile_draft_updater ON legal_source_profile_draft (updated_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_profile_member_instrument ON legal_source_profile_member (instrument_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_legal_profile_version_publisher ON legal_source_profile_version (published_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_package_legal_binding_policy ON package_legal_binding (policy_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_package_legal_binding_profile ON package_legal_binding (profile_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_package_legal_binding_creator ON package_legal_binding (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_package_legal_head_current ON package_legal_binding_head (organization_id, current_binding_id)",
    "CREATE INDEX IF NOT EXISTS idx_plan_legal_binding_policy ON plan_legal_binding (policy_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_plan_legal_binding_profile ON plan_legal_binding (profile_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_plan_legal_binding_creator ON plan_legal_binding (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_plan_legal_head_current ON plan_legal_binding_head (organization_id, current_binding_id)",
    "CREATE INDEX IF NOT EXISTS idx_procurement_case_creator ON procurement_case (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_attachment_case ON procurement_case_attachment (organization_id, case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_attachment_revision ON procurement_case_attachment (organization_id, response_revision_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_attachment_creator ON procurement_case_attachment (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_command_case ON procurement_case_command (organization_id, case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_command_actor ON procurement_case_command (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_legal_basis_case ON procurement_case_legal_basis (organization_id, case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_legal_basis_revision ON procurement_case_legal_basis (organization_id, response_revision_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_legal_basis_profile ON procurement_case_legal_basis (profile_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_legal_basis_instrument ON procurement_case_legal_basis (instrument_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_legal_basis_creator ON procurement_case_legal_basis (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_target_current_package ON procurement_case_package_target (organization_id, current_package_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_party_case ON procurement_case_party (organization_id, case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_response_package ON procurement_case_response_revision (organization_id, package_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_response_creator ON procurement_case_response_revision (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_responsibility_case ON procurement_case_responsibility (organization_id, case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_responsibility_user ON procurement_case_responsibility (responsible_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_responsibility_assigner ON procurement_case_responsibility (assigned_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_observation_linked ON procurement_case_source_observation (organization_id, linked_case_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_transition_package ON procurement_case_transition (organization_id, package_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_transition_revision ON procurement_case_transition (organization_id, response_revision_id)",
    "CREATE INDEX IF NOT EXISTS idx_case_transition_actor ON procurement_case_transition (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_assignment_pinned ON word_publication_assignment_v2 (organization_id, pinned_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_template_draft ON word_template (organization_id, draft_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_template_published ON word_template (organization_id, published_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_template_creator ON word_template (created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_assignment_config_updater ON word_template_assignment_config (updated_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_preflight_runner ON word_template_preflight_run (run_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_projection_version ON word_template_projection_outbox (organization_id, template_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_publication_from_version ON word_template_publication_event (organization_id, from_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_publication_to_version ON word_template_publication_event (organization_id, to_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_publication_preflight ON word_template_publication_event (organization_id, accepted_preflight_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_publication_actor ON word_template_publication_event (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_version_source ON word_template_version (organization_id, source_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_word_version_creator ON word_template_version (created_by_id)",
)


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
    create_trigger_functions: object = None
    create_synced_delete_trigger_function: object = None


def _context_for_historical_upgrade(context, version):
    """Restore transient DDL inputs retired from the latest schema registry."""

    if int(version) != 17:
        return context
    canonical_builder = context.build_create_table_sql

    def build_v17_table(table_name, table_spec):
        if table_name != "bao_cao_danh_gia_nha_thau":
            return canonical_builder(table_name, table_spec)
        historical_spec = dict(table_spec)
        historical_spec["columns"] = {
            **table_spec["columns"],
            "nguoi_cham_id": "TEXT",
        }
        return canonical_builder(table_name, historical_spec)

    return replace(context, build_create_table_sql=build_v17_table)


def _prepare_historical_upgrade(cursor, context, version):
    """Create prerequisite tables assumed by released historical upgrades."""

    prerequisites = {
        7: ("email_delivery_status",),
        31: ("document_jobs",),
        45: ("partner_enrichment_jobs",),
    }.get(int(version), ())
    if not prerequisites:
        return
    from backend.db.schema import SCHEMA_DINH_NGHIA

    for table_name in prerequisites:
        exists = cursor.execute(
            "SELECT to_regclass(?) IS NOT NULL",
            (table_name,),
        ).fetchone()
        if exists and bool(exists[0]):
            continue
        cursor.execute(
            context.build_create_table_sql(
                table_name,
                SCHEMA_DINH_NGHIA[table_name],
            )
        )


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
                 NOT IN (
                     'Kết hợp giữa kỹ thuật và giá',
                     'Kết hợp kỹ thuật và giá',
                     'COMBINED_TECHNICAL_PRICE'
                 )"""
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
               ('Đang thực hiện', '#3B82F6'),
               ('Tạm dừng', '#F59E0B'),
               ('Đã hoàn thành', '#22C55E'),
               ('Đã thanh lý', '#14B8A6'),
               ('Đã hủy', '#F43F5E')
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


def _upgrade_to_v38_add_ai_assistant_storage(cursor, context):
    """Add tenant-scoped, read-only AI assistant conversation storage."""

    del context
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_conversations (
               id TEXT NOT NULL,
               organization_id TEXT NOT NULL CHECK(organization_id <> ''),
               user_id TEXT NOT NULL,
               mode TEXT NOT NULL CHECK(mode IN ('data', 'procurement_advice', 'app_help')),
               title TEXT,
               status TEXT NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active', 'deleted')),
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               deleted_at TIMESTAMPTZ,
               PRIMARY KEY (organization_id, id),
               CONSTRAINT ai_conversations_lifecycle_check CHECK(
                   (status = 'active' AND deleted_at IS NULL)
                   OR (status = 'deleted' AND deleted_at IS NOT NULL)
               ),
               CONSTRAINT ai_conversations_user_fk
                   FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
           )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_messages (
               id TEXT NOT NULL,
               organization_id TEXT NOT NULL CHECK(organization_id <> ''),
               conversation_id TEXT NOT NULL,
               role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
               content TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'completed'
                   CHECK(status IN ('pending', 'completed', 'failed')),
               model TEXT,
               input_tokens BIGINT CHECK(input_tokens IS NULL OR input_tokens >= 0),
               output_tokens BIGINT CHECK(output_tokens IS NULL OR output_tokens >= 0),
               error_code TEXT,
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (organization_id, id),
               CONSTRAINT ai_messages_conversation_fk
                   FOREIGN KEY (organization_id, conversation_id)
                   REFERENCES ai_conversations(organization_id, id) ON DELETE CASCADE
           )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_tool_executions (
               id TEXT NOT NULL,
               organization_id TEXT NOT NULL CHECK(organization_id <> ''),
               conversation_id TEXT NOT NULL,
               message_id TEXT,
               user_id TEXT NOT NULL,
               tool_name TEXT NOT NULL,
               arguments_redacted TEXT NOT NULL DEFAULT '{}',
               result_summary TEXT,
               record_count BIGINT NOT NULL DEFAULT 0 CHECK(record_count >= 0),
               duration_ms BIGINT NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
               status TEXT NOT NULL CHECK(status IN ('completed', 'denied', 'failed', 'timeout')),
               error_code TEXT,
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (organization_id, id),
               CONSTRAINT ai_tool_execution_conversation_fk
                   FOREIGN KEY (organization_id, conversation_id)
                   REFERENCES ai_conversations(organization_id, id) ON DELETE CASCADE,
               CONSTRAINT ai_tool_execution_message_fk
                   FOREIGN KEY (organization_id, message_id)
                   REFERENCES ai_messages(organization_id, id) ON DELETE SET NULL,
               CONSTRAINT ai_tool_execution_user_fk
                   FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
           )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_feedback (
               id TEXT NOT NULL,
               organization_id TEXT NOT NULL CHECK(organization_id <> ''),
               message_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
               category TEXT NOT NULL CHECK(category IN (
                   'correct', 'incorrect_data', 'missing_source',
                   'permission_issue', 'not_helpful', 'too_slow', 'other'
               )),
               comment TEXT,
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (organization_id, id),
               CONSTRAINT ai_feedback_message_fk
                   FOREIGN KEY (organization_id, message_id)
                   REFERENCES ai_messages(organization_id, id) ON DELETE CASCADE,
               CONSTRAINT ai_feedback_user_fk
                   FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE,
               CONSTRAINT ai_feedback_unique_user_message
                   UNIQUE (organization_id, message_id, user_id)
           )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_usage_daily (
               usage_date DATE NOT NULL,
               organization_id TEXT NOT NULL CHECK(organization_id <> ''),
               user_id TEXT NOT NULL,
               request_count BIGINT NOT NULL DEFAULT 0 CHECK(request_count >= 0),
               input_tokens BIGINT NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
               output_tokens BIGINT NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
               tool_call_count BIGINT NOT NULL DEFAULT 0 CHECK(tool_call_count >= 0),
               estimated_cost NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK(estimated_cost >= 0),
               updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (usage_date, organization_id, user_id),
               CONSTRAINT ai_usage_daily_user_fk
                   FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE
           )"""
    )
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_workspace_updated ON ai_conversations (user_id, organization_id, updated_at DESC) WHERE status = 'active'",
        "CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace_created ON ai_conversations (organization_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages (organization_id, conversation_id, created_at ASC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_conversation_created ON ai_tool_executions (organization_id, conversation_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_message ON ai_tool_executions (organization_id, message_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_user ON ai_tool_executions (user_id, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_feedback_user ON ai_feedback (user_id, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_workspace_date ON ai_usage_daily (organization_id, usage_date DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_user ON ai_usage_daily (user_id, organization_id, usage_date DESC)",
    ):
        cursor.execute(statement)


def _upgrade_to_v39_cover_ai_foreign_keys(cursor, _context):
    """Add child-side indexes required by the AI foreign-key audit."""

    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_message ON ai_tool_executions (organization_id, message_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_user ON ai_tool_executions (user_id, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_feedback_user ON ai_feedback (user_id, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_user ON ai_usage_daily (user_id, organization_id, usage_date DESC)",
    ):
        cursor.execute(statement)


def _upgrade_to_v40_add_ai_knowledge(cursor, _context):
    """Add the approved, versioned document registry used by local RAG."""

    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
               id TEXT PRIMARY KEY,
               organization_id TEXT,
               title TEXT NOT NULL CHECK(trim(title) <> ''),
               document_number TEXT NOT NULL CHECK(trim(document_number) <> ''),
               issuing_authority TEXT NOT NULL CHECK(trim(issuing_authority) <> ''),
               document_type TEXT NOT NULL CHECK(document_type IN (
                   'LEGAL_DOCUMENT', 'INTERNAL_POLICY', 'PROCESS_GUIDE',
                   'BIDDINGFLOW_HELP', 'TEMPLATE_GUIDE', 'APPROVED_QA'
               )),
               issued_date DATE NOT NULL,
               effective_from DATE NOT NULL,
               effective_to DATE,
               version TEXT NOT NULL CHECK(trim(version) <> ''),
               status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
               confidentiality TEXT NOT NULL CHECK(confidentiality IN (
                   'public', 'internal', 'confidential'
               )),
               approved_by TEXT NOT NULL,
               approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               source_url TEXT NOT NULL DEFAULT '',
               source_filename TEXT NOT NULL,
               content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               CONSTRAINT ai_knowledge_effective_dates_check
                   CHECK(effective_to IS NULL OR effective_to >= effective_from),
               CONSTRAINT ai_knowledge_global_confidentiality_check
                   CHECK(organization_id IS NOT NULL OR confidentiality <> 'confidential'),
               CONSTRAINT ai_knowledge_approver_fk
                   FOREIGN KEY (approved_by) REFERENCES tai_khoan(id) ON DELETE RESTRICT
           )"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
               id TEXT PRIMARY KEY,
               document_id TEXT NOT NULL,
               chunk_index BIGINT NOT NULL CHECK(chunk_index >= 0),
               section TEXT NOT NULL DEFAULT '',
               page_number BIGINT CHECK(page_number IS NULL OR page_number > 0),
               content TEXT NOT NULL CHECK(trim(content) <> ''),
               char_count BIGINT NOT NULL CHECK(char_count > 0),
               created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
               CONSTRAINT ai_knowledge_chunks_document_fk
                   FOREIGN KEY (document_id)
                   REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
               CONSTRAINT ai_knowledge_chunks_document_index_unique
                   UNIQUE (document_id, chunk_index)
           )"""
    )
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_active_org ON ai_knowledge_documents (organization_id, document_type, updated_at DESC) WHERE status = 'active'",
        "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_approved_by ON ai_knowledge_documents (approved_by)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_scope_hash ON ai_knowledge_documents (COALESCE(organization_id, ''), content_hash)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_one_global_active ON ai_knowledge_documents (document_type, document_number) WHERE organization_id IS NULL AND status = 'active'",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_one_org_active ON ai_knowledge_documents (organization_id, document_type, document_number) WHERE organization_id IS NOT NULL AND status = 'active'",
        "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_document ON ai_knowledge_chunks (document_id, chunk_index)",
    ):
        cursor.execute(statement)


def _upgrade_to_v41_add_contractor_violation_checks(cursor, context):
    """Persist server-authoritative contractor violation assessments."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    statuses = (
        "'VIOLATION_CONFIRMED', 'NO_ACTIVE_VIOLATION', 'REVIEW_REQUIRED', "
        "'LOOKUP_FAILED', 'NOT_CHECKED', 'IDENTITY_CONFLICT'"
    )
    for table_name in (
        "thong_tin_mo_thau",
        "thong_tin_mo_thau_lien_danh_thanh_vien",
    ):
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ADD COLUMN IF NOT EXISTS violation_status TEXT NOT NULL
                DEFAULT 'NOT_CHECKED'
                CHECK(violation_status IN ({statuses}))"""
        )
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ADD COLUMN IF NOT EXISTS violation_bid_closing_at TIMESTAMPTZ"""
        )
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ADD COLUMN IF NOT EXISTS violation_checked_at TIMESTAMPTZ"""
        )

    tables = ("contractor_violation_cache", "contractor_violation_checks")
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name,
            SCHEMA_DINH_NGHIA[table_name],
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    context.create_foreign_keys(
        cursor,
        ("contractor_violation_checks",),
        if_not_exists=True,
    )
    context.create_indexes_and_triggers(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v42_recheck_failed_violation_snapshots(cursor, _context):
    """Invalidate false clean results derived from failed provider lookups."""

    cursor.execute(
        """UPDATE thong_tin_mo_thau_lien_danh_thanh_vien AS member
               SET violation_status = 'NOT_CHECKED',
                   violation_bid_closing_at = NULL,
                   violation_checked_at = NULL
             WHERE member.violation_status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')
               AND EXISTS (
                   SELECT 1
                     FROM contractor_violation_checks AS check_row
                    WHERE check_row.organization_id = member.organization_id
                      AND check_row.bid_opening_record_id = member.thong_tin_mo_thau_id
                      AND check_row.joint_venture_member_id = member.id
                      AND check_row.source_payload_hash = ''
                      AND check_row.status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')
               )"""
    )
    cursor.execute(
        """UPDATE thong_tin_mo_thau AS opening
               SET violation_status = 'NOT_CHECKED',
                   violation_bid_closing_at = NULL,
                   violation_checked_at = NULL
             WHERE opening.violation_status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')
               AND EXISTS (
                   SELECT 1
                     FROM contractor_violation_checks AS check_row
                    WHERE check_row.organization_id = opening.organization_id
                      AND check_row.bid_opening_record_id = opening.id
                      AND check_row.joint_venture_member_id IS NULL
                      AND check_row.source_payload_hash = ''
                      AND check_row.status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')
               )"""
    )
    cursor.execute(
        """UPDATE contractor_violation_checks
               SET is_stale = 1,
                   updated_at = CURRENT_TIMESTAMP
             WHERE source_payload_hash = ''
               AND status IN ('LOOKUP_FAILED', 'NO_ACTIVE_VIOLATION')"""
    )


def _upgrade_to_v43_bind_session_active_role_to_workspace(cursor, _context):
    """Bind a selected role to the workspace that authorized the selection."""

    cursor.execute(
        """ALTER TABLE auth_sessions
           ADD COLUMN IF NOT EXISTS active_role_organization_id TEXT"""
    )
    # Existing role selections have no trustworthy workspace provenance. Clear
    # them so the next request safely re-derives authority from live membership.
    cursor.execute(
        """UPDATE auth_sessions
              SET active_role = NULL,
                  active_role_organization_id = NULL
            WHERE active_role IS NOT NULL
              AND NULLIF(TRIM(active_role_organization_id), '') IS NULL"""
    )
    cursor.execute(
        """UPDATE auth_sessions
              SET active_role_organization_id = NULL
            WHERE active_role IS NULL"""
    )
    cursor.execute(
        """ALTER TABLE auth_sessions
           DROP CONSTRAINT IF EXISTS auth_sessions_active_role_workspace_check"""
    )
    cursor.execute(
        """ALTER TABLE auth_sessions
           ADD CONSTRAINT auth_sessions_active_role_workspace_check
           CHECK(
               active_role_organization_id IS NULL
               OR (
                   active_role IS NOT NULL
                   AND TRIM(active_role_organization_id) != ''
               )
           )"""
    )


def read_sync_metadata_version_bound_violations(cursor) -> tuple[int, int]:
    """Count impossible sync cursors without returning tenant identifiers."""

    invalid = cursor.execute(
        """SELECT
             COUNT(*) FILTER (WHERE current_version < 0),
             COUNT(*) FILTER (
                 WHERE min_available_version > current_version
             )
           FROM sync_metadata"""
    ).fetchone()
    return int(invalid[0]), int(invalid[1])


def _upgrade_to_v44_enforce_sync_metadata_version_bounds(cursor, _context):
    """Reject impossible sync cursors after validating all existing rows."""

    negative_current, minimum_ahead = read_sync_metadata_version_bound_violations(
        cursor
    )
    if negative_current or minimum_ahead:
        raise RuntimeError(
            "sync_metadata invariant preflight failed: "
            f"current_version_negative={negative_current}, "
            f"min_available_version_ahead={minimum_ahead}; "
            "repair invalid rows with an audited procedure before retrying."
        )

    cursor.execute(
        """ALTER TABLE sync_metadata
           ADD CONSTRAINT sync_metadata_current_version_nonnegative_check
           CHECK (current_version >= 0) NOT VALID"""
    )
    cursor.execute(
        """ALTER TABLE sync_metadata
           ADD CONSTRAINT sync_metadata_available_version_order_check
           CHECK (min_available_version <= current_version) NOT VALID"""
    )
    cursor.execute(
        """ALTER TABLE sync_metadata
           VALIDATE CONSTRAINT sync_metadata_current_version_nonnegative_check"""
    )
    cursor.execute(
        """ALTER TABLE sync_metadata
           VALIDATE CONSTRAINT sync_metadata_available_version_order_check"""
    )


def _upgrade_to_v45_add_retention_cleanup_indexes(cursor, _context):
    """Support bounded global retention sweeps with cutoff-led plans."""

    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_deleted_records_retention_cutoff
             ON deleted_records (deleted_at, organization_id, delete_version)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_sync_mutations_retention_cutoff
             ON sync_mutations (created_at)"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_partner_enrichment_terminal_cleanup
             ON partner_enrichment_jobs (updated_at)
          WHERE status IN ('completed', 'failed')"""
    )


def _upgrade_to_v46_reconcile_historical_chain(cursor, _context):
    """Align replayed historical installs with the normalized latest catalog."""

    from backend.db.postgres_schema import reconcile_historical_postgres_schema

    reconcile_historical_postgres_schema(cursor)


def read_audit_successor_index_state(cursor) -> tuple[bool, bool, bool]:
    """Return explicit/twin presence and whether their index semantics match."""

    row = cursor.execute(
        """SELECT
             explicit_index.indexrelid IS NOT NULL,
             constraint_index.indexrelid IS NOT NULL,
             COALESCE(
                 explicit_index.indrelid = constraint_index.indrelid
                 AND explicit_index.indisunique
                 AND explicit_index.indisunique = constraint_index.indisunique
                 AND explicit_index.indnkeyatts = constraint_index.indnkeyatts
                 AND explicit_index.indnatts = constraint_index.indnatts
                 AND explicit_index.indkey = constraint_index.indkey
                 AND explicit_index.indclass = constraint_index.indclass
                 AND explicit_index.indcollation = constraint_index.indcollation
                 AND explicit_index.indoption = constraint_index.indoption
                 AND explicit_index.indexprs IS NOT DISTINCT FROM
                     constraint_index.indexprs
                 AND explicit_index.indpred IS NOT DISTINCT FROM
                     constraint_index.indpred
                 AND explicit_relation.relam = constraint_relation.relam,
                 FALSE
             )
           FROM (
               SELECT current_schema()::regnamespace AS oid
           ) AS current_namespace
      LEFT JOIN pg_class AS explicit_relation
             ON explicit_relation.relnamespace = current_namespace.oid
            AND explicit_relation.relname = 'idx_audit_log_single_successor'
      LEFT JOIN pg_index AS explicit_index
             ON explicit_index.indexrelid = explicit_relation.oid
      LEFT JOIN pg_constraint AS constraint_record
             ON constraint_record.connamespace = current_namespace.oid
            AND constraint_record.conname =
                'audit_log_chain_id_previous_hash_key'
            AND constraint_record.contype = 'u'
      LEFT JOIN pg_index AS constraint_index
             ON constraint_index.indexrelid = constraint_record.conindid
      LEFT JOIN pg_class AS constraint_relation
             ON constraint_relation.oid = constraint_index.indexrelid"""
    ).fetchone()
    if row is None:
        raise RuntimeError("Audit successor index preflight returned no catalog row.")
    return bool(row[0]), bool(row[1]), bool(row[2])


def _upgrade_to_v47_drop_duplicate_audit_successor_index(cursor, _context):
    """Keep the constraint-backed audit successor index as the sole twin."""

    explicit_present, constraint_present, exact_duplicate = (
        read_audit_successor_index_state(cursor)
    )
    if not constraint_present:
        raise RuntimeError(
            "audit successor index preflight failed: constraint-backed twin "
            "audit_log_chain_id_previous_hash_key is missing."
        )
    if explicit_present and not exact_duplicate:
        raise RuntimeError(
            "audit successor index preflight failed: explicit index is not an "
            "exact duplicate of the constraint-backed twin."
        )
    cursor.execute("DROP INDEX IF EXISTS idx_audit_log_single_successor")


def _upgrade_to_v48_add_account_status(cursor, context):
    """Add a reversible account lifecycle without rewriting prior migrations."""

    existing_constraint = cursor.execute(
        """SELECT pg_get_constraintdef(oid), convalidated
             FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conrelid = 'tai_khoan'::regclass
              AND conname = 'tai_khoan_trang_thai_check'"""
    ).fetchone()
    if existing_constraint:
        definition = str(existing_constraint[0] or "").casefold()
        if (
            bool(existing_constraint[1])
            and "trang_thai" in definition
            and "active" in definition
            and "inactive" in definition
        ):
            if context is not None and context.create_trigger_functions is not None:
                context.create_trigger_functions(cursor)
            return

    cursor.execute(
        """ALTER TABLE tai_khoan
           ADD COLUMN IF NOT EXISTS trang_thai TEXT NOT NULL DEFAULT 'active'"""
    )
    cursor.execute(
        """ALTER TABLE tai_khoan
           DROP CONSTRAINT IF EXISTS tai_khoan_trang_thai_check"""
    )
    cursor.execute(
        """ALTER TABLE tai_khoan
           ADD CONSTRAINT tai_khoan_trang_thai_check
           CHECK (trang_thai IN ('active', 'inactive')) NOT VALID"""
    )
    cursor.execute(
        """ALTER TABLE tai_khoan
           VALIDATE CONSTRAINT tai_khoan_trang_thai_check"""
    )
    if context is not None and context.create_trigger_functions is not None:
        context.create_trigger_functions(cursor)


def _upgrade_to_v49_add_procurement_import_provenance(cursor, context):
    """Add append-only source evidence and resumable import operations."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    tables = (
        "procurement_source_revision",
        "procurement_source_binding",
        "procurement_import_operation",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name,
            SCHEMA_DINH_NGHIA[table_name],
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_procurement_revision_family ON procurement_source_revision (organization_id, provider, family_key, entity_kind, revision_no)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_revision_local_root ON procurement_source_revision (organization_id, local_root_id) WHERE local_root_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_procurement_revision_operation ON procurement_source_revision (organization_id, operation_id) WHERE operation_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_procurement_binding_family ON procurement_source_binding (organization_id, provider, family_key, symbol, notify_no)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_binding_local_root ON procurement_source_binding (organization_id, local_root_id)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_operation_status ON procurement_import_operation (organization_id, status, updated_at)",
    ):
        cursor.execute(statement)
    if callable(context.create_trigger_functions):
        context.create_trigger_functions(cursor)
    for table_name in (
        "procurement_source_revision",
        "procurement_source_binding",
    ):
        cursor.execute(
            f"""DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger
                     WHERE tgrelid = '{table_name}'::regclass
                       AND tgname = 'trg_{table_name}_immutable'
                       AND NOT tgisinternal
                  ) THEN
                    CREATE TRIGGER trg_{table_name}_immutable
                    BEFORE UPDATE OR DELETE ON {table_name}
                    FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation();
                  END IF;
                END $$"""  # noqa: S608 - identifiers come from the fixed tuple above.
        )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v50_version_procurement_binding_snapshots(cursor, _context):
    """Allow immutable bindings for every later local package snapshot."""

    cursor.execute(
        """ALTER TABLE procurement_source_binding
           DROP CONSTRAINT IF EXISTS
           procurement_source_binding_organization_id_provider_plan_re_key"""
    )
    cursor.execute(
        """DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE connamespace = current_schema()::regnamespace
                   AND conrelid = 'procurement_source_binding'::regclass
                   AND conname = 'procurement_source_binding_snapshot_unique'
              ) THEN
                ALTER TABLE procurement_source_binding
                  ADD CONSTRAINT procurement_source_binding_snapshot_unique
                  UNIQUE (
                    organization_id, provider, plan_revision_uuid,
                    id_detail, local_snapshot_id
                  );
              END IF;
            END $$"""
    )


def _upgrade_to_v51_add_unknown_package_status(cursor, _context):
    """Represent an imported package whose lifecycle cannot be inferred."""

    existing_constraint = cursor.execute(
        """SELECT pg_get_constraintdef(oid), convalidated
             FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conrelid = 'goi_thau'::regclass
              AND conname = 'goi_thau_trang_thai_check'"""
    ).fetchone()
    if existing_constraint:
        definition = str(existing_constraint[0] or "").casefold()
        if bool(existing_constraint[1]) and "unknown" in definition:
            return
    cursor.execute(
        """ALTER TABLE goi_thau
           DROP CONSTRAINT IF EXISTS goi_thau_trang_thai_check"""
    )


    cursor.execute(
        """ALTER TABLE goi_thau
           ADD CONSTRAINT goi_thau_trang_thai_check
           CHECK (trang_thai IN (
             'UNKNOWN', 'PREPARING', 'INVITED', 'OPENED', 'EVALUATING',
             'PARTIALLY_AWARDED', 'AWARDED', 'CANCELLED'
           )) NOT VALID"""
    )
    cursor.execute(
        """ALTER TABLE goi_thau
           VALIDATE CONSTRAINT goi_thau_trang_thai_check"""
    )


def _upgrade_to_v52_add_muasamcong_provider(cursor, _context):
    """Allow the unified production Mua Sắm Công source in provenance tables."""

    for table_name in (
        "procurement_source_revision",
        "procurement_source_binding",
        "procurement_import_operation",
    ):
        constraint_name = f"{table_name}_provider_check"
        existing = cursor.execute(
            """SELECT pg_get_constraintdef(oid), convalidated
                 FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conrelid = ?::regclass
                  AND conname = ?""",
            (table_name, constraint_name),
        ).fetchone()
        if (
            existing
            and bool(existing[1])
            and "MUASAMCONG" in str(existing[0] or "").upper()
        ):
            continue
        cursor.execute(
            f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}"
        )
        cursor.execute(
            f"""ALTER TABLE {table_name}
                  ADD CONSTRAINT {constraint_name}
                  CHECK (provider IN ('VNEPS', 'VNEPS_FIXTURE', 'MUASAMCONG'))"""
        )


def _upgrade_to_v53_add_procurement_raw_snapshots(cursor, context):
    """Add append-only, content-deduplicated upstream source evidence."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "procurement_raw_snapshot",
        SCHEMA_DINH_NGHIA["procurement_raw_snapshot"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace(
            "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
        )
    cursor.execute(create_sql)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_procurement_raw_entity "
        "ON procurement_raw_snapshot "
        "(organization_id, provider, entity_kind, canonical_code, retrieved_at DESC)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_procurement_raw_content "
        "ON procurement_raw_snapshot (organization_id, content_hash)"
    )
    if callable(context.create_trigger_functions):
        context.create_trigger_functions(cursor)
    cursor.execute(
        """DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'procurement_raw_snapshot'::regclass
                   AND tgname = 'trg_procurement_raw_snapshot_immutable'
                   AND NOT tgisinternal
              ) THEN
                CREATE TRIGGER trg_procurement_raw_snapshot_immutable
                BEFORE UPDATE OR DELETE ON procurement_raw_snapshot
                FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation();
              END IF;
            END $$"""
    )


def _upgrade_to_v54_allow_authoritative_procurement_resync(cursor, _context):
    """Keep changed observations for one upstream revision append-only."""

    expected_constraints = {
        "procurement_source_revision_observation_unique": (
            "UNIQUE (organization_id, provider, entity_kind, revision_uuid, digest)"
        ),
        "procurement_source_revision_idempotent_observation_unique": (
            "UNIQUE (organization_id, provider, idempotency_key, revision_uuid, digest)"
        ),
    }
    existing = {
        str(row[0]): str(row[1])
        for row in cursor.execute(
            """SELECT conname, pg_get_constraintdef(oid, true)
                 FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conrelid = 'procurement_source_revision'::regclass
                  AND conname IN (
                    'procurement_source_revision_observation_unique',
                    'procurement_source_revision_idempotent_observation_unique'
                  )"""
        ).fetchall()
    }
    if all(
        existing.get(name, "").replace("  ", " ") == definition
        for name, definition in expected_constraints.items()
    ):
        return
    for constraint_name in (
        "procurement_source_revision_organization_id_provider_entity_key",
        "procurement_source_revision_organization_id_provider_idempo_key",
        "procurement_source_revision_observation_unique",
        "procurement_source_revision_idempotent_observation_unique",
    ):
        cursor.execute(
            f"ALTER TABLE procurement_source_revision "
            f"DROP CONSTRAINT IF EXISTS {constraint_name}"
        )
    cursor.execute(
        """ALTER TABLE procurement_source_revision
             ADD CONSTRAINT procurement_source_revision_observation_unique
             UNIQUE (organization_id, provider, entity_kind, revision_uuid, digest)"""
    )
    cursor.execute(
        """ALTER TABLE procurement_source_revision
             ADD CONSTRAINT procurement_source_revision_idempotent_observation_unique
             UNIQUE (
               organization_id, provider, idempotency_key, revision_uuid, digest
             )"""
    )


def _upgrade_to_v55_add_procurement_import_sessions(cursor, context):
    """Persist canonical import sessions across workers and restarts."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "procurement_import_session",
        SCHEMA_DINH_NGHIA["procurement_import_session"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_procurement_session_owner "
        "ON procurement_import_session (organization_id, user_id, workspace_lease)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_procurement_session_family "
        "ON procurement_import_session (organization_id, family_key, status)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_procurement_session_expiry "
        "ON procurement_import_session (expires_at)"
    )


def _upgrade_to_v56_separate_sensitive_record_read_capabilities(cursor, context):
    """Create fail-closed record-read grants without copying export grants."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "sensitive_record_read_capabilities",
        SCHEMA_DINH_NGHIA["sensitive_record_read_capabilities"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_sensitive_record_read_capabilities_user "
        "ON sensitive_record_read_capabilities (user_id, organization_id)"
    )
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("sensitive_record_read_capabilities",),
            if_not_exists=True,
        )


def _upgrade_to_v57_repair_sensitive_read_capability_fk(cursor, context):
    """Repair v56 databases whose separately-created PostgreSQL FK was absent."""

    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("sensitive_record_read_capabilities",),
            if_not_exists=True,
        )


def _upgrade_to_v58_add_document_job_policy(cursor, _context):
    """Bind durable exports to an immutable, revalidated authorization policy."""

    cursor.execute(
        """ALTER TABLE document_jobs
           ADD COLUMN IF NOT EXISTS policy_json TEXT NOT NULL DEFAULT ''
           CHECK(length(policy_json) <= 8192)"""
    )
    cursor.execute(
        """ALTER TABLE document_jobs
           ADD COLUMN IF NOT EXISTS policy_hash TEXT NOT NULL DEFAULT ''
           CHECK(length(policy_hash) IN (0, 64))"""
    )


def _upgrade_to_v59_rename_websocket_delivery_to_dispatch(cursor, _context):
    """Record local hint dispatch without claiming global client delivery."""

    cursor.execute(
        "ALTER TABLE websocket_events ADD COLUMN IF NOT EXISTS dispatched_at INTEGER"
    )
    cursor.execute(
        "ALTER TABLE websocket_events DROP CONSTRAINT IF EXISTS websocket_events_status_check"
    )
    cursor.execute(
        "UPDATE websocket_events SET status = 'dispatched', dispatched_at = delivered_at WHERE status = 'delivered'"
    )
    cursor.execute(
        """ALTER TABLE websocket_events
           ADD CONSTRAINT websocket_events_status_check
           CHECK(status IN ('pending', 'retry', 'dispatched', 'dead_letter'))"""
    )


def _upgrade_to_v60_capture_synced_delete_snapshots(cursor, context):
    """Deploy the snapshot-aware tombstone function to existing databases."""

    installer = getattr(
        context, "create_synced_delete_trigger_function", None
    )
    if not callable(installer):
        raise RuntimeError(
            "v60 requires the synced-delete trigger function installer."
        )
    installer(cursor)


def _upgrade_to_v61_rename_default_workspace(cursor, _context):
    """Rename the historical default workspace without changing its identity."""

    cursor.execute(
        """UPDATE to_chuc
              SET ten_to_chuc = 'HCP',
                  updated_at = CURRENT_TIMESTAMP
            WHERE ten_to_chuc = 'HTD'"""
    )


def _upgrade_to_v62_add_ai_message_idempotency(cursor, _context):
    """Deduplicate retried assistant sends without altering conversation history."""

    cursor.execute(
        """ALTER TABLE ai_messages
           ADD COLUMN IF NOT EXISTS client_request_id TEXT
           CHECK (
             client_request_id IS NULL
             OR length(client_request_id) BETWEEN 8 AND 80
           )"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_client_request
           ON ai_messages (organization_id, conversation_id, client_request_id)
           WHERE client_request_id IS NOT NULL"""
    )


def _upgrade_to_v63_scope_procurement_operation_idempotency(cursor, _context):
    """Align import-operation idempotency with its family-scoped identity."""

    row = cursor.execute(
        """SELECT COUNT(*)
             FROM (
               SELECT 1
                 FROM procurement_import_operation
                GROUP BY organization_id, provider, family_key, idempotency_key
               HAVING COUNT(*) > 1
             ) duplicate_groups"""
    ).fetchone()
    duplicate_groups = int(row[0]) if row else 0
    if duplicate_groups:
        raise RuntimeError(
            "v63 procurement operation idempotency preflight failed: "
            f"{duplicate_groups} duplicate family-scoped groups require repair."
        )

    cursor.execute(
        """ALTER TABLE procurement_import_operation
           DROP CONSTRAINT IF EXISTS
           procurement_import_operation_organization_id_provider_idemp_key"""
    )
    cursor.execute(
        """DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE connamespace = current_schema()::regnamespace
                   AND conrelid = 'procurement_import_operation'::regclass
                   AND conname =
                       'procurement_import_operation_family_idempotency_unique'
              ) THEN
                ALTER TABLE procurement_import_operation
                  ADD CONSTRAINT
                    procurement_import_operation_family_idempotency_unique
                  UNIQUE (
                    organization_id, provider, family_key, idempotency_key
                  );
              END IF;
            END $$"""
    )


def _upgrade_to_v64_add_conflict_resolution_drafts(cursor, context):
    """Add encrypted, actor/workspace-scoped durable conflict drafts."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "conflict_resolution_drafts",
        SCHEMA_DINH_NGHIA["conflict_resolution_drafts"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
    cursor.execute(create_sql)
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_conflict_drafts_actor_workspace
           ON conflict_resolution_drafts (
             organization_id, actor_user_id, workspace_fingerprint,
             status, updated_at DESC
           )"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_conflict_drafts_expiry
           ON conflict_resolution_drafts (expires_at)"""
    )
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("conflict_resolution_drafts",),
            if_not_exists=True,
        )


def _upgrade_to_v65_add_word_template_catalog(cursor, context):
    """Add immutable Word template versions and publication provenance."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    tables = (
        "word_template",
        "word_template_version",
        "word_template_preflight_run",
        "word_template_publication_event",
        "word_template_projection_outbox",
        "word_publication_assignment_v2",
        "generated_document_provenance",
    )
    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v65 requires the canonical table builder.")
    if not callable(context.create_foreign_keys):
        raise RuntimeError("Database upgrade v65 requires the canonical foreign-key builder.")

    # The logical template points at versions while versions point back at their
    # logical identity.  Build every table first, then install the tenant-scoped
    # foreign keys in one dependency-safe pass.
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name,
            SCHEMA_DINH_NGHIA[table_name],
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)

    context.create_foreign_keys(cursor, tables, if_not_exists=True)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_word_template_catalog ON word_template (organization_id, retired_at, updated_at DESC, id)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_version_history ON word_template_version (organization_id, template_id, version_no DESC)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_version_checksum ON word_template_version (organization_id, sha256)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_preflight_history ON word_template_preflight_run (organization_id, template_version_id, run_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_publication_history ON word_template_publication_event (organization_id, template_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_projection_claim ON word_template_projection_outbox (status, available_at, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_word_template_projection_template ON word_template_projection_outbox (organization_id, template_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_word_assignment_template ON word_publication_assignment_v2 (organization_id, template_id, document_type, context_key)",
        "CREATE INDEX IF NOT EXISTS idx_generated_document_template ON generated_document_provenance (organization_id, template_version_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_generated_document_record ON generated_document_provenance (organization_id, record_type, record_id, created_at DESC) WHERE record_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_word_template_owner_type_owner ON word_template (owner_type, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_word_publication_assignment_v2_owner_type_owner ON word_publication_assignment_v2 (owner_type, organization_id)",
    ):
        cursor.execute(statement)

    if not callable(context.create_trigger_functions):
        raise RuntimeError("Database upgrade v65 requires the trigger-function installer.")
    context.create_trigger_functions(cursor)
    for table_name in ("word_template", "word_publication_assignment_v2"):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_workspace_owner ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_workspace_owner "
            f"BEFORE INSERT OR UPDATE ON {table_name} "
            "FOR EACH ROW EXECUTE FUNCTION bf_validate_workspace_owner()"
        )
    for table_name in (
        "word_template_version",
        "word_template_preflight_run",
        "word_template_publication_event",
        "generated_document_provenance",
    ):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_immutable "
            f"BEFORE UPDATE OR DELETE ON {table_name} "
            "FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation()"
        )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v66_preserve_word_assignment_sets(cursor, _context):
    """Preserve ordered multi-template publication assignments from ADR 0005."""

    cursor.execute(
        """ALTER TABLE word_publication_assignment_v2
           ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
           CHECK(sort_order >= 0)"""
    )
    cursor.execute(
        """ALTER TABLE word_publication_assignment_v2
           DROP CONSTRAINT IF EXISTS
             word_publication_assignment_v_organization_id_document_type_key"""
    )
    for constraint_name, definition in (
        (
            "word_assignment_target_unique",
            "UNIQUE (organization_id, document_type, context_key, template_id)",
        ),
        (
            "word_assignment_order_unique",
            "UNIQUE (organization_id, document_type, context_key, sort_order)",
        ),
    ):
        cursor.execute(
            f"""DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'word_publication_assignment_v2'::regclass
                       AND conname = '{constraint_name}'
                  ) THEN
                    ALTER TABLE word_publication_assignment_v2
                      ADD CONSTRAINT {constraint_name} {definition};
                  END IF;
                END $$"""  # noqa: S608 - fixed migration identifiers.
        )
    cursor.execute("DROP INDEX IF EXISTS idx_word_assignment_template")
    cursor.execute(
        """CREATE INDEX idx_word_assignment_template
           ON word_publication_assignment_v2
              (organization_id, template_id, document_type, context_key, sort_order)"""
    )


def _upgrade_to_v67_type_word_catalog_timestamps(cursor, _context):
    """Use native timestamps for lifecycle retention and outbox leasing."""

    for table_name, column_name in (
        ("word_template", "retired_at"),
        ("word_template_preflight_run", "run_at"),
        ("word_template_projection_outbox", "available_at"),
        ("word_template_projection_outbox", "locked_at"),
    ):
        cursor.execute(
            f"""ALTER TABLE {table_name}
                ALTER COLUMN {column_name} TYPE TIMESTAMPTZ
                USING NULLIF({column_name}::text, '')::TIMESTAMPTZ"""  # noqa: S608
        )


def _upgrade_to_v68_complete_word_catalog_cutover(cursor, context):
    """Add assignment CAS head and permit approved retention deletes."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    create_sql = context.build_create_table_sql(
        "word_template_assignment_config",
        SCHEMA_DINH_NGHIA["word_template_assignment_config"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace(
            "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
        )
    cursor.execute(create_sql)
    context.create_foreign_keys(
        cursor, ("word_template_assignment_config",), if_not_exists=True,
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_word_assignment_config_revision
           ON word_template_assignment_config (organization_id, revision)"""
    )
    cursor.execute(
        """ALTER TABLE word_template_projection_outbox
           ALTER COLUMN template_id DROP NOT NULL"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS
             idx_word_assignment_projection_digest
           ON word_template_projection_outbox
              (organization_id, event_type, desired_checksum)
           WHERE event_type = 'ASSIGNMENT'"""
    )
    for table_name in (
        "word_template_version", "word_template_preflight_run",
    ):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_immutable "
            f"BEFORE UPDATE ON {table_name} "
            "FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation()"
        )
    cursor.execute(
        """DROP TRIGGER IF EXISTS trg_word_template_assignment_config_workspace_owner
           ON word_template_assignment_config"""
    )
    cursor.execute(
        """CREATE TRIGGER trg_word_template_assignment_config_workspace_owner
           BEFORE INSERT OR UPDATE ON word_template_assignment_config
           FOR EACH ROW EXECUTE FUNCTION bf_validate_workspace_owner()"""
    )


def _upgrade_to_v69_index_word_assignment_config_owner(cursor, _context):
    """Reconcile fresh and upgraded catalogs for workspace-owner lookup."""

    cursor.execute(
        """CREATE INDEX IF NOT EXISTS
             idx_word_template_assignment_config_owner_type_owner
           ON word_template_assignment_config (owner_type, organization_id)"""
    )


def _upgrade_to_v70_add_legal_versioning(cursor, context):
    """Add immutable SYSTEM legal catalog and typed target bindings."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    tables = (
        "legal_instrument", "legal_instrument_draft",
        "legal_instrument_version", "legal_source_profile",
        "legal_source_profile_draft", "legal_source_profile_version",
        "legal_source_profile_member", "legal_applicability_policy_version",
        "plan_legal_binding", "package_legal_binding",
        "plan_legal_binding_head", "package_legal_binding_head",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name, SCHEMA_DINH_NGHIA[table_name]
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    context.create_foreign_keys(cursor, tables, if_not_exists=True)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_legal_instrument_version_effective ON legal_instrument_version (effective_from, effective_to, instrument_id)",
        "CREATE INDEX IF NOT EXISTS idx_legal_profile_version_effective ON legal_source_profile_version (effective_from, effective_to, priority DESC, profile_id)",
        "CREATE INDEX IF NOT EXISTS idx_plan_legal_binding_history ON plan_legal_binding (organization_id, plan_id, binding_revision DESC)",
        "CREATE INDEX IF NOT EXISTS idx_package_legal_binding_history ON package_legal_binding (organization_id, package_id, binding_revision DESC)",
    ):
        cursor.execute(statement)
    context.create_trigger_functions(cursor)
    for table_name in (
        "legal_instrument_version", "legal_source_profile_version",
        "legal_source_profile_member", "legal_applicability_policy_version",
        "plan_legal_binding", "package_legal_binding",
    ):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_immutable BEFORE UPDATE OR DELETE "
            f"ON {table_name} FOR EACH ROW "
            "EXECUTE FUNCTION bf_forbid_audit_mutation()"
        )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v71_add_procurement_cases(cursor, context):
    """Add shared CLARIFICATION/PETITION case core without touching legacy rows."""

    from backend.db.schema import HISTORICAL_SCHEMA_DINH_NGHIA

    tables = (
        "procurement_case", "procurement_case_package_target",
        "procurement_case_party", "procurement_case_responsibility",
        "procurement_case_response_revision", "procurement_case_transition",
        "procurement_case_attachment", "procurement_case_legal_basis",
        "procurement_case_source_observation", "procurement_case_command",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name, HISTORICAL_SCHEMA_DINH_NGHIA[table_name]
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_procurement_case_queue ON procurement_case (organization_id, case_type, state, due_at, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_case_target_lineage ON procurement_case_package_target (organization_id, package_lineage_root_id, current_package_version_id)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_case_response_history ON procurement_case_response_revision (organization_id, case_id, revision_no DESC)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_case_transition_history ON procurement_case_transition (organization_id, case_id, sequence_no DESC)",
        "CREATE INDEX IF NOT EXISTS idx_procurement_case_observation_queue ON procurement_case_source_observation (organization_id, case_type, linked_case_id, observed_at DESC)",
    ):
        cursor.execute(statement)
    context.create_trigger_functions(cursor)
    for table_name in (
        "procurement_case_response_revision", "procurement_case_transition",
        "procurement_case_attachment", "procurement_case_legal_basis",
        "procurement_case_source_observation", "procurement_case_command",
    ):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_immutable BEFORE UPDATE OR DELETE "
            f"ON {table_name} FOR EACH ROW "
            "EXECUTE FUNCTION bf_forbid_audit_mutation()"
        )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v72_add_calendar_and_bulk_export(cursor, context):
    """Add technical calendar heads and the export-only bulk control plane."""

    from backend.db.schema import HISTORICAL_SCHEMA_DINH_NGHIA

    tables = (
        "calendar_event_head", "calendar_event_revision", "bulk_operation",
        "bulk_operation_item", "bulk_operation_artifact",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name, HISTORICAL_SCHEMA_DINH_NGHIA[table_name]
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_calendar_event_head_source ON calendar_event_head (organization_id, event_key, row_version)",
        "CREATE INDEX IF NOT EXISTS idx_calendar_event_revision_history ON calendar_event_revision (organization_id, event_head_id, sequence DESC)",
        "CREATE INDEX IF NOT EXISTS idx_bulk_operation_queue ON bulk_operation (organization_id, actor_user_id, status, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_bulk_operation_expiry ON bulk_operation (expires_at, status)",
        "CREATE INDEX IF NOT EXISTS idx_bulk_artifact_expiry ON bulk_operation_artifact (expires_at)",
    ):
        cursor.execute(statement)
    context.create_trigger_functions(cursor)
    for table_name in ("calendar_event_revision", "bulk_operation_item"):
        cursor.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
        )
        cursor.execute(
            f"CREATE TRIGGER trg_{table_name}_immutable BEFORE UPDATE OR DELETE "
            f"ON {table_name} FOR EACH ROW "
            "EXECUTE FUNCTION bf_forbid_audit_mutation()"
        )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v73_extend_activity_for_procurement_cases(cursor, context):
    """Extend the existing activity ledger with approved case actions."""

    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien DROP CONSTRAINT IF EXISTS nhat_ky_thuc_hien_target_type_check"
    )
    cursor.execute(
        """ALTER TABLE nhat_ky_thuc_hien
            ADD CONSTRAINT nhat_ky_thuc_hien_target_type_check
            CHECK(target_type IN ('goithau', 'hopdong', 'procurement_case'))"""
    )
    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien DROP CONSTRAINT IF EXISTS nhat_ky_thuc_hien_action_check"
    )
    cursor.execute(
        """ALTER TABLE nhat_ky_thuc_hien
            ADD CONSTRAINT nhat_ky_thuc_hien_action_check CHECK(action IN (
              'goithau.created', 'goithau.updated', 'hopdong.created', 'hopdong.updated',
              'package_document.uploaded', 'package_document.replaced',
              'package_document.deleted', 'assignment.added', 'assignment.removed',
              'procurement_case.created', 'procurement_case.response_revision_saved',
              'procurement_case.assign', 'procurement_case.start_review',
              'procurement_case.draft_response', 'procurement_case.submit_review',
              'procurement_case.return', 'procurement_case.approve',
              'procurement_case.issue', 'procurement_case.close',
              'procurement_case.reject', 'procurement_case.withdraw',
              'procurement_case.reopen', 'procurement_case.due_date_set',
              'procurement_case.party_added', 'procurement_case.legal_basis_added',
              'procurement_case.source_observed', 'procurement_case.attachment_added'
            ))"""
    )
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v74_add_calendar_connectors(cursor, context):
    """Add opt-in one-way Google/Microsoft calendar delivery control plane."""

    from backend.db.schema import HISTORICAL_SCHEMA_DINH_NGHIA

    cursor.execute("ALTER TABLE calendar_event_head ADD COLUMN IF NOT EXISTS source_type TEXT")
    cursor.execute("ALTER TABLE calendar_event_head ADD COLUMN IF NOT EXISTS source_id TEXT")
    tables = (
        "calendar_oauth_state", "calendar_connection",
        "calendar_event_binding", "calendar_delivery_outbox",
    )
    for table_name in tables:
        create_sql = context.build_create_table_sql(
            table_name, HISTORICAL_SCHEMA_DINH_NGHIA[table_name]
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1)
        cursor.execute(create_sql)
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_calendar_oauth_state_expiry ON calendar_oauth_state (expires_at, used_at)",
        "CREATE INDEX IF NOT EXISTS idx_calendar_connection_owner ON calendar_connection (organization_id, user_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_calendar_binding_remote ON calendar_event_binding (organization_id, connection_id, remote_event_id)",
        "CREATE INDEX IF NOT EXISTS idx_calendar_delivery_claim ON calendar_delivery_outbox (status, available_at, created_at)",
    ):
        cursor.execute(statement)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v75_index_post_v64_foreign_keys(cursor, _context):
    """Add child-side indexes for every FK introduced by the nine increments."""

    for statement in REQUIRED_POST_V64_FK_INDEXES:
        cursor.execute(statement)


def _upgrade_to_v76_generic_document_jobs(cursor, _context):
    """Bind durable document jobs to plans or packages and expose progress."""

    for definition in (
        "record_type TEXT CHECK(record_type IS NULL OR record_type IN ('goi_thau', 'ke_hoach_lcnt'))",
        "record_id TEXT CHECK(record_id IS NULL OR record_id != '')",
        "progress_phase TEXT NOT NULL DEFAULT 'queued' CHECK(progress_phase != '' AND length(progress_phase) <= 64)",
        "progress_completed_items INTEGER NOT NULL DEFAULT 0 CHECK(progress_completed_items >= 0)",
        "progress_total_items INTEGER NOT NULL DEFAULT 1 CHECK(progress_total_items >= 1)",
    ):
        cursor.execute(
            f"ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS {definition}"
        )
    cursor.execute(
        """ALTER TABLE document_jobs
           DROP CONSTRAINT IF EXISTS document_jobs_policy_json_check"""
    )
    cursor.execute(
        """ALTER TABLE document_jobs
           ADD CONSTRAINT document_jobs_policy_json_check
           CHECK(length(policy_json) <= 65536)"""
    )
    cursor.execute(
        """UPDATE document_jobs
              SET record_type = 'goi_thau', record_id = package_id
            WHERE package_id IS NOT NULL AND trim(package_id) != ''
              AND record_type IS NULL AND record_id IS NULL"""
    )
    cursor.execute(
        """UPDATE document_jobs
              SET progress_phase = CASE
                    WHEN status = 'completed' THEN 'completed'
                    WHEN status = 'failed' AND cancelled_at IS NOT NULL THEN 'cancelled'
                    WHEN status = 'failed' THEN 'failed'
                    WHEN status = 'processing' THEN 'rendering'
                    ELSE 'queued'
                  END,
                  progress_completed_items = CASE
                    WHEN status = 'completed' THEN 1 ELSE 0
                  END,
                  progress_total_items = 1"""
    )
    cursor.execute(
        """CREATE INDEX IF NOT EXISTS idx_document_jobs_record_owner
           ON document_jobs
              (organization_id, record_type, record_id, user_id, created_at)"""
    )


RETIRED_PROCUREMENT_CENTER_TABLES = (
    "calendar_delivery_outbox", "calendar_event_binding",
    "calendar_connection", "calendar_oauth_state",
    "bulk_operation_artifact", "bulk_operation_item", "bulk_operation",
    "calendar_event_revision", "calendar_event_head",
    "procurement_case_attachment", "procurement_case_legal_basis",
    "procurement_case_transition", "procurement_case_responsibility",
    "procurement_case_party", "procurement_case_package_target",
    "procurement_case_source_observation", "procurement_case_command",
    "procurement_case_response_revision", "procurement_case",
)


def drop_retired_procurement_center_schema(cursor):
    """Remove the retired case, calendar, and bulk-export persistence model."""

    cursor.execute(
        "DROP TRIGGER IF EXISTS trg_nhat_ky_thuc_hien_immutable "
        "ON nhat_ky_thuc_hien"
    )
    cursor.execute(
        "DELETE FROM nhat_ky_thuc_hien WHERE target_type = 'procurement_case'"
    )
    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien DROP CONSTRAINT IF EXISTS "
        "nhat_ky_thuc_hien_target_type_check"
    )
    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien ADD CONSTRAINT "
        "nhat_ky_thuc_hien_target_type_check "
        "CHECK(target_type IN ('goithau', 'hopdong'))"
    )
    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien DROP CONSTRAINT IF EXISTS "
        "nhat_ky_thuc_hien_action_check"
    )
    cursor.execute(
        "ALTER TABLE nhat_ky_thuc_hien ADD CONSTRAINT "
        "nhat_ky_thuc_hien_action_check CHECK(action IN ("
        "'goithau.created', 'goithau.updated', "
        "'hopdong.created', 'hopdong.updated', "
        "'package_document.uploaded', 'package_document.replaced', "
        "'package_document.deleted', 'assignment.added', 'assignment.removed'))"
    )
    for table_name in RETIRED_PROCUREMENT_CENTER_TABLES:
        cursor.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")
    cursor.execute(
        """CREATE TRIGGER trg_nhat_ky_thuc_hien_immutable
           BEFORE UPDATE OR DELETE ON nhat_ky_thuc_hien
           FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation()"""
    )


def _upgrade_to_v77_remove_procurement_center(cursor, context):
    drop_retired_procurement_center_schema(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v78_add_google_password_setup_delivery(cursor, context):
    del context
    cursor.execute(
        "ALTER TABLE email_delivery_status DROP CONSTRAINT IF EXISTS "
        "email_delivery_status_purpose_check"
    )
    cursor.execute(
        "ALTER TABLE email_delivery_status ADD CONSTRAINT "
        "email_delivery_status_purpose_check CHECK (purpose IN ("
        "'google_temporary_password', 'google_password_setup', "
        "'user_notification'))"
    )


COMMERCIAL_V79_TABLES = (
    "commercial_releases",
    "commercial_drafts",
    "commercial_release_timeline",
    "commercial_policy_versions",
    "billing_plan_versions",
    "billing_skus",
    "billing_prices",
    "payment_provider_profiles",
    "billing_quotes",
    "billing_orders",
    "billing_order_items",
    "billing_provider_commands",
    "payment_transactions",
    "payment_webhook_events",
    "billing_subscription_activations",
    "billing_refund_intents",
    "usage_credit_grants",
    "usage_reservations",
    "usage_ledger",
    "billing_invoice_requests",
    "commercial_outbox",
)

COMMERCIAL_V79_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_commercial_draft_status ON commercial_drafts (status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_release_effective ON commercial_releases (scope_key, effective_from DESC)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_timeline_effective ON commercial_release_timeline (scope_key, effective_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_billing_plan_release ON billing_plan_versions (release_id, sales_state, tier, variant)",
    "CREATE INDEX IF NOT EXISTS idx_billing_sku_release ON billing_skus (release_id, sales_state, display_order)",
    "CREATE INDEX IF NOT EXISTS idx_billing_quote_expiry ON billing_quotes (expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_owner_account ON billing_orders (account_user_id, created_at DESC) WHERE account_user_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_owner_org ON billing_orders (organization_id, created_at DESC) WHERE organization_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_order_idempotency_scope ON billing_orders (actor_user_id, owner_kind, COALESCE(account_user_id, ''), COALESCE(organization_id, ''), operation, idempotency_key)",
    "CREATE INDEX IF NOT EXISTS idx_provider_command_claim ON billing_provider_commands (status, available_at)",
    "CREATE INDEX IF NOT EXISTS idx_webhook_event_claim ON payment_webhook_events (status, available_at)",
    "CREATE INDEX IF NOT EXISTS idx_usage_grant_account_expiry ON usage_credit_grants (account_user_id, feature, expires_at) WHERE account_user_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_usage_grant_org_expiry ON usage_credit_grants (organization_id, feature, expires_at) WHERE organization_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_usage_reservation_lease ON usage_reservations (state, lease_expires_at)",
    # PostgreSQL UNIQUE treats NULL values as distinct. The owner columns are
    # intentionally mutually exclusive, so COALESCE is required to make exact
    # source-revision reservations truly idempotent for both owner kinds.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_reservation_identity ON usage_reservations (owner_kind, COALESCE(account_user_id, ''), COALESCE(organization_id, ''), feature, provider, entity_kind, source_code, source_revision)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_outbox_claim ON commercial_outbox (status, available_at)",
)


# Keep the published v79 migration immutable. These indexes are installed by
# v81 for existing databases and directly by the canonical fresh-schema path.
COMMERCIAL_V81_FK_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_account_subscriptions_plan_fk ON account_subscriptions (plan_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_account_subscriptions_source_order_fk ON account_subscriptions (source_order_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_invoice_requests_transaction_fk ON billing_invoice_requests (payment_transaction_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_items_order_fk ON billing_order_items (order_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_items_sku_fk ON billing_order_items (sku_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_items_plan_fk ON billing_order_items (plan_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_order_items_price_fk ON billing_order_items (price_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_orders_quote_fk ON billing_orders (organization_id, quote_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_orders_release_fk ON billing_orders (release_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_plan_versions_legacy_package_fk ON billing_plan_versions (legacy_package_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_prices_sku_fk ON billing_prices (sku_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_quotes_actor_fk ON billing_quotes (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_quotes_account_fk ON billing_quotes (account_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_quotes_release_fk ON billing_quotes (release_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_refund_intents_actor_fk ON billing_refund_intents (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_billing_skus_plan_fk ON billing_skus (plan_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_drafts_base_release_fk ON commercial_drafts (base_release_id)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_drafts_creator_fk ON commercial_drafts (created_by)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_drafts_updater_fk ON commercial_drafts (updated_by)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_release_timeline_release_fk ON commercial_release_timeline (release_id)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_release_timeline_actor_fk ON commercial_release_timeline (actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_releases_base_release_fk ON commercial_releases (base_release_id)",
    "CREATE INDEX IF NOT EXISTS idx_commercial_releases_publisher_fk ON commercial_releases (published_by)",
    "CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_plan_fk ON organization_subscriptions (plan_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_source_order_fk ON organization_subscriptions (organization_id, source_order_id)",
    "CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_fk ON payment_transactions (order_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_credit_grants_order_item_fk ON usage_credit_grants (order_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_credit_grants_release_fk ON usage_credit_grants (release_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_ledger_grant_fk ON usage_ledger (grant_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_ledger_reservation_fk ON usage_ledger (reservation_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_reservations_account_fk ON usage_reservations (account_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_reservations_grant_fk ON usage_reservations (organization_id, grant_id)",
)

COMMERCIAL_V81_FK_INDEX_NAMES = frozenset(
    statement.partition(" ON ")[0].rsplit(" ", 1)[-1]
    for statement in COMMERCIAL_V81_FK_INDEXES
)


def ensure_commercial_v79_indexes(cursor):
    for statement in COMMERCIAL_V79_INDEXES:
        cursor.execute(statement)


def ensure_commercial_v81_fk_indexes(cursor):
    for statement in COMMERCIAL_V81_FK_INDEXES:
        cursor.execute(statement)


def _commercial_stable_id(kind, *parts):
    value = ":".join(["biddingflow-commercial-v79", kind, *map(str, parts)])
    return f"{kind}-{uuid.uuid5(uuid.NAMESPACE_URL, value).hex}"


def seed_commercial_v79(cursor):
    """Create non-sellable compatibility facts and the initial review draft."""

    from backend.commercial_policy.document import (
        build_initial_draft_document,
        canonical_json,
        checksum_document,
    )

    package_rows = cursor.execute(
        """SELECT id, ten_goi, han_muc_nhan_su,
                  document_export_word, document_export_excel,
                  document_export_award_result_excel, trang_thai
             FROM goi_dich_vu
            ORDER BY id"""
    ).fetchall()
    package_snapshots = [dict(row) for row in package_rows]
    release_id = "commercial-release-legacy-v79"
    legacy_snapshot = {
        "schemaVersion": 1,
        "kind": "legacy_compatibility",
        "nonSellable": True,
        "packages": package_snapshots,
    }
    legacy_json = canonical_json(legacy_snapshot)
    cursor.execute(
        """INSERT INTO commercial_releases
               (id, version_label, schema_version, checksum, snapshot_json,
                mode, scope_key, effective_from, non_sellable, reason)
           VALUES (?, 'legacy-v79', 1, ?, ?, 'legacy', 'global', 1, 1,
                   'Backfill tương thích v79; không được chào bán')
           ON CONFLICT(id) DO NOTHING""",
        (release_id, checksum_document(legacy_snapshot), legacy_json),
    )

    package_by_id = {str(row["id"]): dict(row) for row in package_rows}
    organization_variants = cursor.execute(
        """SELECT DISTINCT subscription.package_id, subscription.member_quota
             FROM organization_subscriptions AS subscription
            ORDER BY subscription.package_id, subscription.member_quota"""
    ).fetchall()
    account_variants = cursor.execute(
        """SELECT DISTINCT subscription.package_id
             FROM account_subscriptions AS subscription
            ORDER BY subscription.package_id"""
    ).fetchall()

    def add_legacy_plan(owner_kind, package_id, member_quota):
        package = package_by_id.get(str(package_id))
        if not package:
            return None
        tier = str(package_id).strip().casefold()
        if tier not in {"silver", "gold", "diamond"}:
            tier = "personal" if owner_kind == "account" else "silver"
        logical_code = f"legacy.{owner_kind}.{package_id}.{member_quota}"
        plan_id = _commercial_stable_id("plan", logical_code)
        display_json = canonical_json({
            "name": package.get("ten_goi") or package_id,
            "legacy": True,
        })
        cursor.execute(
            """INSERT INTO billing_plan_versions
                   (id, release_id, logical_package_code, owner_kind, tier,
                    variant, legacy_package_id, member_quota,
                    included_procurement_quota, document_export_word,
                    document_export_excel, document_export_award_result_excel,
                    violation_check_enabled, sales_state, display_json)
               VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, 0, ?, ?, ?, 1,
                       'non_sellable', ?)
               ON CONFLICT(release_id, logical_package_code) DO NOTHING""",
            (
                plan_id,
                release_id,
                logical_code,
                owner_kind,
                tier,
                package_id,
                int(member_quota),
                int(package.get("document_export_word") or 0),
                int(package.get("document_export_excel") or 0),
                int(package.get("document_export_award_result_excel") or 0),
                display_json,
            ),
        )
        return plan_id

    for row in organization_variants:
        plan_id = add_legacy_plan(
            "organization", row["package_id"], int(row["member_quota"])
        )
        if plan_id:
            cursor.execute(
                """UPDATE organization_subscriptions
                      SET plan_version_id = ?, source = 'legacy'
                    WHERE package_id = ? AND member_quota = ?
                      AND plan_version_id IS NULL""",
                (plan_id, row["package_id"], int(row["member_quota"])),
            )
    for row in account_variants:
        package = package_by_id.get(str(row["package_id"])) or {}
        plan_id = add_legacy_plan(
            "account",
            row["package_id"],
            int(package.get("han_muc_nhan_su") or 1),
        )
        if plan_id:
            cursor.execute(
                """UPDATE account_subscriptions
                      SET plan_version_id = ?, source = 'legacy'
                    WHERE package_id = ? AND plan_version_id IS NULL""",
                (plan_id, row["package_id"]),
            )

    cursor.execute(
        """INSERT INTO payment_provider_profiles
               (id, version, provider, environment, public_alias,
                capabilities_json, min_amount, max_amount,
                checkout_ttl_seconds, timeout_ms, max_attempts,
                routing_priority, mode, readiness_status)
           VALUES
               ('provider-fake-v1', 1, 'fake', 'test',
                'Fake local deterministic',
                '{"create":true,"get":true,"cancel":true,"verify":true}',
                1, 100000000, 900, 1000, 3, 100, 'shadow', 'ready'),
               ('provider-payos-production-v1', 1, 'payos', 'production',
                'payOS',
                '{"create":true,"get":true,"cancel":true,"verify":true,"refund":false}',
                1, 100000000, 900, 5000, 3, 10, 'shadow',
                'blocked_external')
           ON CONFLICT(id) DO NOTHING"""
    )

    actor = cursor.execute(
        """SELECT id FROM tai_khoan
            WHERE vai_tro = 'super_admin'
            ORDER BY CASE WHEN trang_thai = 'active' THEN 0 ELSE 1 END,
                     created_at, id
            LIMIT 1"""
    ).fetchone()
    if not actor:
        return
    capabilities_by_tier = {}
    for tier in ("silver", "gold", "diamond"):
        package = package_by_id.get(tier)
        if package:
            capabilities_by_tier[tier] = {
                "document.export.word": bool(package["document_export_word"]),
                "document.export.excel": bool(package["document_export_excel"]),
                "document.export.award_result_excel": bool(
                    package["document_export_award_result_excel"]
                ),
            }
    initial_document = build_initial_draft_document(capabilities_by_tier)
    initial_json = canonical_json(initial_document)
    initial_checksum = checksum_document(initial_document)
    cursor.execute(
        """INSERT INTO commercial_drafts
               (id, schema_version, base_release_id, status, revision,
                document_json, checksum, created_by, updated_by)
           VALUES ('commercial-draft-initial-v1', 1, ?, 'draft', 1,
                   ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING""",
        (release_id, initial_json, initial_checksum, actor[0], actor[0]),
    )


def _upgrade_to_v79_add_commercial_billing_and_usage(cursor, context):
    """Add versioned commercial, billing and procurement-credit foundations."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v79 requires the canonical table builder.")
    if not callable(context.create_foreign_keys):
        raise RuntimeError("Database upgrade v79 requires the canonical foreign-key builder.")
    for table_name in COMMERCIAL_V79_TABLES:
        create_sql = context.build_create_table_sql(
            table_name, SCHEMA_DINH_NGHIA[table_name]
        )
        if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
            create_sql = create_sql.replace(
                "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
            )
        cursor.execute(create_sql)
    for table_name in ("organization_subscriptions", "account_subscriptions"):
        cursor.execute(
            f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS plan_version_id TEXT"
        )
        cursor.execute(
            f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS source TEXT "
            "NOT NULL DEFAULT 'legacy' CHECK(source IN ('legacy', 'admin', 'order'))"
        )
        cursor.execute(
            f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS source_order_id TEXT"
        )
    context.create_foreign_keys(
        cursor,
        COMMERCIAL_V79_TABLES
        + ("organization_subscriptions", "account_subscriptions"),
        if_not_exists=True,
    )
    ensure_commercial_v79_indexes(cursor)
    seed_commercial_v79(cursor)
    if callable(context.create_trigger_functions):
        context.create_trigger_functions(cursor)
        for table_name in (
            "commercial_releases",
            "commercial_release_timeline",
            "commercial_policy_versions",
            "billing_plan_versions",
            "billing_skus",
            "billing_prices",
            "payment_provider_profiles",
            "billing_quotes",
            "payment_transactions",
            "usage_ledger",
        ):
            cursor.execute(
                f"DROP TRIGGER IF EXISTS trg_{table_name}_immutable ON {table_name}"
            )
            cursor.execute(
                f"CREATE TRIGGER trg_{table_name}_immutable "
                f"BEFORE UPDATE OR DELETE ON {table_name} "
                "FOR EACH ROW EXECUTE FUNCTION bf_forbid_audit_mutation()"
            )
    context.assert_foreign_key_integrity(cursor)


def seed_live_payos_v80_profile(cursor):
    """Insert the v80 profile for both fresh installs and upgrade chains."""

    cursor.execute(
        """INSERT INTO payment_provider_profiles
               (id, version, provider, environment, public_alias,
                credential_reference, capabilities_json,
                min_amount, max_amount, checkout_ttl_seconds,
                timeout_ms, max_attempts, routing_priority,
                mode, readiness_status)
           VALUES
               ('provider-payos-production-v2', 2, 'payos', 'production',
                'payOS production', 'env://payos/default',
                '{"create":true,"get":true,"cancel":true,"verify":true,"refund":false}',
                1, 100000000, 900, 5000, 3, 5, 'live', 'ready')
           ON CONFLICT(id) DO NOTHING"""
    )


def _upgrade_to_v80_add_live_payos_profile(cursor, _context):
    """Add the immutable live profile that references process-local secrets."""

    seed_live_payos_v80_profile(cursor)


def _upgrade_to_v81_index_commercial_foreign_keys(cursor, context):
    """Cover child-side foreign keys added by the commercial v79 schema."""

    ensure_commercial_v81_fk_indexes(cursor)
    context.assert_foreign_key_integrity(cursor)


def _upgrade_to_v82_add_product_usage_analytics(cursor, context):
    """Add bounded hourly product-usage rollups for commercial analytics."""

    from backend.db.schema import SCHEMA_DINH_NGHIA

    if not callable(context.build_create_table_sql):
        raise RuntimeError("Database upgrade v82 requires the canonical table builder.")
    create_sql = context.build_create_table_sql(
        "product_usage_hourly",
        SCHEMA_DINH_NGHIA["product_usage_hourly"],
    )
    if "CREATE TABLE IF NOT EXISTS" not in create_sql.upper():
        create_sql = create_sql.replace(
            "CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1
        )
    cursor.execute(create_sql)
    if callable(context.create_foreign_keys):
        context.create_foreign_keys(
            cursor,
            ("product_usage_hourly",),
            if_not_exists=True,
        )
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_product_usage_presence_recent "
        "ON product_usage_hourly (last_seen_at, user_id) "
        "WHERE metric_key = 'presence.heartbeat'",
        "CREATE INDEX IF NOT EXISTS idx_product_usage_feature_window "
        "ON product_usage_hourly (feature_key, window_started_at, user_id) "
        "WHERE metric_key = 'feature.used'",
        "DROP INDEX IF EXISTS idx_product_usage_user_window",
        "CREATE INDEX IF NOT EXISTS idx_product_usage_metric_window "
        "ON product_usage_hourly (metric_key, window_started_at, user_id) "
        "INCLUDE (event_count)",
        "CREATE INDEX IF NOT EXISTS idx_product_usage_user_fk "
        "ON product_usage_hourly (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_product_usage_hourly_owner_type_owner "
        "ON product_usage_hourly (owner_type, organization_id)",
        "CREATE INDEX IF NOT EXISTS idx_activity_product_usage "
        "ON nhat_ky_thuc_hien (occurred_at, actor_user_id) "
        "WHERE actor_user_id IS NOT NULL",
    ):
        cursor.execute(statement)
    if callable(context.create_trigger_functions):
        context.create_trigger_functions(cursor)
        cursor.execute(
            "DROP TRIGGER IF EXISTS trg_product_usage_hourly_workspace_owner "
            "ON product_usage_hourly"
        )
        cursor.execute(
            "CREATE TRIGGER trg_product_usage_hourly_workspace_owner "
            "BEFORE INSERT OR UPDATE ON product_usage_hourly "
            "FOR EACH ROW EXECUTE FUNCTION bf_validate_workspace_owner()"
        )
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
    DatabaseUpgrade(
        38,
        "add_ai_assistant_storage",
        _upgrade_to_v38_add_ai_assistant_storage,
    ),
    DatabaseUpgrade(
        39,
        "cover_ai_foreign_keys",
        _upgrade_to_v39_cover_ai_foreign_keys,
    ),
    DatabaseUpgrade(
        40,
        "add_ai_knowledge",
        _upgrade_to_v40_add_ai_knowledge,
    ),
    DatabaseUpgrade(
        41,
        "add_contractor_violation_checks",
        _upgrade_to_v41_add_contractor_violation_checks,
    ),
    DatabaseUpgrade(
        42,
        "recheck_failed_violation_snapshots",
        _upgrade_to_v42_recheck_failed_violation_snapshots,
    ),
    DatabaseUpgrade(
        43,
        "bind_session_active_role_to_workspace",
        _upgrade_to_v43_bind_session_active_role_to_workspace,
    ),
    DatabaseUpgrade(
        44,
        "enforce_sync_metadata_version_bounds",
        _upgrade_to_v44_enforce_sync_metadata_version_bounds,
    ),
    DatabaseUpgrade(
        45,
        "add_retention_cleanup_indexes",
        _upgrade_to_v45_add_retention_cleanup_indexes,
    ),
    DatabaseUpgrade(
        46,
        "reconcile_historical_chain",
        _upgrade_to_v46_reconcile_historical_chain,
    ),
    DatabaseUpgrade(
        47,
        "drop_duplicate_audit_successor_index",
        _upgrade_to_v47_drop_duplicate_audit_successor_index,
    ),
    DatabaseUpgrade(
        48,
        "add_account_status",
        _upgrade_to_v48_add_account_status,
    ),
    DatabaseUpgrade(
        49,
        "add_procurement_import_provenance",
        _upgrade_to_v49_add_procurement_import_provenance,
    ),
    DatabaseUpgrade(
        50,
        "version_procurement_binding_snapshots",
        _upgrade_to_v50_version_procurement_binding_snapshots,
    ),
    DatabaseUpgrade(
        51,
        "add_unknown_package_status",
        _upgrade_to_v51_add_unknown_package_status,
    ),
    DatabaseUpgrade(
        52,
        "add_muasamcong_provider",
        _upgrade_to_v52_add_muasamcong_provider,
    ),
    DatabaseUpgrade(
        53,
        "add_procurement_raw_snapshots",
        _upgrade_to_v53_add_procurement_raw_snapshots,
    ),
    DatabaseUpgrade(
        54,
        "allow_authoritative_procurement_resync",
        _upgrade_to_v54_allow_authoritative_procurement_resync,
    ),
    DatabaseUpgrade(
        55,
        "add_procurement_import_sessions",
        _upgrade_to_v55_add_procurement_import_sessions,
    ),
    DatabaseUpgrade(
        56,
        "separate_sensitive_record_read_capabilities",
        _upgrade_to_v56_separate_sensitive_record_read_capabilities,
    ),
    DatabaseUpgrade(
        57,
        "repair_sensitive_record_read_capability_fk",
        _upgrade_to_v57_repair_sensitive_read_capability_fk,
    ),
    DatabaseUpgrade(
        58,
        "add_document_job_authorization_policy",
        _upgrade_to_v58_add_document_job_policy,
    ),
    DatabaseUpgrade(
        59,
        "rename_websocket_delivery_to_dispatch",
        _upgrade_to_v59_rename_websocket_delivery_to_dispatch,
    ),
    DatabaseUpgrade(
        60,
        "capture_synced_delete_snapshots",
        _upgrade_to_v60_capture_synced_delete_snapshots,
    ),
    DatabaseUpgrade(
        61,
        "rename_default_workspace",
        _upgrade_to_v61_rename_default_workspace,
    ),
    DatabaseUpgrade(
        62,
        "add_ai_message_idempotency",
        _upgrade_to_v62_add_ai_message_idempotency,
    ),
    DatabaseUpgrade(
        63,
        "scope_procurement_operation_idempotency",
        _upgrade_to_v63_scope_procurement_operation_idempotency,
    ),
    DatabaseUpgrade(
        64,
        "add_conflict_resolution_drafts",
        _upgrade_to_v64_add_conflict_resolution_drafts,
    ),
    DatabaseUpgrade(
        65,
        "add_word_template_catalog",
        _upgrade_to_v65_add_word_template_catalog,
    ),
    DatabaseUpgrade(
        66,
        "preserve_word_assignment_sets",
        _upgrade_to_v66_preserve_word_assignment_sets,
    ),
    DatabaseUpgrade(
        67,
        "type_word_catalog_timestamps",
        _upgrade_to_v67_type_word_catalog_timestamps,
    ),
    DatabaseUpgrade(
        68,
        "complete_word_catalog_cutover",
        _upgrade_to_v68_complete_word_catalog_cutover,
    ),
    DatabaseUpgrade(
        69,
        "index_word_assignment_config_owner",
        _upgrade_to_v69_index_word_assignment_config_owner,
    ),
    DatabaseUpgrade(
        70,
        "add_legal_versioning",
        _upgrade_to_v70_add_legal_versioning,
    ),
    DatabaseUpgrade(
        71,
        "add_shared_procurement_cases",
        _upgrade_to_v71_add_procurement_cases,
    ),
    DatabaseUpgrade(
        72,
        "add_calendar_and_bulk_export",
        _upgrade_to_v72_add_calendar_and_bulk_export,
    ),
    DatabaseUpgrade(
        73,
        "extend_activity_for_procurement_cases",
        _upgrade_to_v73_extend_activity_for_procurement_cases,
    ),
    DatabaseUpgrade(
        74,
        "add_calendar_connectors",
        _upgrade_to_v74_add_calendar_connectors,
    ),
    DatabaseUpgrade(
        75,
        "index_post_v64_foreign_keys",
        _upgrade_to_v75_index_post_v64_foreign_keys,
    ),
    DatabaseUpgrade(
        76,
        "generic_document_jobs",
        _upgrade_to_v76_generic_document_jobs,
    ),
    DatabaseUpgrade(
        77,
        "remove_procurement_center",
        _upgrade_to_v77_remove_procurement_center,
    ),
    DatabaseUpgrade(
        78,
        "add_google_password_setup_delivery",
        _upgrade_to_v78_add_google_password_setup_delivery,
    ),
    DatabaseUpgrade(
        79,
        "add_commercial_billing_and_usage",
        _upgrade_to_v79_add_commercial_billing_and_usage,
    ),
    DatabaseUpgrade(
        80,
        "add_live_payos_profile",
        _upgrade_to_v80_add_live_payos_profile,
    ),
    DatabaseUpgrade(
        81,
        "index_commercial_foreign_keys",
        _upgrade_to_v81_index_commercial_foreign_keys,
    ),
    DatabaseUpgrade(
        82,
        "add_product_usage_analytics",
        _upgrade_to_v82_add_product_usage_analytics,
    ),
)


DB_SCHEMA_VERSION = (
    UPGRADES[-1].version if UPGRADES else BASELINE_SCHEMA_VERSION
)

# V79 adds versioned commercial, billing and usage-credit persistence. V80 adds
# the immutable process-local credential reference used by this runtime. V81
# adds child-side indexes. V82 adds bounded product-usage rollups.
DB_RUNTIME_MIN_SCHEMA_VERSION = 80
DB_RUNTIME_MAX_SCHEMA_VERSION = DB_SCHEMA_VERSION


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


def apply_database_upgrades(
    cursor,
    current_version,
    context,
    *,
    target_version=None,
):
    """Apply future upgrades registered in this file inside the caller transaction."""
    current_version = int(current_version)
    target_version = DB_SCHEMA_VERSION if target_version is None else int(target_version)
    if current_version < BASELINE_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported database schema version: {current_version}."
        )
    if target_version < BASELINE_SCHEMA_VERSION or target_version > DB_SCHEMA_VERSION:
        raise RuntimeError("Database upgrade target is outside this application version.")
    if current_version > target_version:
        raise RuntimeError("Database schema is newer than the requested target.")
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
        if upgrade.version > target_version:
            break
        _prepare_historical_upgrade(
            cursor,
            context,
            upgrade.version,
        )
        upgrade.apply(
            cursor,
            _context_for_historical_upgrade(context, upgrade.version),
        )
        record_database_version(cursor, upgrade.version)
        current_version = upgrade.version

    if current_version != target_version:
        raise RuntimeError(
            f"No upgrade path from schema version {current_version} "
            f"to {target_version}."
        )
    return current_version
