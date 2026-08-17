from backend.documents.technical_evaluation_method import (
    PASS_FAIL,
    SCORE,
    UNKNOWN,
    resolve_technical_evaluation_method,
)


def test_technical_evaluation_method_matches_frontend_domain_rules():
    assert resolve_technical_evaluation_method({
        "linh_vuc": "Tư vấn",
    }) == SCORE
    assert resolve_technical_evaluation_method({
        "hinh_thuc_lua_chon": "Chào hàng cạnh tranh",
        "phuong_phap_danh_gia": "Kết hợp giữa kỹ thuật và giá",
    }) == PASS_FAIL
    assert resolve_technical_evaluation_method({
        "phuong_phap_danh_gia": "Kết hợp giữa kỹ thuật và giá",
    }) == SCORE
    assert resolve_technical_evaluation_method({
        "phuong_phap_danh_gia": "Dựa trên kỹ thuật",
    }) == SCORE
    assert resolve_technical_evaluation_method({
        "technical_evaluation_method": "Đạt/Không đạt",
    }) == PASS_FAIL
    assert resolve_technical_evaluation_method({
        "phuong_phap_danh_gia": "Giá thấp nhất",
    }) == UNKNOWN
