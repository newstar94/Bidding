import json
from types import SimpleNamespace
import urllib.request

import pytest

from backend.ai.configuration import get_ai_config
from backend.ai.errors import AiError
import backend.ai.providers.legal_search as legal_search_module
from backend.ai.providers.legal_search import (
    GeminiLegalSearchAdapter,
    is_allowed_official_url,
)


def config(**changes):
    values = {
        "api_key": "secret",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-3.5-flash-lite",
        "request_timeout_seconds": 20,
        "provider_allowed_hosts": ("generativelanguage.googleapis.com",),
        "provider_proxy_url": "",
        "provider_allowed_proxy_hosts": (),
    }
    values.update(changes)
    return SimpleNamespace(**values)


class JsonResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


def test_official_url_allowlist_rejects_unsafe_and_lookalike_hosts():
    allowed = ("vanban.chinhphu.vn", "vbpl.vn")

    assert is_allowed_official_url("https://vanban.chinhphu.vn/van-ban", allowed)
    assert is_allowed_official_url("https://sub.vbpl.vn/van-ban", allowed)
    assert not is_allowed_official_url("http://vanban.chinhphu.vn/van-ban", allowed)
    assert not is_allowed_official_url("javascript:alert(1)", allowed)
    assert not is_allowed_official_url("https://vanban.chinhphu.vn.evil.example/van-ban", allowed)


def test_legal_search_normalizes_only_allowlisted_sources_and_does_not_send_workspace_data(monkeypatch):
    captured = {}
    payload = {
        "steps": [
            {
                "type": "google_search_call",
                "arguments": {"queries": ["site:vanban.chinhphu.vn luật đấu thầu 2023"]},
            },
            {
                "type": "google_search_result",
                "result": [
                    {
                        "title": "Luật Đấu thầu 2023",
                        "url": "https://vanban.chinhphu.vn/luat-dau-thau",
                        "snippet": "Có hiệu lực từ ngày 01/01/2024.",
                    },
                    {
                        "title": "Bài viết không chính thống",
                        "url": "https://example.com/luat-dau-thau",
                        "snippet": "Không được dùng.",
                    },
                ],
            },
            {
                "type": "model_output",
                "content": [
                    {
                        "type": "text",
                        "text": "Luật Đấu thầu 2023 có hiệu lực từ ngày 01/01/2024.",
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": "https://vanban.chinhphu.vn/luat-dau-thau",
                                "title": "Luật Đấu thầu 2023",
                                "start_index": 0,
                                "end_index": 54,
                            }
                        ],
                    }
                ],
            },
        ]
    }

    def fake_urlopen(request, *, timeout, proxy_url=""):
        captured["request"] = request
        captured["timeout"] = timeout
        captured["proxy_url"] = proxy_url
        return JsonResponse(payload)

    monkeypatch.setattr(legal_search_module, "open_outbound_request", fake_urlopen)
    result = GeminiLegalSearchAdapter(config()).search_official_law(
        "Hạn mức chỉ định thầu trong workspace HTD của tôi là bao nhiêu?",
        ("vanban.chinhphu.vn", "vbpl.vn"),
    )

    body = json.loads(captured["request"].data.decode("utf-8"))
    assert body["tools"] == [{"type": "google_search"}]
    assert "workspace HTD" not in body["input"]
    assert "workspace" not in body["input"].casefold()
    assert [source["url"] for source in result.sources] == [
        "https://vanban.chinhphu.vn/luat-dau-thau"
    ]
    assert result.sources[0]["effectiveFrom"] == "2024-01-01"
    assert "[W1]" in result.prompt_context
    assert "01/01/2024" in result.prompt_context


def test_legal_search_returns_no_source_when_provider_has_no_allowlisted_citation(monkeypatch):
    monkeypatch.setattr(
        legal_search_module,
        "open_outbound_request",
        lambda *_args, **_kwargs: JsonResponse(
            {
                "steps": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "text",
                                "text": "Không có nguồn chính thống.",
                                "annotations": [
                                    {
                                        "type": "url_citation",
                                        "url": "https://example.com/not-official",
                                        "title": "Example",
                                    }
                                ],
                            }
                        ],
                    }
                ]
            }
        ),
    )

    result = GeminiLegalSearchAdapter(config()).search_official_law(
        "Quy định đấu thầu hiện hành?",
        ("vanban.chinhphu.vn",),
    )

    assert result.sources == ()
    assert "không có nguồn pháp luật chính thống" in result.prompt_context.casefold()


def test_web_search_configuration_is_bounded(monkeypatch):
    monkeypatch.setenv("AI_WEB_SEARCH_ENABLED", "true")
    monkeypatch.setenv("AI_WEB_SEARCH_PROVIDER", "gemini_grounding")
    monkeypatch.setenv("AI_WEB_SEARCH_ALLOWED_DOMAINS", "vanban.chinhphu.vn, vbpl.vn")
    config = get_ai_config()

    assert config.web_search_enabled is True
    assert config.web_search_provider == "gemini_grounding"
    assert config.web_search_allowed_domains == ("vanban.chinhphu.vn", "vbpl.vn")


def test_enabled_web_search_rejects_provider_host_outside_allowlist(monkeypatch):
    monkeypatch.setenv("AI_WEB_SEARCH_ENABLED", "true")
    monkeypatch.setenv("AI_WEB_SEARCH_PROVIDER", "gemini_grounding")
    monkeypatch.setenv("AI_WEB_SEARCH_BASE_URL", "https://collector.example/v1beta")

    with pytest.raises(ValueError, match="allowlist"):
        get_ai_config()


def test_enabled_web_search_rejects_proxy_without_proxy_allowlist(monkeypatch):
    monkeypatch.setenv("AI_WEB_SEARCH_ENABLED", "true")
    monkeypatch.setenv("AI_WEB_SEARCH_PROXY_URL", "https://proxy.example")
    monkeypatch.delenv("AI_WEB_SEARCH_ALLOWED_PROXY_HOSTS", raising=False)

    with pytest.raises(ValueError, match="proxy.*allowlist"):
        get_ai_config()


def test_legal_search_rechecks_provider_host_before_network(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unsafe web-search request reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", must_not_open)
    adapter = GeminiLegalSearchAdapter(
        config(base_url="https://collector.example/v1beta")
    )

    with pytest.raises(AiError) as error:
        adapter.search_official_law("Quy định đấu thầu?", ("vbpl.vn",))
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_legal_search_rechecks_proxy_host_before_network(monkeypatch):
    def must_not_open(*_args, **_kwargs):
        raise AssertionError("unapproved web-search proxy reached the network")

    monkeypatch.setattr(
        legal_search_module,
        "open_outbound_request",
        must_not_open,
    )
    adapter = GeminiLegalSearchAdapter(
        config(
            provider_proxy_url="https://collector.example",
            provider_allowed_proxy_hosts=("approved-proxy.example",),
        )
    )

    with pytest.raises(AiError) as error:
        adapter.search_official_law("Quy định đấu thầu?", ("vbpl.vn",))
    assert error.value.code == "AI_PROVIDER_UNAVAILABLE"


def test_legal_search_uses_redirect_blocking_transport(monkeypatch):
    captured = {}

    def safe_open(request, *, timeout, proxy_url=""):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["proxy_url"] = proxy_url
        return JsonResponse({"steps": []})

    monkeypatch.setattr(
        legal_search_module,
        "open_outbound_request",
        safe_open,
        raising=False,
    )
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("legacy redirect-following transport was used")
        ),
    )

    GeminiLegalSearchAdapter(config()).search_official_law(
        "Quy định đấu thầu?",
        ("vbpl.vn",),
    )

    assert captured == {
        "url": "https://generativelanguage.googleapis.com/v1beta/interactions",
        "timeout": 20,
        "proxy_url": "",
    }
