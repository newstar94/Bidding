from types import SimpleNamespace

from backend.db.schema import MONEY_COLUMNS, ROW_VERSION_TABLES, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.shared.access_policy import (
    BatchWriteAuthorizationContext,
    authorize_record_write_from_context,
)
from backend.domain.goods_workflow import supports_goods_workflow
from backend.sync.package_goods import (
    validate_package_goods_batch,
    validate_package_goods_configuration_change,
)
from backend.sync.ownership import OwnerReferenceContext, validate_owner_scoped_references
from backend.sync.payload_validation import validate_sync_item
from backend.sync.queries import TABLE_KEYS


def test_package_goods_schema_and_sync_registration():
    spec = SCHEMA_DINH_NGHIA["goi_thau_hang_hoa"]
    assert TABLE_KEYS["goithauhanghoa"] == "goi_thau_hang_hoa"
    assert "goi_thau_hang_hoa" in ROW_VERSION_TABLES
    assert "row_version" in spec["columns"]
    assert ("goi_thau_hang_hoa", "don_gia_du_toan") in MONEY_COLUMNS
    assert any("REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE" in fk for fk in spec["foreign_keys"])
    assert any("REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT" in fk for fk in spec["foreign_keys"])
    assert DB_SCHEMA_VERSION >= 22


def test_package_goods_required_values_and_positive_quantity():
    _item, errors, _ = validate_sync_item(
        "goi_thau_hang_hoa",
        {"goiThauId": "package-1", "maHangHoa": " ", "tenHangHoa": "", "donViTinh": "", "soLuong": 0},
        set(),
    )
    message = " ".join(errors)
    assert "Mã hàng hóa" in message
    assert "Tên hàng hóa" in message
    assert "Đơn vị tính" in message
    assert "lớn hơn 0" in message


def test_goods_workflow_supports_trimmed_goods_and_mixed_fields_only():
    assert supports_goods_workflow(" Hàng hóa ")
    assert supports_goods_workflow(" Hỗn hợp ")
    assert not supports_goods_workflow("Tư vấn")
    assert not supports_goods_workflow("Xây lắp")


class _GoodsCursor:
    def execute(self, _sql, _params):
        return self

    def fetchall(self):
        return [("stored-1", "package-1", None, "hh01")]


def test_package_goods_duplicate_scope_is_case_insensitive_and_batched():
    errors = validate_package_goods_batch(_GoodsCursor(), "org-1", [
        {"id": "new-1", "goiThauId": "package-1", "phanLoId": None, "maHangHoa": " HH01 "},
        {"id": "new-2", "goiThauId": "package-1", "phanLoId": None, "maHangHoa": "hh01"},
    ])
    assert len(errors) == 3
    assert all(error["code"] == "DUPLICATE_GOODS_CODE" for error in errors)


def _access_context(*, status="PREPARING", assigned=True, snapshot=False):
    return BatchWriteAuthorizationContext(
        role_str=SimpleNamespace(active_role="employee"),
        user_id="employee-1",
        organization_id="org-1",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"goithau": "edit"},
        assigned_targets={("goithau", "package-1")} if assigned else set(),
        goods_parent_by_id={"goods-1": "package-1"},
        package_status_by_id={"package-1": status},
        snapshot_package_ids={"package-1"} if snapshot else set(),
    )


def test_package_goods_write_inherits_package_assignment_and_status_lock():
    item = {"id": "goods-1", "goiThauId": "package-1"}
    assert authorize_record_write_from_context(
        _access_context(), "goithauhanghoa", "goi_thau_hang_hoa", item
    ).allowed
    assert not authorize_record_write_from_context(
        _access_context(assigned=False), "goithauhanghoa", "goi_thau_hang_hoa", item
    ).allowed
    locked = authorize_record_write_from_context(
        _access_context(status="INVITED"), "goithauhanghoa", "goi_thau_hang_hoa", item
    )
    assert not locked.allowed
    assert "Chuẩn bị" in locked.message


def test_awarded_snapshot_allows_only_new_cloned_package_goods():
    context = _access_context(status="AWARDED", snapshot=True)
    new_child = authorize_record_write_from_context(
        context,
        "goithauhanghoa",
        "goi_thau_hang_hoa",
        {"id": "goods-v2", "goiThauId": "package-1"},
    )
    stored_child = authorize_record_write_from_context(
        context,
        "goithauhanghoa",
        "goi_thau_hang_hoa",
        {"id": "goods-1", "goiThauId": "package-1"},
    )

    assert new_child.allowed
    assert not stored_child.allowed


def test_new_snapshot_goods_can_reference_a_new_lot_from_the_same_package_payload():
    package = {
        "id": "package-new",
        "linhVuc": "Hàng hóa",
        "phanLo": "Có",
        "phanLoList": [{"id": "lot-new", "maPhanLo": "PP01"}],
    }
    goods = {
        "id": "goods-new",
        "goiThauId": "package-new",
        "phanLoId": "lot-new",
    }
    errors = validate_owner_scoped_references(
        None,
        "org-1",
        "goi_thau_hang_hoa",
        goods,
        {"goi_thau": {"package-new"}},
        {"goi_thau": {"package-new": package}},
        OwnerReferenceContext(),
    )
    assert errors == []


def test_mixed_package_goods_pass_ownership_validation():
    package = {
        "id": "package-mixed",
        "linhVuc": " Hỗn hợp ",
        "phanLo": "Không",
        "phanLoList": [],
    }
    errors = validate_owner_scoped_references(
        None,
        "org-1",
        "goi_thau_hang_hoa",
        {"id": "goods-mixed", "goiThauId": "package-mixed", "phanLoId": None},
        {"goi_thau": {"package-mixed"}},
        {"goi_thau": {"package-mixed": package}},
        OwnerReferenceContext(),
    )
    assert errors == []


def test_goods_configuration_can_switch_between_goods_and_mixed_only():
    import sqlite3

    connection = sqlite3.connect(":memory:")
    connection.execute(
        "CREATE TABLE goi_thau_hang_hoa "
        "(id TEXT, organization_id TEXT, goi_thau_id TEXT, phan_lo_id TEXT)"
    )
    connection.execute(
        "INSERT INTO goi_thau_hang_hoa VALUES ('goods-1', 'org-1', 'package-1', NULL)"
    )
    current_goods = {
        "id": "package-1",
        "linh_vuc": "Hàng hóa",
        "phan_lo": "Không",
    }
    current_mixed = {**current_goods, "linh_vuc": "Hỗn hợp"}
    assert validate_package_goods_configuration_change(
        connection.cursor(), "org-1", current_goods, {"linhVuc": "Hỗn hợp"}
    ) == []
    assert validate_package_goods_configuration_change(
        connection.cursor(), "org-1", current_mixed, {"linhVuc": "Hàng hóa"}
    ) == []
    errors = validate_package_goods_configuration_change(
        connection.cursor(), "org-1", current_mixed, {"linhVuc": "Xây lắp"}
    )
    assert len(errors) == 1
    assert "Hàng hóa hoặc Hỗn hợp" in errors[0]
    connection.close()
