"""Port hiding VNEPS endpoints and payload shapes from the application."""

from __future__ import annotations

from typing import Protocol


class ProcurementSourceError(RuntimeError):
    """Sanitized provider failure with a stable error code."""


class ProcurementSource(Protocol):
    name: str
    schema_version: str

    def list_plan_revisions(self, family_no: str) -> list[dict]: ...

    def get_plan_revision(self, family_no: str, revision_id: str) -> dict: ...

    def list_notice_revisions(self, notice_no: str) -> list[dict]: ...

    def get_notice_revision(self, notice_no: str, revision_id: str) -> dict: ...

    def resolve_notice_package(self, notice_no: str, revision_id: str) -> dict | None: ...

    def get_opening_bundle(self, notice_no: str, revision_id: str) -> dict: ...

    def get_result_bundle(self, notice_no: str, revision_id: str) -> dict: ...

    def collect_complete_bundle(self, record: dict) -> dict: ...

    def health(self) -> dict: ...
