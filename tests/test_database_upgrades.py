from backend.db import upgrades


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, statement, parameters=()):
        self.calls.append((" ".join(statement.split()), tuple(parameters)))
        return self


def _context():
    return upgrades.DatabaseUpgradeContext(
        build_create_table_sql=lambda table_name, _table_spec: (
            f"CREATE TABLE IF NOT EXISTS {table_name} (id TEXT)"
        ),
        create_indexes_and_triggers=lambda _cursor: None,
        assert_foreign_key_integrity=lambda _cursor: None,
        create_foreign_keys=lambda *_args, **_kwargs: None,
    )


def test_mfa_removal_upgrades_drop_legacy_objects_and_advance_version():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        upgrades.BASELINE_SCHEMA_VERSION,
        _context(),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert "DROP TABLE IF EXISTS account_mfa" in statements
    assert (
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
        in statements
    )
    assert statements.count("DROP TABLE IF EXISTS account_mfa") == 2
    assert statements.count(
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
    ) == 2
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert any(
        "idx_auth_sessions_one_active_per_user" in statement
        for statement in statements
    )
    assert any(
        "ALTER TABLE goi_thau_chuyen_gia ADD COLUMN IF NOT EXISTS updated_at"
        in statement
        for statement in statements
    )
    assert any(
        "SET trong_so_ky_thuat = NULL" in statement
        for statement in statements
    )
    assert any(
        "ADD COLUMN IF NOT EXISTS so_to_trinh_du_toan TEXT" in statement
        for statement in statements
    )
    assert any(
        "ADD COLUMN IF NOT EXISTS so_to_trinh_ke_hoach TEXT" in statement
        for statement in statements
    )
    assert any(
        "ADD COLUMN IF NOT EXISTS so_to_trinh_du_toan_ke_hoach TEXT" in statement
        for statement in statements
    )
    assert any("dot_xu_ly_phan_lo" in statement for statement in statements)
    assert any("idx_lot_batch_detail_one_active" in statement for statement in statements)
    assert any("goi_thau_awarded_result_check" in statement for statement in statements)
    assert any("PARTIALLY_AWARDED" in statement for statement in statements)
    assert version == upgrades.DB_SCHEMA_VERSION == 14


def test_v2_installation_reconciles_retired_mfa_schema_in_v3():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        2,
        _context(),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert "DROP TABLE IF EXISTS account_mfa" in statements
    assert (
        "ALTER TABLE auth_sessions DROP COLUMN IF EXISTS mfa_verified_at"
        in statements
    )
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert version == upgrades.DB_SCHEMA_VERSION == 14


def test_v3_installation_enforces_one_active_session_in_v4():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        3,
        _context(),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert any("ROW_NUMBER() OVER" in statement for statement in statements)
    assert any(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_one_active_per_user"
        in statement
        for statement in statements
    )
    assert version == upgrades.DB_SCHEMA_VERSION == 14


def test_v4_installation_adds_package_expert_updated_at_in_v5():
    cursor = _Cursor()

    version = upgrades.apply_database_upgrades(
        cursor,
        4,
        _context(),
    )

    statements = [statement for statement, _ in cursor.calls]
    assert any(
        "ALTER TABLE goi_thau_chuyen_gia ADD COLUMN IF NOT EXISTS updated_at"
        in statement
        for statement in statements
    )
    assert version == upgrades.DB_SCHEMA_VERSION == 14


def test_v14_reconciles_lifecycle_foreign_keys_and_schema_objects():
    cursor = _Cursor()
    foreign_key_calls = []
    schema_object_calls = []
    context = upgrades.DatabaseUpgradeContext(
        build_create_table_sql=lambda *_args: "",
        create_indexes_and_triggers=lambda current_cursor: schema_object_calls.append(
            current_cursor
        ),
        assert_foreign_key_integrity=lambda _cursor: None,
        create_foreign_keys=lambda current_cursor, table_names, **kwargs: (
            foreign_key_calls.append((current_cursor, tuple(table_names), kwargs))
        ),
    )

    version = upgrades.apply_database_upgrades(cursor, 13, context)

    assert version == 14
    assert foreign_key_calls == [
        (
            cursor,
            (
                "dot_xu_ly_phan_lo",
                "dot_xu_ly_phan_lo_chi_tiet",
                "nhom_phu_thuoc_phan_lo",
                "nhom_phu_thuoc_phan_lo_thanh_vien",
                "ho_so_nghiep_vu_lcnt",
                "ho_so_nghiep_vu_lcnt_phan_lo",
            ),
            {"if_not_exists": True},
        )
    ]
    assert schema_object_calls == [cursor]
    statements = [statement for statement, _params in cursor.calls]
    assert any("PRIMARY KEY (organization_id, id)" in sql for sql in statements)
    assert any("organization_id LIKE 'personal:%'" in sql for sql in statements)
