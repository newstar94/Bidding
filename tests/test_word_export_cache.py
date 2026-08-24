from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import time
from pathlib import Path

import pytest

from backend.documents.document_ipc import (
    DocumentIpcError,
    read_render_cache_overlay,
    write_job_manifest,
    write_render_cache_overlay,
)
from backend.documents.word_export_cache import (
    acquire_standardized_template_cache,
    publish_standardized_template_cache,
    release_standardized_template_cache,
)


def _cached(source, prepare, *, hint="evaluation", organization="org-a"):
    cached, lease = acquire_standardized_template_cache(
        source,
        organization_scope=organization,
        document_type_hint=hint,
        mode="apply_safe",
    )
    if cached is not None:
        return cached, True
    prepared = prepare(source)
    try:
        publish_standardized_template_cache(
            lease, prepared, preservation_attested=True,
        )
    finally:
        release_standardized_template_cache(lease)
    return prepared, False


def test_unattested_standardization_is_never_cached(tmp_path, monkeypatch):
    monkeypatch.setenv("BIDDING_WORD_EXPORT_CACHE_DIR", str(tmp_path / "cache"))
    cached, lease = acquire_standardized_template_cache(
        b"malformed",
        organization_scope="org-a",
        document_type_hint="evaluation",
        mode="apply_safe",
    )
    assert cached is None
    publish_standardized_template_cache(lease, b"malformed")

    cached, second_lease = acquire_standardized_template_cache(
        b"malformed",
        organization_scope="org-a",
        document_type_hint="evaluation",
        mode="apply_safe",
    )
    assert cached is None
    release_standardized_template_cache(second_lease)


def test_render_cache_overlay_reuses_base_context_without_copying_it(tmp_path):
    input_path = tmp_path / "input.json"
    overlay_path = tmp_path / "prepared-input.json"
    write_job_manifest(
        input_path,
        "render_docx",
        {
            "template_content": b"source-template",
            "context": {"legalText": "NOI_DUNG_PHAP_LY_KHONG_DUOC_COPY"},
            "context_manifest": {"document_type": "evaluation"},
        },
        image_root=tmp_path,
    )
    write_render_cache_overlay(
        overlay_path,
        input_path,
        "render_docx",
        [(0, b"cached-template")],
    )

    operation, payload = read_render_cache_overlay(overlay_path, tmp_path)

    assert operation == "render_docx"
    assert payload["context"]["legalText"] == "NOI_DUNG_PHAP_LY_KHONG_DUOC_COPY"
    assert Path(payload["template_path"]).read_bytes() == b"cached-template"
    assert payload["template_prestandardized"] is True
    assert b"NOI_DUNG_PHAP_LY_KHONG_DUOC_COPY" not in overlay_path.read_bytes()


def test_render_cache_overlay_rejects_a_changed_base_manifest(tmp_path):
    input_path = tmp_path / "input.json"
    overlay_path = tmp_path / "prepared-input.json"
    write_job_manifest(
        input_path,
        "render_docx",
        {
            "template_content": b"source-template",
            "context": {},
            "context_manifest": {"document_type": "evaluation"},
        },
        image_root=tmp_path,
    )
    write_render_cache_overlay(
        overlay_path,
        input_path,
        "render_docx",
        [(0, b"cached-template")],
    )
    input_path.write_bytes(input_path.read_bytes() + b" ")

    with pytest.raises(DocumentIpcError, match="Hash manifest"):
        read_render_cache_overlay(overlay_path, tmp_path)


def test_standardized_template_cache_hits_without_record_context(tmp_path, monkeypatch):
    monkeypatch.setenv("BIDDING_WORD_EXPORT_CACHE_DIR", str(tmp_path / "cache"))
    calls = []

    def prepare(source):
        calls.append(source)
        return source + b"-prepared"

    first, first_hit = _cached(b"template-a", prepare)
    second, second_hit = _cached(b"template-a", prepare)

    assert first == second == b"template-a-prepared"
    assert (first_hit, second_hit) == (False, True)
    assert calls == [b"template-a"]
    metadata = next((tmp_path / "cache").glob("*/*.json")).read_text("ascii")
    assert "record" not in metadata.casefold()
    assert "context" not in metadata.casefold()


def test_standardized_template_cache_invalidates_source_hint_and_tenant(
    tmp_path, monkeypatch,
):
    monkeypatch.setenv("BIDDING_WORD_EXPORT_CACHE_DIR", str(tmp_path / "cache"))
    calls = []

    def prepare(source):
        calls.append(source)
        return hashlib.sha256(source).digest()

    _cached(b"template-a", prepare)
    _cached(b"template-b", prepare)
    _cached(b"template-a", prepare, hint="contract")
    _cached(b"template-a", prepare, organization="org-b")

    assert len(calls) == 4


def test_corrupt_standardized_template_cache_is_recomputed(tmp_path, monkeypatch):
    monkeypatch.setenv("BIDDING_WORD_EXPORT_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0

    def prepare(source):
        nonlocal calls
        calls += 1
        return source + str(calls).encode("ascii")

    first, _ = _cached(b"template", prepare)
    next((tmp_path / "cache").glob("*/*.docx")).write_bytes(b"corrupt")
    second, cache_hit = _cached(b"template", prepare)

    assert first != second
    assert cache_hit is False
    assert calls == 2


def test_standardized_template_cache_single_flight(tmp_path, monkeypatch):
    monkeypatch.setenv("BIDDING_WORD_EXPORT_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0

    def prepare(source):
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return source + b"-prepared"

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _index: _cached(b"same", prepare), range(4)))

    assert calls == 1
    assert {content for content, _hit in results} == {b"same-prepared"}
    assert sum(1 for _content, hit in results if hit) == 3
