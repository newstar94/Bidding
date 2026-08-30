"""Template-aware team readiness checks for explicit Word publication."""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

from backend.documents.template_security import extract_docx_template_root_keys


TEAM_SPECS = {
    "to_chuyen_gia": {
        "label": "Tổ chuyên gia",
        "code": "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED",
    },
    "to_tham_dinh": {
        "label": "Tổ thẩm định",
        "code": "DOCUMENT_EXPORT_APPRAISAL_TEAM_REQUIRED",
    },
}
MULTIPLE_TEAMS_REQUIRED_CODE = "DOCUMENT_EXPORT_TEAMS_REQUIRED"


class WordPublicationTeamWarning(ValueError):
    """The selected template needs a team that is not publication-ready."""

    def __init__(self, missing_teams):
        self.missing_teams = tuple(missing_teams)
        labels = [TEAM_SPECS[key]["label"] for key in self.missing_teams]
        self.code = (
            TEAM_SPECS[self.missing_teams[0]]["code"]
            if len(self.missing_teams) == 1
            else MULTIPLE_TEAMS_REQUIRED_CODE
        )
        super().__init__(
            f"{', '.join(labels)} phải có thành viên và đúng một Tổ trưởng "
            "trước khi xuất biểu mẫu Word đang sử dụng trường này."
        )


def _mapping_values(mapping):
    if isinstance(mapping, Mapping):
        return (
            mapping.get("ten_bien"),
            mapping.get("source_table"),
        )
    try:
        return mapping[0], mapping[1]
    except (IndexError, KeyError, TypeError):
        return None, None


def _target_content(target) -> bytes:
    if not isinstance(target, Mapping):
        raise ValueError("Biểu mẫu Word được chọn không hợp lệ.")
    if "content" in target:
        return bytes(target["content"])
    path = target.get("path")
    if not path:
        raise ValueError("Biểu mẫu Word được chọn không hợp lệ.")
    return Path(path).read_bytes()


def referenced_team_roots(template_selection, mappings=()) -> set[str]:
    """Return team context roots actually referenced by selected templates."""

    if isinstance(template_selection, list):
        targets = template_selection
    elif isinstance(template_selection, Mapping):
        targets = [template_selection]
    else:
        targets = [{"path": template_selection}]
    referenced_roots = set()
    for target in targets:
        referenced_roots.update(
            extract_docx_template_root_keys(_target_content(target))
        )

    aliases_by_team = {team: {team} for team in TEAM_SPECS}
    for mapping in mappings or ():
        variable_name, source_table = _mapping_values(mapping)
        source_table = str(source_table or "").strip()
        variable_name = str(variable_name or "").strip()
        if source_table in aliases_by_team and variable_name:
            aliases_by_team[source_table].add(variable_name)
    return {
        team
        for team, aliases in aliases_by_team.items()
        if referenced_roots & aliases
    }


def _team_is_ready(members) -> bool:
    if not isinstance(members, list) or not members:
        return False
    leaders = sum(
        1
        for member in members
        if isinstance(member, Mapping)
        and str(member.get("chuc_vu") or member.get("chucVu") or "").strip()
        == "Tổ trưởng"
    )
    return leaders == 1


def validate_word_publication_teams(template_selection, context, mappings=()):
    """Warn only when a selected template references an unready package team."""

    required = referenced_team_roots(template_selection, mappings)
    missing = [
        team for team in TEAM_SPECS
        if team in required and not _team_is_ready((context or {}).get(team))
    ]
    if missing:
        raise WordPublicationTeamWarning(missing)
