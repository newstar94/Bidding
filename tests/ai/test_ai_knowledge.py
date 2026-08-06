from datetime import date
import asyncio
from types import SimpleNamespace

import pytest

from backend.ai.knowledge import (
    KnowledgeContext,
    KnowledgeIngestionError,
    ingest_approved_document,
    prepare_document,
    retrieve_knowledge,
)
from backend.ai.types import AiRequestContext
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES, _upgrade_to_v40_add_ai_knowledge


class CandidateCursor:
    def __init__(self, rows):
        self.rows = rows
        self.statement = ""
        self.parameters = ()

    def execute(self, statement, parameters=()):
        self.statement = " ".join(str(statement).split())
        self.parameters = tuple(parameters)
        return self

    def fetchall(self):
        return self.rows


def context(organization_id="org-1"):
    return AiRequestContext(
        user_id="user-1",
        organization_id=organization_id,
        organization_name="Đơn vị thử nghiệm",
        platform_role="user",
        membership_role="manager",
        scope_type="organization",
        permissions={"ai.chat": "view", "goithau": "view"},
    )


def row(
    document_id,
    content,
    *,
    organization_id=None,
    document_type="BIDDINGFLOW_HELP",
    effective_from="2026-01-01",
    effective_to=None,
    status="active",
):
    return {
        "chunk_id": f"{document_id}-chunk-1",
        "document_id": document_id,
        "organization_id": organization_id,
        "document_type": document_type,
        "title": f"Tài liệu {document_id}",
        "document_number": "BF-HELP-01",
        "version": "1.0",
        "status": status,
        "effective_from": effective_from,
        "effective_to": effective_to,
        "section": "Gói thầu",
        "page_number": None,
        "chunk_index": 0,
        "source_url": "/goi-thau",
        "content": content,
    }


def test_app_help_retrieval_returns_only_validated_global_and_workspace_sources():
    cursor = CandidateCursor(
        [
            row("global-help", "Mở mục Gói thầu để xem danh sách gói thầu."),
            row(
                "workspace-help",
                "Chọn Thêm mới để tạo gói thầu trong workspace hiện tại.",
                organization_id="org-1",
            ),
            row(
                "other-workspace",
                "Tạo gói thầu bí mật của đơn vị khác.",
                organization_id="org-2",
            ),
            row(
                "unapproved",
                "Tạo gói thầu từ tài liệu chưa duyệt.",
                organization_id="org-1",
                status="draft",
            ),
        ]
    )

    result = retrieve_knowledge(
        cursor,
        context(),
        "Làm thế nào để tạo gói thầu?",
        mode="app_help",
        today=date(2026, 8, 5),
        limit=5,
    )

    assert [chunk.document_id for chunk in result.chunks] == [
        "workspace-help",
        "global-help",
    ]
    assert [source["documentId"] for source in result.sources] == [
        "workspace-help",
        "global-help",
    ]
    assert all(source["url"] == "/goi-thau" for source in result.sources)
    assert "untrustedKnowledge" in result.prompt_context
    assert "[S1]" in result.prompt_context
    assert "other-workspace" not in result.prompt_context
    assert "unapproved" not in result.prompt_context
    assert "organization_id IS NULL OR organization_id = ?" in cursor.statement
    assert "org-1" in cursor.parameters


def test_procurement_retrieval_marks_expired_source_and_never_invents_citation():
    cursor = CandidateCursor(
        [
            row(
                "expired-law",
                "Quy trình đấu thầu áp dụng theo điều khoản thử nghiệm.",
                document_type="LEGAL_DOCUMENT",
                effective_from="2024-01-01",
                effective_to="2025-12-31",
            )
        ]
    )

    result = retrieve_knowledge(
        cursor,
        context(),
        "Quy trình đấu thầu áp dụng thế nào?",
        mode="procurement_advice",
        today=date(2026, 8, 5),
    )

    assert len(result.sources) == 1
    assert result.sources[0]["expired"] is True
    assert "đã hết hiệu lực" in result.prompt_context
    assert "expired-law" in result.prompt_context


def test_data_mode_does_not_load_document_knowledge():
    cursor = CandidateCursor([row("help", "Gói thầu")])

    result = retrieve_knowledge(cursor, context(), "Có bao nhiêu gói?", mode="data")

    assert result.chunks == ()
    assert result.sources == ()
    assert result.prompt_context == ""
    assert cursor.statement == ""


def approved_metadata(**changes):
    value = {
        "title": "Hướng dẫn sử dụng BiddingFlow",
        "document_number": "BF-HELP-01",
        "issuing_authority": "BiddingFlow",
        "document_type": "BIDDINGFLOW_HELP",
        "issued_date": "2026-08-05",
        "effective_from": "2026-08-05",
        "effective_to": None,
        "version": "1.0",
        "status": "approved",
        "organization_id": None,
        "confidentiality": "internal",
        "source_url": "/goi-thau",
    }
    value.update(changes)
    return value


def test_prepare_document_extracts_versioned_markdown_chunks(tmp_path):
    source = tmp_path / "biddingflow-help.md"
    source.write_text(
        "# Hướng dẫn BiddingFlow\n\n"
        "## Tạo gói thầu\n\n"
        "Mở mục Gói thầu, chọn Thêm mới và nhập thông tin bắt buộc.\n\n"
        "## Xem quy trình\n\n"
        "Mở chi tiết gói thầu để xem các bước nghiệp vụ.",
        encoding="utf-8",
    )

    prepared = prepare_document(source, approved_metadata())

    assert prepared.metadata["document_type"] == "BIDDINGFLOW_HELP"
    assert prepared.content_hash == "d438d2e910a8a9ebb7ea439c5b2d417a9e52fb1d3e8a43795b9353a5ab7b2725"
    assert [chunk.section for chunk in prepared.chunks] == [
        "Tạo gói thầu",
        "Xem quy trình",
    ]
    assert "Thêm mới" in prepared.chunks[0].content


class IngestionCursor:
    def __init__(self, duplicate=None):
        self.duplicate = duplicate
        self.statements = []
        self.many = []

    def execute(self, statement, parameters=()):
        self.statements.append((" ".join(str(statement).split()), tuple(parameters)))
        return self

    def fetchone(self):
        return self.duplicate

    def executemany(self, statement, parameters):
        self.many.append((" ".join(str(statement).split()), list(parameters)))
        return self


def test_ingest_approved_document_activates_one_version_and_persists_chunks(tmp_path):
    source = tmp_path / "help.txt"
    source.write_text("Tạo gói thầu từ màn hình Gói thầu.", encoding="utf-8")
    cursor = IngestionCursor()

    result = ingest_approved_document(
        cursor,
        source,
        approved_metadata(),
        approved_by="admin-1",
        document_id="doc-help-v1",
    )

    sql = "\n".join(statement for statement, _ in cursor.statements)
    assert "UPDATE ai_knowledge_documents SET status = 'retired'" in sql
    assert "INSERT INTO ai_knowledge_documents" in sql
    assert cursor.many[0][0].startswith("INSERT INTO ai_knowledge_chunks")
    assert cursor.many[0][1][0][1] == "doc-help-v1"
    assert result == {
        "documentId": "doc-help-v1",
        "contentHash": prepare_document(source, approved_metadata()).content_hash,
        "chunkCount": 1,
        "status": "active",
    }


def test_ingestion_rejects_duplicate_content_hash(tmp_path):
    source = tmp_path / "help.txt"
    source.write_text("Nội dung đã tồn tại.", encoding="utf-8")
    cursor = IngestionCursor(duplicate={"id": "existing-document"})

    with pytest.raises(KnowledgeIngestionError, match="content_hash"):
        ingest_approved_document(
            cursor,
            source,
            approved_metadata(),
            approved_by="admin-1",
        )


def test_schema_v40_adds_versioned_knowledge_registry_and_indexes():
    statements = []

    class Cursor:
        def execute(self, statement, parameters=()):
            statements.append(" ".join(str(statement).split()))
            return self

    _upgrade_to_v40_add_ai_knowledge(Cursor(), None)
    sql = "\n".join(statements)

    assert DB_SCHEMA_VERSION >= 40
    assert any(upgrade.version == 40 for upgrade in UPGRADES)
    assert "CREATE TABLE IF NOT EXISTS ai_knowledge_documents" in sql
    assert "CREATE TABLE IF NOT EXISTS ai_knowledge_chunks" in sql
    assert "idx_ai_knowledge_active_org" in sql
    assert "idx_ai_knowledge_chunks_document" in sql
    assert "ai_knowledge_documents" in SCHEMA_DINH_NGHIA
    assert "ai_knowledge_chunks" in SCHEMA_DINH_NGHIA


def test_knowledge_configuration_is_bounded(monkeypatch):
    from backend.ai.configuration import get_ai_config

    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "true")
    monkeypatch.setenv("AI_KNOWLEDGE_TOP_K", "99")
    monkeypatch.setenv("AI_KNOWLEDGE_MIN_SCORE", "0.35")
    monkeypatch.setenv("AI_KNOWLEDGE_MAX_CONTEXT_CHARS", "999999")
    monkeypatch.setenv("AI_KNOWLEDGE_CANDIDATE_LIMIT", "0")

    config = get_ai_config()

    assert config.knowledge_enabled is True
    assert config.knowledge_top_k == 10
    assert config.knowledge_min_score == 0.35
    assert config.knowledge_max_context_chars == 48000
    assert config.knowledge_candidate_limit == 50


def test_stream_message_adds_validated_knowledge_context_and_sources(monkeypatch):
    from backend.ai import service

    captured = {}
    source = {
        "documentId": "doc-help",
        "title": "Hướng dẫn BiddingFlow",
        "url": "/goi-thau",
        "sourceUrl": "/goi-thau",
    }

    async def database_read(function, *args, **kwargs):
        del kwargs
        if function is service.get_conversation:
            return {"mode": "app_help"}
        if function is service.list_messages:
            return [{"role": "user", "content": "Tạo gói thầu thế nào?"}]
        if function is service.retrieve_knowledge:
            assert args[0].organization_id == "org-1"
            assert args[1] == "Tạo gói thầu thế nào?"
            return KnowledgeContext(
                sources=(source,),
                prompt_context="KNOWLEDGE_CONTEXT [S1] hướng dẫn đã duyệt",
            )
        raise AssertionError(f"Unexpected read: {function}")

    async def database_write(function, *args, **kwargs):
        del args, kwargs
        if function is service.add_message:
            return "message-1"
        return None

    async def provider_events(_provider, input_items, instructions, tools):
        captured.update(
            input_items=input_items,
            instructions=instructions,
            tools=tools,
        )
        yield {"type": "response.output_text.delta", "delta": "Mở mục Gói thầu [S1]."}
        yield {
            "type": "response.completed",
            "response": {"output": [], "usage": {"input_tokens": 10, "output_tokens": 6}},
        }

    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "fake")
    monkeypatch.setenv("AI_MODEL", "fake-local")
    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "true")
    monkeypatch.setattr(service, "run_database_read", database_read)
    monkeypatch.setattr(service, "run_database_write", database_write)
    monkeypatch.setattr(service, "_provider_event_stream", provider_events)
    monkeypatch.setattr(service, "audit_chat", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "increment", lambda *args, **kwargs: None)

    async def collect():
        return [
            event
            async for event in service.stream_message(
                SimpleNamespace(),
                context(),
                "conversation-1",
                "Tạo gói thầu thế nào?",
                current_route="/goi-thau",
                quota_consumed=True,
            )
        ]

    events = asyncio.run(collect())

    assert "KNOWLEDGE_CONTEXT [S1]" in captured["instructions"]
    assert "Route ứng dụng hiện tại: /goi-thau" in captured["instructions"]
    assert [tool["name"] for tool in captured["tools"]] == ["search_app_structure"]
    assert any(event == {"type": "source.added", "source": source} for event in events)
    completed = next(event for event in events if event["type"] == "message.completed")
    assert completed["sources"] == [source]


def test_procurement_advice_prioritizes_rag_then_adds_allowlisted_web_sources(monkeypatch):
    from backend.ai import service
    from backend.ai.providers.legal_search import LegalSearchResult

    captured = {}
    rag_source = {"documentId": "law-rag", "title": "Luật đã duyệt", "url": "/docs/law"}
    web_source = {
        "type": "web",
        "title": "Luật Đấu thầu 2023",
        "url": "https://vanban.chinhphu.vn/luat-dau-thau",
        "effectiveFrom": "2024-01-01",
    }

    async def database_read(function, *args, **kwargs):
        del kwargs
        if function is service.get_conversation:
            return {"mode": "procurement_advice"}
        if function is service.list_messages:
            return [{"role": "user", "content": "Hạn mức chỉ định thầu là bao nhiêu?"}]
        if function is service.retrieve_knowledge:
            return KnowledgeContext(
                sources=(rag_source,),
                prompt_context="KNOWLEDGE_CONTEXT [S1] Luật đã duyệt",
            )
        raise AssertionError(f"Unexpected read: {function}")

    async def database_write(function, *args, **kwargs):
        del args, kwargs
        if function is service.add_message:
            return "message-1"
        return None

    def web_search(_content, _config):
        return LegalSearchResult(
            sources=(web_source,),
            prompt_context="WEB_SEARCH_CONTEXT [W1] Luật Đấu thầu 2023",
        )

    async def provider_events(_provider, input_items, instructions, tools):
        captured.update(input_items=input_items, instructions=instructions, tools=tools)
        yield {"type": "response.output_text.delta", "delta": "Theo [S1] và [W1]."}
        yield {
            "type": "response.completed",
            "response": {"output": [], "usage": {"input_tokens": 10, "output_tokens": 6}},
        }

    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "fake")
    monkeypatch.setenv("AI_MODEL", "fake-local")
    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "true")
    monkeypatch.setenv("AI_WEB_SEARCH_ENABLED", "true")
    monkeypatch.setattr(service, "run_database_read", database_read)
    monkeypatch.setattr(service, "run_database_write", database_write)
    monkeypatch.setattr(service, "_search_legal_sources", web_search)
    monkeypatch.setattr(service, "_provider_event_stream", provider_events)
    monkeypatch.setattr(service, "audit_chat", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "increment", lambda *args, **kwargs: None)

    async def collect():
        return [
            event
            async for event in service.stream_message(
                SimpleNamespace(),
                context(),
                "conversation-1",
                "Hạn mức chỉ định thầu là bao nhiêu?",
                quota_consumed=True,
            )
        ]

    events = asyncio.run(collect())

    assert "KNOWLEDGE_CONTEXT [S1]" in captured["instructions"]
    assert "WEB_SEARCH_CONTEXT [W1]" in captured["instructions"]
    assert captured["tools"] == []
    assert any(event == {"type": "source.added", "source": web_source} for event in events)
    completed = next(event for event in events if event["type"] == "message.completed")
    assert completed["sources"] == [rag_source, web_source]
