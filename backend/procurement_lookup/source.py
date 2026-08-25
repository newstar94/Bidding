"""Port implemented by browser, fixture, or future official API sources."""

from __future__ import annotations

from typing import Protocol


class ProcurementSource(Protocol):
    name: str
    parser_version: str

    def lookup(self, code: str, kind: str) -> dict:
        """Return a stable biddingflow-procurement-preview-v1 DTO."""
        ...

    def list_revision_metadata(self, code: str, kind: str) -> list[dict]:
        """List stable revision identities without fetching revision payloads."""
        ...
