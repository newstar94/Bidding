import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOAST_MODULE = ROOT / "frontend" / "shared" / "toastFeedback.js"


def _normalize(message, toast_type):
    module_uri = TOAST_MODULE.resolve().as_uri()
    script = f"""
        import {{ normalizeToastFeedback }} from {json.dumps(module_uri)};
        process.stdout.write(JSON.stringify(normalizeToastFeedback(
            {json.dumps(message)}, {json.dumps(toast_type)}
        )));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def test_toast_feedback_uses_only_three_user_facing_states():
    assert _normalize("Đã lưu kế hoạch.", "success") == {
        "title": "Thành công",
        "message": "Lưu kế hoạch thành công.",
        "type": "success",
    }
    assert _normalize("Không thể lưu. Vui lòng thử lại.", "error")["title"] == "Thất bại"
    assert _normalize("Không có phiên bản trước.", "info") == {
        "title": "Cảnh báo",
        "message": "Không có phiên bản trước.",
        "type": "warning",
    }


def test_toast_feedback_keeps_content_concise_and_has_safe_defaults():
    normalized = _normalize("  Đã lưu   3 mốc áp dụng.\n", "success")
    assert normalized["message"] == "Lưu thành công."
    assert _normalize("", "error")["message"] == "Thao tác thất bại. Vui lòng thử lại."


def test_toast_feedback_keeps_only_action_context_and_useful_next_step():
    message = "Không thể lưu kế hoạch. Vui lòng kiểm tra dữ liệu và thử lại."
    normalized = _normalize(message, "error")

    assert normalized == {
        "title": "Thất bại",
        "message": "Lưu kế hoạch thất bại. Vui lòng thử lại.",
        "type": "error",
    }


def test_error_toast_includes_entity_for_mutating_actions():
    cases = {
        "Không thể thêm nhà thầu. Vui lòng thử lại.": "Thêm nhà thầu thất bại. Vui lòng thử lại.",
        "Không thể cập nhật hợp đồng. Vui lòng thử lại.": "Cập nhật hợp đồng thất bại. Vui lòng thử lại.",
        "Không thể phê duyệt kết quả trúng thầu. Vui lòng thử lại.": "Phê duyệt kết quả gói thầu thất bại. Vui lòng thử lại.",
    }
    for source, expected in cases.items():
        assert _normalize(source, "error")["message"] == expected


def test_toast_feedback_maps_common_actions_to_short_messages():
    assert _normalize(
        "Đã lưu kế hoạch và cấu trúc phân chia chi tiết công việc thành công!",
        "success",
    )["message"] == "Lưu kế hoạch thành công."
    assert _normalize("Đã xóa toàn bộ các phiên bản của hợp đồng!", "success")["message"] == "Xóa hợp đồng thành công."
    assert _normalize("Thông tin nhân viên đã được cập nhật thành công!", "success")["message"] == "Cập nhật nhân viên thành công."
    assert _normalize("Đã nhập thành công 25 dòng dữ liệu từ Excel.", "success")["message"] == "Nhập dữ liệu thành công."
    assert _normalize("Đã xử lý 25 dòng: thêm mới 20, cập nhật 5.", "success")["message"] == "Nhập dữ liệu thành công."
    assert _normalize(
        "Lưu Ma trận thầu. Ma trận phân quyền đã được áp dụng thành công.",
        "success",
    )["message"] == "Cập nhật phân quyền thành công."
    assert _normalize(
        "1 mục đã được lưu trữ; 3 bản ghi liên quan đã được cập nhật.",
        "success",
    )["message"] == "Cập nhật thành công."


def test_toast_feedback_does_not_expose_technical_details():
    normalized = _normalize(
        "Máy chủ trả về HTTP 500 tại /api/sync, requestId=abc. Vui lòng thử lại.",
        "error",
    )
    assert normalized["message"] == "Kết nối thất bại. Vui lòng thử lại."
    assert "HTTP" not in normalized["message"]
    assert "requestId" not in normalized["message"]


def test_toast_feedback_keeps_short_validation_and_conflict_guidance():
    validation = "Ngày không hợp lệ. Vui lòng nhập theo định dạng dd/MM/yyyy."
    assert _normalize(validation, "error")["message"] == validation
    assert _normalize(
        "Dữ liệu đã thay đổi trong lúc bạn thao tác. Ứng dụng đang tải lại dữ liệu mới nhất; vui lòng kiểm tra và lưu lại.",
        "warning",
    )["message"] == "Dữ liệu đã thay đổi. Vui lòng kiểm tra và lưu lại."


def test_success_dialog_title_contributes_action_context_to_toast():
    source = (ROOT / "frontend" / "app" / "BiddingView.js").read_text(encoding="utf-8")
    assert 'title && title !== "Thành công" ? `${title}. ${message || ""}` : message' in source


def test_delete_sync_has_one_concise_success_toast_and_no_duplicate_workflow_toast():
    sync_source = (ROOT / "frontend" / "app" / "BiddingControllerSync.js").read_text(encoding="utf-8")
    assert 'this.view.showToast("Thành công", deleteSuccessMessage(payload, data.deleteImpacts), "success")' in sync_source
    assert 'goithau: "gói thầu"' in sync_source
    assert "mục đã được lưu trữ" not in sync_source

    for relative_path in (
        "frontend/packages/packageLifecycleWorkflow.js",
        "frontend/plans/KeHoachWorkflow.js",
        "frontend/contracts/HopDongWorkflow.js",
    ):
        source = (ROOT / relative_path).read_text(encoding="utf-8")
        assert 'customAlert("Thành công", "Đã xóa' not in source


def test_sync_toasts_do_not_expose_backend_terminology():
    source = (ROOT / "frontend" / "app" / "BiddingControllerSync.js").read_text(encoding="utf-8")
    assert '"Đã xác nhận trên máy chủ"' not in source
    assert "không được máy chủ chấp nhận" not in source
    assert 'this.view.showToast("Thất bại", "Không thể lưu thay đổi. Vui lòng thử lại.", "error")' in source


def test_toast_feedback_includes_entity_for_create_update_and_workflow_actions():
    cases = {
        "Đã thêm gói thầu mới thành công!": "Thêm gói thầu thành công.",
        "Đã thêm toàn bộ các gói thầu theo kế hoạch thành công!": "Thêm gói thầu thành công.",
        "Đã tạo chủ đầu tư thành công!": "Thêm chủ đầu tư thành công.",
        "Đã cập nhật hợp đồng thành công!": "Cập nhật hợp đồng thành công.",
        "Đã chỉnh sửa thông tin nhà thầu thành công!": "Cập nhật nhà thầu thành công.",
        "Đã khôi phục trạng thái gói thầu thành công.": "Khôi phục gói thầu thành công.",
        "Đã phê duyệt kết quả lựa chọn nhà thầu thành công!": "Phê duyệt kết quả gói thầu thành công.",
        "Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!": "Phê duyệt kết quả gói thầu thành công.",
        "Đã phát hành HSMT thành công!": "Phát hành hồ sơ mời thầu thành công.",
        "Đã tải xuống checklist timeline.": "Tải xuống timeline thành công.",
        "Đã nhập dữ liệu gói thầu thành công.": "Nhập gói thầu thành công.",
        "Đã cập nhật thông tin cá nhân thành công!": "Cập nhật thông tin cá nhân thành công.",
        "Đã lưu biến ánh xạ thành công!": "Lưu biến Word thành công.",
    }
    for source, expected in cases.items():
        assert _normalize(source, "success")["message"] == expected


def test_bidding_view_normalizes_every_toast_before_rendering():
    source = (ROOT / "frontend" / "app" / "BiddingView.js").read_text(encoding="utf-8")
    normalize_call = "({ title, message, type } = normalizeToastFeedback(message, type));"
    deduplication_call = "const toastKey = toastDeduplicationKey(title, message, type);"
    assert normalize_call in source
    assert source.index(normalize_call) < source.index(deduplication_call)
