"""Closed value objects accepted by the usage-credit module."""

from __future__ import annotations

from dataclasses import dataclass


FEATURE_PROCUREMENT_SOURCE_FETCH = "procurement.source_fetch"


def _required_text(value, field):
    text = str(value or "").strip()
    if not text or len(text) > 200:
        raise ValueError(f"Invalid {field}.")
    return text


@dataclass(frozen=True)
class UsageOwner:
    kind: str
    identifier: str

    def __post_init__(self):
        if self.kind not in {"account", "organization"}:
            raise ValueError("Invalid usage owner kind.")
        object.__setattr__(self, "identifier", _required_text(self.identifier, "owner"))

    @property
    def account_user_id(self):
        return self.identifier if self.kind == "account" else None

    @property
    def organization_id(self):
        return self.identifier if self.kind == "organization" else None


@dataclass(frozen=True)
class SourceRevisionCandidate:
    provider: str
    entity_kind: str
    source_code: str
    source_revision: str

    def __post_init__(self):
        object.__setattr__(self, "provider", _required_text(self.provider, "provider").casefold())
        object.__setattr__(self, "entity_kind", _required_text(self.entity_kind, "entity kind").upper())
        object.__setattr__(self, "source_code", _required_text(self.source_code, "source code").upper())
        object.__setattr__(self, "source_revision", _required_text(self.source_revision, "source revision"))

    @property
    def identity(self):
        return (
            self.provider,
            self.entity_kind,
            self.source_code,
            self.source_revision,
        )
