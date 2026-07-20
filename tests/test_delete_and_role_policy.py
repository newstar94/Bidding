from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_delete_flows_refresh_the_server_row_before_capturing_row_version():
    expected = {
        "frontend/contracts/HopDongWorkflow.js": 'refreshRecordBeforeDelete(this, "hopdong", id)',
        "frontend/packages/packageLifecycleWorkflow.js": 'refreshRecordBeforeDelete(this, "goithau", id)',
        "frontend/plans/KeHoachWorkflow.js": 'refreshRecordBeforeDelete(this, "kehoach", id)',
        "frontend/partners/ChuDauTuWorkflow.js": 'refreshRecordBeforeDelete(this, "chudautu", id)',
        "frontend/partners/NhaThauWorkflow.js": 'refreshRecordBeforeDelete(this, "nhathau", id)',
        "frontend/experts/ChuyenGiaWorkflow.js": 'refreshRecordBeforeDelete(this, "chuyengia", id)',
        "frontend/admin/AdminUserController.js": 'refreshRecordBeforeDelete(this, "custompaperstatuses", id)',
    }
    for relative_path, marker in expected.items():
        source = (ROOT / relative_path).read_text(encoding="utf-8-sig")
        assert marker in source


def test_contract_delete_uses_the_atomic_persist_and_sync_path():
    source = (ROOT / "frontend/contracts/HopDongWorkflow.js").read_text(encoding="utf-8-sig")
    delete_block = source[source.index("export async function deleteHopDong"):source.index("export async function editHopDong")]
    assert 'persistAndSync(this, "hopdong"' in delete_block
    assert 'this.model.persistData("hopdong")' not in delete_block
    assert 'this.autoSync()' not in delete_block


def test_employee_can_edit_but_delete_actions_are_hidden():
    for relative_path in (
        "frontend/plans/KeHoachView.js",
        "frontend/contracts/HopDongComponent.js",
        "frontend/partners/ChuDauTuComponent.js",
        "frontend/partners/NhaThauComponent.js",
        "frontend/experts/ChuyenGiaComponent.js",
    ):
        source = (ROOT / relative_path).read_text(encoding="utf-8-sig")
        assert "allowDelete: this.model.state.activerole !== \"employee\"" in source

    package_source = (ROOT / "frontend/packages/GoiThauTable.js").read_text(encoding="utf-8-sig")
    assert 'const allowDelete = this.model.state.activerole !== "employee";' in package_source

    expert_workflow = (ROOT / "frontend/experts/ChuyenGiaWorkflow.js").read_text(encoding="utf-8-sig")
    assert "không được phép chỉnh sửa thông tin Chuyên gia" not in expert_workflow


def test_server_rejects_non_manager_organization_deletes_for_non_aggregate_rows():
    source = (ROOT / "backend/sync/deletion_service.py").read_text(encoding="utf-8")
    assert '"DELETE_ROLE_PROTECTED"' in source
    assert "Chuyên viên chỉ được chỉnh sửa, không được xóa dữ liệu." in source
