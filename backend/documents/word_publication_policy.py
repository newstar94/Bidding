"""Authoritative Word-publication document identities and applicability rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


ONE_STAGE_ONE_ENVELOPE = "Một giai đoạn một túi hồ sơ"
ONE_STAGE_TWO_ENVELOPE = "Một giai đoạn hai túi hồ sơ"
DIRECT_APPOINTMENT_SHORTENED = "Chỉ định thầu rút gọn"
SPECIAL_SELECTION = "Lựa chọn nhà thầu trong trường hợp đặc biệt"

ALL_PACKAGES = "all-packages"
STANDARD_BASE = "standard-base"
ONE_ENVELOPE = "one-envelope"
TWO_ENVELOPE = "two-envelope"
NORMAL_PROCUREMENT = "normal-procurement"
DIRECT_OR_SPECIAL = "direct-or-special"


@dataclass(frozen=True)
class WordPublicationDocument:
    id: str
    label: str
    scope: str
    context_type: str
    applicability: str
    legacy_active_fallback: bool = False


WORD_PUBLICATION_DOCUMENTS = (
    WordPublicationDocument(
        "procurement_plan",
        "Kế hoạch lựa chọn nhà thầu",
        "plan",
        "plan",
        ALL_PACKAGES,
    ),
    WordPublicationDocument(
        "package_full_profile",
        "Hồ sơ tổng hợp gói thầu",
        "package",
        "contract",
        ALL_PACKAGES,
    ),
    WordPublicationDocument(
        "consultant_evaluation_step_1",
        "Tư vấn lập, đánh giá Bước 1",
        "package",
        "evaluation",
        STANDARD_BASE,
    ),
    WordPublicationDocument(
        "consultant_evaluation_step_2",
        "Tư vấn lập, đánh giá Bước 2",
        "package",
        "evaluation",
        STANDARD_BASE,
    ),
    WordPublicationDocument(
        "consultant_appraisal_step_1",
        "Tư vấn thẩm định Bước 1",
        "package",
        "evaluation",
        STANDARD_BASE,
    ),
    WordPublicationDocument(
        "consultant_appraisal_step_2",
        "Tư vấn thẩm định Bước 2",
        "package",
        "evaluation",
        STANDARD_BASE,
    ),
    WordPublicationDocument(
        "bid_evaluation_report",
        "Báo cáo đánh giá E-HSDT",
        "package",
        "evaluation",
        ONE_ENVELOPE,
    ),
    WordPublicationDocument(
        "technical_bid_evaluation_report_01",
        "Báo cáo đánh giá E-HSĐXKT",
        "package",
        "evaluation",
        TWO_ENVELOPE,
    ),
    WordPublicationDocument(
        "technical_bid_evaluation_report_02",
        "Quyết định phê duyệt nhà thầu đạt kỹ thuật",
        "package",
        "evaluation",
        TWO_ENVELOPE,
    ),
    WordPublicationDocument(
        "technical_bid_evaluation_report_03",
        "Báo cáo đánh giá E-HSĐXTC",
        "package",
        "evaluation",
        TWO_ENVELOPE,
    ),
    WordPublicationDocument(
        "award_result_appraisal_report",
        "Báo cáo thẩm định, KQLCNT",
        "package",
        "evaluation",
        NORMAL_PROCUREMENT,
    ),
    WordPublicationDocument(
        "contractor_selection_result",
        "Kết quả lựa chọn nhà thầu",
        "package",
        "result",
        DIRECT_OR_SPECIAL,
    ),
)

WORD_PUBLICATION_DOCUMENT_BY_ID = {
    definition.id: definition for definition in WORD_PUBLICATION_DOCUMENTS
}
WORD_PUBLICATION_DOCUMENT_IDS = frozenset(WORD_PUBLICATION_DOCUMENT_BY_ID)


def _value(record: Mapping[str, object] | None, *names: str) -> str:
    source = record or {}
    for name in names:
        value = source.get(name)
        if value is not None:
            return str(value).strip()
    return ""


def is_direct_or_special(package_record: Mapping[str, object] | None) -> bool:
    procurement_form = _value(
        package_record,
        "hinh_thuc_lua_chon",
        "hinhThucLuaChon",
    )
    return procurement_form in {
        DIRECT_APPOINTMENT_SHORTENED,
        SPECIAL_SELECTION,
    }


def is_word_publication_document_applicable(
    document_type: str,
    package_record: Mapping[str, object] | None = None,
) -> bool:
    definition = WORD_PUBLICATION_DOCUMENT_BY_ID.get(str(document_type or "").strip())
    if definition is None:
        return False
    if definition.scope == "plan":
        return definition.applicability == ALL_PACKAGES
    if not package_record:
        return False
    if definition.applicability == ALL_PACKAGES:
        return True

    selection_method = _value(
        package_record,
        "phuong_thuc_lua_chon",
        "phuongThucLuaChon",
    )
    direct_or_special = is_direct_or_special(package_record)
    if definition.applicability == STANDARD_BASE:
        return not direct_or_special
    if definition.applicability == ONE_ENVELOPE:
        return (
            not direct_or_special
            and selection_method == ONE_STAGE_ONE_ENVELOPE
        )
    if definition.applicability == TWO_ENVELOPE:
        return (
            not direct_or_special
            and selection_method == ONE_STAGE_TWO_ENVELOPE
        )
    if definition.applicability == NORMAL_PROCUREMENT:
        return not direct_or_special
    if definition.applicability == DIRECT_OR_SPECIAL:
        return direct_or_special
    return False


def public_word_publication_definitions() -> list[dict[str, object]]:
    return [
        {
            "id": definition.id,
            "label": definition.label,
            "scope": definition.scope,
            "contextType": definition.context_type,
            "legacyActiveFallback": definition.legacy_active_fallback,
        }
        for definition in WORD_PUBLICATION_DOCUMENTS
    ]
