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
        "message": "Đã lưu kế hoạch.",
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
    assert normalized["message"] == "Đã lưu 3 mốc áp dụng."
    assert _normalize("", "error")["message"] == "Thao tác không thành công. Vui lòng thử lại."


def test_toast_feedback_preserves_action_context_and_useful_next_step():
    message = "Không thể lưu kế hoạch. Vui lòng kiểm tra dữ liệu và thử lại."
    normalized = _normalize(message, "error")

    assert normalized == {
        "title": "Thất bại",
        "message": message,
        "type": "error",
    }


def test_sync_toasts_do_not_expose_backend_terminology():
    source = (ROOT / "frontend" / "app" / "BiddingControllerSync.js").read_text(encoding="utf-8")
    assert '"Đã xác nhận trên máy chủ"' not in source
    assert "không được máy chủ chấp nhận" not in source
    assert 'this.view.showToast("Thất bại", "Không thể lưu thay đổi. Vui lòng thử lại.", "error")' in source


def test_bidding_view_normalizes_every_toast_before_rendering():
    source = (ROOT / "frontend" / "app" / "BiddingView.js").read_text(encoding="utf-8")
    normalize_call = "({ title, message, type } = normalizeToastFeedback(message, type));"
    deduplication_call = "const toastKey = toastDeduplicationKey(title, message, type);"
    assert normalize_call in source
    assert source.index(normalize_call) < source.index(deduplication_call)
