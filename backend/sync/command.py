"""Typed input and actor context for the sync mutation module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.sync.idempotency import sync_request_hash


@dataclass(frozen=True, slots=True)
class SyncMutationEnvelope:
    payload: dict[str, Any]
    client_mutation_id: str
    request_hash: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SyncMutationEnvelope":
        client_mutation_id = str(payload.get("clientMutationId") or "").strip()[:128]
        return cls(
            payload=payload,
            client_mutation_id=client_mutation_id,
            request_hash=(sync_request_hash(payload) if client_mutation_id else ""),
        )


@dataclass(frozen=True, slots=True)
class SyncActorContext:
    request: Any
    role: Any
    user_id: str
    organization_id: str
    owner_type: str


@dataclass(frozen=True, slots=True)
class SyncTransactionContext:
    connection: Any
    cursor: Any
    actor: SyncActorContext
    owner_type: str
    current_time: str


@dataclass(frozen=True, slots=True)
class SyncPostCommitContext:
    transaction: SyncTransactionContext
    envelope: SyncMutationEnvelope
    response_data: dict[str, Any]
    image_cleanup_candidates: frozenset[str]
    newly_written_images: frozenset[str]
