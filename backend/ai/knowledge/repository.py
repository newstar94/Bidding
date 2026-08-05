"""Database adapter for the knowledge retrieval seam."""

from __future__ import annotations

from backend.ai.knowledge.retrieval import KnowledgeContext, retrieve_knowledge
from backend.ai.types import AiRequestContext
from backend.shared.helpers import database


def retrieve_for_context(
    context: AiRequestContext,
    query: str,
    *,
    mode: str,
    limit: int,
    min_score: float,
    max_context_chars: int,
    candidate_limit: int,
) -> KnowledgeContext:
    connection = database.get_connection()
    try:
        return retrieve_knowledge(
            connection.cursor(),
            context,
            query,
            mode=mode,
            limit=limit,
            min_score=min_score,
            max_context_chars=max_context_chars,
            candidate_limit=candidate_limit,
        )
    finally:
        connection.close()
