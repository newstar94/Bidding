from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.sync.aggregate_mutability import PACKAGE_CHILD_TABLES
from backend.versioning.aggregate_policy import PACKAGE_RELATION_REGISTRY


def _package_owned_schema_tables():
    result = set()
    for table_name, spec in SCHEMA_DINH_NGHIA.items():
        foreign_keys = " ".join(spec.get("foreign_keys", ()))
        if "REFERENCES goi_thau(" in foreign_keys and table_name != "goi_thau":
            result.add(table_name)
    return result


def test_package_relation_and_mutability_registries_cover_schema_ownership():
    schema_tables = _package_owned_schema_tables()
    relation_tables = {policy.table_name for policy in PACKAGE_RELATION_REGISTRY}

    assert schema_tables <= relation_tables
    assert relation_tables <= set(SCHEMA_DINH_NGHIA)
    assert schema_tables - {"hop_dong_goi_thau"} <= PACKAGE_CHILD_TABLES
    assert PACKAGE_CHILD_TABLES <= set(SCHEMA_DINH_NGHIA)


def test_relation_registry_declares_disposition_for_every_entry():
    assert all(
        policy.disposition in {"clone", "retain", "derived"}
        for policy in PACKAGE_RELATION_REGISTRY
    )
    assert any(
        policy.table_name == "goi_thau_chuyen_gia"
        and policy.disposition == "clone"
        and policy.external_reference
        for policy in PACKAGE_RELATION_REGISTRY
    )
