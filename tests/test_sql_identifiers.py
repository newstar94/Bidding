import pytest

from backend.ai.workspace_search import ENTITY_SPECS
from backend.ai.workspace_schema import _field_options, _validate_spec_identifiers
from backend.shared.sql_identifiers import sql_alias, sql_identifier


@pytest.mark.parametrize("name", ["goi_thau", "ke_hoach_lcnt", "_x1"])
def test_plain_identifiers_are_accepted(name):
    assert sql_identifier(name) == name


@pytest.mark.parametrize(
    "name",
    ["", "GoiThau", "goi_thau; DROP TABLE x", "a b", "1abc", "x" * 64, None, 'a"b'],
)
def test_unsafe_identifiers_are_rejected(name):
    with pytest.raises(ValueError):
        sql_identifier(name)


def test_allowlist_is_enforced():
    assert sql_identifier("nha_thau", allowed={"nha_thau"}) == "nha_thau"
    with pytest.raises(ValueError):
        sql_identifier("tai_khoan", allowed={"nha_thau"})


def test_alias_rejects_quotes_and_control_characters():
    assert sql_alias("Tên gói thầu") == '"Tên gói thầu"'
    for label in ('a"b', "a\nb", ""):
        with pytest.raises(ValueError):
            sql_alias(label)


def test_dashboard_latest_cte_rejects_unknown_tables():
    from backend.sync import dashboard_summary

    assert "tai_khoan" not in dashboard_summary._DASHBOARD_LATEST_TABLES
    with pytest.raises(ValueError):
        sql_identifier("tai_khoan", allowed=dashboard_summary._DASHBOARD_LATEST_TABLES)


def test_every_workspace_entity_spec_uses_safe_identifiers():
    specs = ENTITY_SPECS.values() if isinstance(ENTITY_SPECS, dict) else ENTITY_SPECS
    for spec in specs:
        _validate_spec_identifiers(spec, _field_options(spec))
