"""Deep interfaces for award-result Excel workflows."""

from .reports import build_reconciliation_workbook, reconciliation_filename
from .templates import TEMPLATE_DEFINITIONS
from .types import AwardRecord, AwardResultExcelError, RowMatch

__all__ = (
    "TEMPLATE_DEFINITIONS",
    "AwardRecord",
    "AwardResultExcelError",
    "RowMatch",
    "build_reconciliation_workbook",
    "reconciliation_filename",
)
