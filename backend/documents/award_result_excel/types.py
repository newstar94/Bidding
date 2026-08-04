"""Domain types exposed by the award-result Excel facade."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


class AwardResultExcelError(ValueError):
    """A safe error with an API-level status and stable code."""

    def __init__(self, code: str, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class AwardRecord:
    opening_id: str
    lot_code: str
    bidder_identifier: str
    tax_code: str
    bidder_name: str
    status: str | None
    goods_item_id: str | None = None
    goods_sequence: str | None = None
    goods_code: str | None = None
    goods_name: str | None = None
    goods_unit: str | None = None
    corrected_price: Any = None
    technical_score: Any = None
    evaluated_price: Any = None
    award_quantity: Any = None
    award_unit_price: Any = None
    award_price: Any = None
    rejection_reason: str | None = None
    package_duration: str | None = None
    contract_duration: str | None = None
    other_content: str | None = None
    lot_cancelled: bool = False

    def output_values(self, output_roles: Iterable[str]) -> list[Any]:
        return [getattr(self, role) for role in output_roles]


@dataclass
class RowMatch:
    excel_row: int
    lot_code: str
    bidder_identifier: str
    tax_code: str
    bidder_name: str
    goods_sequence: Any
    goods_name: str
    source_fingerprint: str
    status: str
    match_method: str | None = None
    writable: bool = False
    changes: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    record: AwardRecord | None = field(default=None, repr=False)

    def public_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value.pop("record", None)
        value.pop("source_fingerprint", None)
        return {
            "excelRow": value.pop("excel_row"),
            "lotCode": value.pop("lot_code"),
            "bidderIdentifier": value.pop("bidder_identifier"),
            "taxCode": value.pop("tax_code"),
            "bidderName": value.pop("bidder_name"),
            "goodsSequence": value.pop("goods_sequence"),
            "goodsName": value.pop("goods_name"),
            "matchMethod": value.pop("match_method"),
            "approved": bool(self.record and self.record.status is not None),
            "writable": self.writable,
            **value,
        }
