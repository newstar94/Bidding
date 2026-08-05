"""Validated, workspace-scoped knowledge for the AI gateway."""

from backend.ai.knowledge.ingestion import (
    KnowledgeIngestionError,
    PreparedChunk,
    PreparedDocument,
    ingest_approved_document,
    prepare_document,
)
from backend.ai.knowledge.retrieval import KnowledgeContext, RetrievedChunk, retrieve_knowledge

__all__ = [
    "KnowledgeContext",
    "KnowledgeIngestionError",
    "PreparedChunk",
    "PreparedDocument",
    "RetrievedChunk",
    "ingest_approved_document",
    "prepare_document",
    "retrieve_knowledge",
]
