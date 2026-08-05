"""Static business metric registry; model strings never become SQL."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetricSpec:
    id: str
    label: str
    entity: str
    aggregation: str
    value_column: str | None
    date_column: str | None
    module: str
    default_date_column: str | None
    status_expression: str | None = None
    supported_groups: tuple[str, ...] = ("none", "year", "month")
    description: str = ""


METRICS = {
    "packages": {
        "count": MetricSpec("count", "Số gói thầu", "packages", "count", None, None, "goithau", None, description="Đếm gói thầu đang hoạt động."),
        "sum_package_value": MetricSpec("sum_package_value", "Tổng giá gói thầu", "packages", "sum", "gia_goi_thau", None, "goithau", None, supported_groups=("none", "year", "month", "status")),
        "issued_count": MetricSpec("issued_count", "Số gói đã phát hành", "packages", "count", None, "thoi_gian_dang_tai", "goithau", "thoi_gian_dang_tai", status_expression="thoi_gian_dang_tai IS NOT NULL"),
        "awarded_count": MetricSpec("awarded_count", "Số gói đã có kết quả", "packages", "count", None, "ngay_quyet_dinh_ket_qua", "goithau", "ngay_quyet_dinh_ket_qua", status_expression="ngay_quyet_dinh_ket_qua IS NOT NULL"),
        "preparing_count": MetricSpec("preparing_count", "Số gói đang chuẩn bị", "packages", "count", None, None, "goithau", None, status_expression="trang_thai = 'PREPARING'"),
        "evaluating_count": MetricSpec("evaluating_count", "Số gói đang đánh giá", "packages", "count", None, None, "goithau", None, status_expression="trang_thai = 'EVALUATING'"),
        "opened_count": MetricSpec("opened_count", "Số gói đã mở thầu", "packages", "count", None, "thoi_gian_mo_thau", "goithau", "thoi_gian_mo_thau", status_expression="thoi_gian_mo_thau IS NOT NULL"),
        "delayed_count": MetricSpec("delayed_count", "Số gói chậm tiến độ", "packages", "count", None, None, "goithau", None, status_expression="EXISTS (SELECT 1 FROM goi_thau_moc_tien_do m WHERE m.organization_id = goi_thau.organization_id AND m.goi_thau_id = goi_thau.id AND m.ngay_du_kien IS NOT NULL AND m.ngay_du_kien < CURRENT_DATE AND COALESCE(m.trang_thai, '') NOT IN ('completed', 'COMPLETED', 'done'))"),
        "without_expert_count": MetricSpec("without_expert_count", "Số gói chưa phân công chuyên gia", "packages", "count", None, None, "goithau", None, status_expression="NOT EXISTS (SELECT 1 FROM goi_thau_chuyen_gia e WHERE e.organization_id = goi_thau.organization_id AND e.goi_thau_id = goi_thau.id)"),
        "without_contract_count": MetricSpec("without_contract_count", "Số gói có kết quả nhưng chưa có hợp đồng", "packages", "count", None, "ngay_quyet_dinh_ket_qua", "goithau", "ngay_quyet_dinh_ket_qua", status_expression="ngay_quyet_dinh_ket_qua IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hop_dong_goi_thau h WHERE h.organization_id = goi_thau.organization_id AND h.goi_thau_id = goi_thau.id)"),
    },
    "plans": {
        "count": MetricSpec("count", "Số kế hoạch", "plans", "count", None, None, "kehoach", None),
        "sum_plan_value": MetricSpec("sum_plan_value", "Tổng giá trị kế hoạch", "plans", "sum", "tong_muc_dau_tu", None, "kehoach", None, supported_groups=("none", "year", "month")),
        "unapproved_count": MetricSpec("unapproved_count", "Số kế hoạch chưa phê duyệt", "plans", "count", None, "ngay_phe_duyet", "kehoach", "ngay_phe_duyet", status_expression="COALESCE(TRIM(phe_duyet), '') NOT IN ('Đã phê duyệt', 'Da phe duyet', 'APPROVED')"),
        "without_package_count": MetricSpec("without_package_count", "Số kế hoạch chưa có gói thầu", "plans", "count", None, None, "kehoach", None, status_expression="NOT EXISTS (SELECT 1 FROM goi_thau p WHERE p.organization_id = ke_hoach_lcnt.organization_id AND p.ke_hoach_id = ke_hoach_lcnt.id AND p.archived_at IS NULL)"),
    },
    "contracts": {
        "count": MetricSpec("count", "Số hợp đồng", "contracts", "count", None, "ngay_ky", "hopdong", "ngay_ky", supported_groups=("none", "year", "month", "status", "contract_type")),
        "sum_contract_value": MetricSpec("sum_contract_value", "Tổng giá trị hợp đồng", "contracts", "sum", "gia_tri", "ngay_ky", "hopdong", "ngay_ky", supported_groups=("none", "year", "month", "status", "contract_type")),
        "sum_liquidation_value": MetricSpec("sum_liquidation_value", "Tổng giá trị hợp đồng đã thanh lý", "contracts", "sum", "gia_tri", "ngay_thanh_ly", "hopdong", "ngay_thanh_ly", status_expression="ngay_thanh_ly IS NOT NULL AND COALESCE(TRIM(trang_thai_hop_dong), '') NOT IN ('Đã hủy', 'Đã huỷ', 'CANCELLED')", supported_groups=("none", "year", "month", "status", "contract_type")),
        "current_count": MetricSpec("current_count", "Số hợp đồng đang thực hiện", "contracts", "count", None, None, "hopdong", None, status_expression="trang_thai_hop_dong IN ('Đang thực hiện', 'ACTIVE', 'IN_PROGRESS')"),
        "delayed_count": MetricSpec("delayed_count", "Số hợp đồng chậm tiến độ", "contracts", "count", None, None, "hopdong", None, status_expression="trang_thai_hop_dong IN ('Chậm tiến độ', 'Tạm dừng', 'DELAYED', 'SUSPENDED')"),
    },
}


def get_metric(entity: str, metric: str) -> MetricSpec:
    try:
        spec = METRICS[str(entity)][str(metric)]
    except KeyError as exc:
        raise ValueError("Unsupported semantic metric") from exc
    return spec


def supported_metrics(entity: str) -> tuple[str, ...]:
    return tuple(METRICS.get(str(entity), {}).keys())
