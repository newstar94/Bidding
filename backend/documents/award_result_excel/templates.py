"""Versioned registry for supported muasamcong award workbook structures."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import unicodedata


EXPECTED_HEADERS = (
    "Mã phần (lô)", "Tên phần (lô)", "Mã định danh", "Mã số thuế",
    "Tên nhà thầu", "Giá dự thầu", "Kết quả",
    "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    "Điểm kỹ thuật (nếu có)", "Giá đánh giá (nếu có)", "Giá trúng thầu",
    "Lý do không đáp ứng", "Thời gian thực hiện gói thầu",
    "Thời gian thực hiện hợp đồng", "Các nội dung khác (nếu có)",
)

MEDICINE_EXPECTED_HEADERS = (
    "STT", "Mã phần (lô)", "Tên hoạt chất/ Tên thành phần thuốc",
    "Mã định danh", "Mã số thuế", "Tên nhà thầu", "Giá dự thầu", "Kết quả",
    "Giá dự thầu sau hiệu chỉnh sai lệch thừa (nếu có), giảm giá (nếu có)",
    "Điểm kỹ thuật (nếu có)", "Giá đánh giá (nếu có)", "Số lượng trúng thầu",
    "Đơn giá trúng thầu (VND)", "Tỷ lệ giảm giá", "Giá trúng thầu",
    "Lý do không đáp ứng", "Thời gian thực hiện gói thầu",
    "Thời gian thực hiện hợp đồng", "Các nội dung khác (nếu có)",
)

_STANDARD_HEADER_ALIASES = {
    0: {"Mã phần/lô", "Mã lô", "Mã phần"},
    1: {"Tên phần/lô", "Tên lô", "Tên phần"},
    2: {"Mã định danh nhà thầu", "Mã nhà thầu"},
    3: {"Mã số thuế nhà thầu"},
    4: {"Tên nhà thầu (Nhập chính xác)"},
    5: {"Giá dự thầu (VND)"},
    7: {"Giá sau sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá", EXPECTED_HEADERS[7]},
    8: {"Điểm kỹ thuật"},
    9: {"Giá đánh giá"},
    10: {"Giá trúng thầu (VND)"},
    11: {"Lý do không đáp ứng", "Lý do không đáp ứng hoặc lý do không trúng thầu"},
    12: {"Thời gian thực hiện gói thầu (ngày)"},
    13: {"Thời gian thực hiện hợp đồng (ngày)"},
    14: {"Các nội dung khác (nếu có)", "Nội dung khác (nếu có)"},
}

_MEDICINE_HEADER_ALIASES = {
    1: {"Mã phần/lô", "Mã lô", "Mã phần"},
    2: {"Tên hoạt chất/Tên thành phần thuốc", "Tên hoạt chất", "Tên thành phần thuốc"},
    3: {"Mã định danh nhà thầu", "Mã nhà thầu"},
    4: {"Mã số thuế nhà thầu"},
    5: {"Tên nhà thầu (Nhập chính xác)"},
    6: {"Giá dự thầu (VND)"},
    8: {"Giá sau sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá", MEDICINE_EXPECTED_HEADERS[8]},
    9: {"Điểm kỹ thuật"},
    10: {"Giá đánh giá"},
    12: {"Đơn giá trúng thầu"},
    14: {"Giá trúng thầu (VND)"},
    15: {"Lý do không đáp ứng hoặc lý do không trúng thầu"},
    16: {"Thời gian thực hiện gói thầu (ngày)"},
    17: {"Thời gian thực hiện hợp đồng (ngày)"},
    18: {"Nội dung khác (nếu có)"},
}


@dataclass(frozen=True)
class WorkbookTemplateDefinition:
    template_type: str
    version: str
    headers: tuple[str, ...]
    aliases: dict[int, set[str]]
    source_indices: tuple[int, ...]
    output_indices: tuple[int, ...]
    output_roles: tuple[str, ...]
    lot_index: int
    bidder_identifier_index: int
    tax_code_index: int
    bidder_name_index: int
    allowed_result_statuses: tuple[str, ...] = ("Trúng thầu", "Không trúng thầu")
    unsupported_entry_prefixes: tuple[str, ...] = (
        "xl/externalLinks/", "xl/embeddings/", "xl/activeX/",
    )
    unsupported_entries: tuple[str, ...] = (
        "xl/vbaProject.bin", "xl/connections.xml",
    )

    @property
    def fingerprint(self) -> str:
        canonical = "\n".join(
            " ".join(unicodedata.normalize("NFKC", header).split()).casefold()
            for header in self.headers
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


STANDARD_TEMPLATE = WorkbookTemplateDefinition(
    template_type="standard", version="muasamcong-standard-v1",
    headers=EXPECTED_HEADERS, aliases=_STANDARD_HEADER_ALIASES,
    source_indices=(0, 1, 2, 3, 4, 5),
    output_indices=(6, 7, 8, 9, 10, 11, 12, 13, 14),
    output_roles=("status", "corrected_price", "technical_score", "evaluated_price",
                  "award_price", "rejection_reason", "package_duration",
                  "contract_duration", "other_content"),
    lot_index=0, bidder_identifier_index=2, tax_code_index=3, bidder_name_index=4,
)

MEDICINE_TEMPLATE = WorkbookTemplateDefinition(
    template_type="medicine", version="muasamcong-medicine-v1",
    headers=MEDICINE_EXPECTED_HEADERS, aliases=_MEDICINE_HEADER_ALIASES,
    source_indices=(0, 1, 2, 3, 4, 5, 6, 13),
    output_indices=(7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18),
    output_roles=("status", "corrected_price", "technical_score", "evaluated_price",
                  "award_quantity", "award_unit_price", "award_price",
                  "rejection_reason", "package_duration", "contract_duration",
                  "other_content"),
    lot_index=1, bidder_identifier_index=3, tax_code_index=4, bidder_name_index=5,
)

TEMPLATE_DEFINITIONS = (STANDARD_TEMPLATE, MEDICINE_TEMPLATE)

