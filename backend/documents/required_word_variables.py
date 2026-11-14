"""ADR 0106: result variables each workspace must define before exporting.

Some templates print a deadline whose rule differs between workspaces (for
example "ngày thư + 10 ngày" or "+ 5 ngày làm việc"). The rule is a workspace
"Biến kết quả" (computed Word variable), never a system default. A template that
uses such a variable cannot be exported until the workspace has defined it, so
the deadline is never printed empty without the user noticing.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Mapping

from backend.documents.word_publication_team_policy import selected_template_contents

REQUIRED_VARIABLES_CODE = "DOCUMENT_EXPORT_REQUIRED_VARIABLES_MISSING"

# variable name -> what the template prints there
REQUIRED_COMPUTED_VARIABLES = {
    "ngay_han_hoan_thien_hd": "Hạn cuối hoàn thiện, ký kết hợp đồng (Thư chấp thuận E-HSDT và trao hợp đồng)",
    "ngay_han_xac_nhan_nl": "Hạn phản hồi xác nhận năng lực (Giấy mời xác nhận năng lực, Báo cáo tư cách hợp lệ)",
}


class WordRequiredVariablesMissing(ValueError):
    """A selected template uses a required result variable the workspace lacks."""

    code = REQUIRED_VARIABLES_CODE

    def __init__(self, missing):
        self.missing = tuple(missing)
        names = ", ".join(
            f"{REQUIRED_COMPUTED_VARIABLES[name]} {{{name}}}" for name in self.missing
        )
        super().__init__(
            f"Biểu mẫu Word đang dùng biến kết quả chưa được cấu hình: {names}."
        )

    def payload(self, can_configure: bool | None) -> dict:
        """``can_configure`` is None when the caller's role is unknown."""

        if can_configure:
            action = (
                "Vào Biểu mẫu Word → Biến kết quả, tạo biến với công thức trả về một ngày "
                "(ví dụ dùng addDays hoặc addWorkingDays), rồi xuất lại."
            )
        elif can_configure is False:
            action = (
                "Hãy nhờ quản lý của không gian làm việc cấu hình biến này trong "
                "Biểu mẫu Word → Biến kết quả, rồi xuất lại."
            )
        else:
            action = (
                "Quản lý của không gian làm việc cấu hình biến này trong "
                "Biểu mẫu Word → Biến kết quả, rồi xuất lại."
            )
        return {
            "code": self.code,
            "error": f"{self} {action}",
            "missingVariables": [
                {"name": name, "label": REQUIRED_COMPUTED_VARIABLES[name]}
                for name in self.missing
            ],
            "canConfigure": can_configure,
        }


def _variable_name(mapping) -> str:
    if isinstance(mapping, Mapping):
        value = mapping.get("ten_bien")
    else:
        try:
            value = mapping[0]
        except (IndexError, KeyError, TypeError):
            value = None
    return str(value or "").strip().lower()


_TAG = re.compile(r"<[^>]+>")


def _template_text(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return "\n".join(
            _TAG.sub("", archive.read(name).decode("utf-8", errors="replace"))
            for name in archive.namelist()
            if name.startswith("word/") and name.lower().endswith(".xml")
        )


def referenced_required_variables(template_selection) -> set[str]:
    """Required variables used as ``{name}``, ``{S_name}`` or ``{{ name }}``."""

    text = "\n".join(
        _template_text(content)
        for content in selected_template_contents(template_selection)
    )
    return {
        name for name in REQUIRED_COMPUTED_VARIABLES
        if re.search(r"(?<![A-Za-z0-9_])(?:[Ss]_)?%s(?![A-Za-z0-9_])" % re.escape(name), text)
    }


def validate_required_word_variables(template_selection, mappings=()) -> None:
    """Raise when a selected template uses a required variable nobody defined."""

    if template_selection is None:
        return
    referenced = referenced_required_variables(template_selection)
    defined = {_variable_name(mapping) for mapping in mappings or ()}
    missing = [
        name for name in REQUIRED_COMPUTED_VARIABLES
        if name in referenced and name not in defined
    ]
    if missing:
        raise WordRequiredVariablesMissing(missing)
