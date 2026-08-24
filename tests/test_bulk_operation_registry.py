from backend.bulk_operations.registry import EXPORT_RECORD_DATA, resolve_action


def test_bulk_registry_is_closed_to_export_record_data_v1():
    assert resolve_action("EXPORT_RECORD_DATA") is EXPORT_RECORD_DATA
    assert resolve_action("SET_STATE") is None
    assert EXPORT_RECORD_DATA.target_types == frozenset({"kehoach", "goithau"})
    assert EXPORT_RECORD_DATA.max_size == 100
    assert EXPORT_RECORD_DATA.execution == "STAGED_FINALIZE"
    assert EXPORT_RECORD_DATA.side_effect_boundary == "FILESYSTEM"

