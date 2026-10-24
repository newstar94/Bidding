import asyncio
from html.parser import HTMLParser
from pathlib import Path
import re

from starlette.requests import Request

from backend import app as app_module


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class _LegalMarkupParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.hrefs = []
        self.headings = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        if attributes.get("href"):
            self.hrefs.append(attributes["href"])
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.headings.append(tag)


def _compiled_shell(monkeypatch):
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    return app_module.compile_html(str(PROJECT_ROOT / "views" / "index.html"))


def _request(path):
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    })


def test_public_legal_route_is_registered_without_an_auth_dependency():
    legal_routes = [route for route in app_module.routes if getattr(route, "path", None) == "/legal"]

    assert len(legal_routes) == 1
    assert "GET" in legal_routes[0].methods
    assert legal_routes[0].endpoint is app_module.index


def test_legal_shell_contains_five_independent_sections_and_valid_anchors(monkeypatch):
    legal_html = app_module._page_shell(_compiled_shell(monkeypatch), "/legal")
    parser = _LegalMarkupParser()
    parser.feed(legal_html)

    assert {"terms", "privacy", "security", "cookies", "refund"}.issubset(parser.ids)
    assert "/legal#terms" not in parser.hrefs
    for anchor in ("#terms", "#privacy", "#security", "#cookies", "#refund"):
        assert parser.hrefs.count(anchor) >= 1
    assert legal_html.count('role="tab"') == 5
    assert legal_html.count('role="tabpanel"') == 5
    assert 'role="tablist"' in legal_html
    assert 'id="tab-terms"' in legal_html
    assert 'aria-controls="privacy"' in legal_html
    assert 'data-legal-panel="security" hidden' in legal_html
    assert 'data-legal-panel="cookies" hidden' in legal_html
    assert 'data-legal-panel="refund" hidden' in legal_html
    assert parser.headings.count("h1") == 1
    assert parser.headings.count("h2") == 5
    assert "INCLUDE ERROR" not in legal_html
    assert 'data-business-profile' in legal_html
    assert "landing-page" not in legal_html
    assert 'class="app-container"' not in legal_html
    assert 'id="auth-overlay"' not in legal_html


def test_anonymous_legal_response_has_route_metadata_and_no_workspace_preload(monkeypatch):
    compiled = _compiled_shell(monkeypatch)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "APP_PUBLIC_URL", "https://biddingflow.example")
    monkeypatch.setattr(app_module, "_build_index_response_payload", lambda: (compiled, '"template"'))
    monkeypatch.setattr(app_module, "build_session_bootstrap", lambda _request: {"valid": False})

    response = asyncio.run(app_module.index(_request("/legal")))
    body = response.body.decode("utf-8")

    assert response.status_code == 200
    assert "<title>Điều khoản và chính sách | BiddingFlow</title>" in body
    assert '<link rel="canonical" href="https://biddingflow.example/legal">' in body
    assert "workspaceBootstrap.js" not in body
    assert "initial-route.js" not in body
    assert 'id="terms"' in body
    assert 'id="privacy"' in body
    assert 'id="security"' in body


def test_workspace_response_keeps_initial_route_preload(monkeypatch):
    compiled = _compiled_shell(monkeypatch)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "_build_index_response_payload", lambda: (compiled, '"template"'))
    monkeypatch.setattr(app_module, "build_session_bootstrap", lambda _request: {"valid": True})

    response = asyncio.run(app_module.index(_request("/goi-thau")))
    body = response.body.decode("utf-8")

    script_match = re.search(
        r'<script src="(?P<src>/vendor/initial-route\.js\?v=[0-9a-f]{64})"></script>',
        body,
    )
    assert script_match is not None
    script_src = script_match.group("src")
    assert f'<link rel="preload" href="{script_src}" as="script">' in body


def test_registration_and_google_onboarding_show_all_legal_links():
    auth_markup = (PROJECT_ROOT / "views" / "components" / "auth_overlay.html").read_text(encoding="utf-8")

    for href in ("/legal#terms", "/legal#security", "/legal#cookies", "/legal#refund"):
        assert auth_markup.count(f'href="{href}"') == 2
    # The registration form also links privacy from its purpose notice.
    assert auth_markup.count('href="/legal#privacy"') == 3
    assert 'id="register-accept-legal" required' in auth_markup
    assert '<label for="register-accept-legal">Tôi đã đọc, hiểu và đồng ý' in auth_markup
    assert 'id="register-purpose-note"' in auth_markup
    assert "Với việc đăng nhập bằng Google" in auth_markup


def test_legal_policy_version_matches_recorded_consent_version():
    from backend.auth.legal_consent import LEGAL_DOCUMENTS, LEGAL_POLICY_VERSION

    shell = (PROJECT_ROOT / "views" / "components" / "legal_page.html").read_text(encoding="utf-8")
    notice = (PROJECT_ROOT / "frontend" / "shared" / "storageDisclosure.js").read_text(encoding="utf-8")
    assert f'<time datetime="{LEGAL_POLICY_VERSION}">' in shell
    assert f"<span data-legal-policy-version>{LEGAL_POLICY_VERSION}</span>" in shell
    assert f'COOKIE_NOTICE_VERSION = "{LEGAL_POLICY_VERSION}"' in notice
    for document in LEGAL_DOCUMENTS:
        assert f'data-legal-tab="{document}"' in shell


def test_public_footers_include_the_business_profile_block():
    for component in ("landing_page.html", "legal_page.html"):
        markup = (PROJECT_ROOT / "views" / "components" / component).read_text(encoding="utf-8")
        assert "<!-- INCLUDE: views/components/business_profile_footer.html -->" in markup
    block = (PROJECT_ROOT / "views" / "components" / "business_profile_footer.html").read_text(encoding="utf-8")
    assert "data-business-profile" in block
    # No invented identity: every unconfigured field shows a neutral placeholder.
    assert re.findall(r"\b\d{10}\b", block) == []
    assert block.count("Đang cập nhật") == 5


def test_public_footer_links_to_legal_page():
    landing_markup = (PROJECT_ROOT / "views" / "components" / "landing_page.html").read_text(encoding="utf-8")

    assert '<a href="/legal">Điều khoản và chính sách</a>' in landing_markup


def test_legal_bootstrap_bypasses_auth_and_workspace_shells():
    app_source = (PROJECT_ROOT / "frontend" / "app" / "app.js").read_text(encoding="utf-8")
    legal_source = (PROJECT_ROOT / "frontend" / "legal" / "LegalPage.js").read_text(encoding="utf-8")

    legal_branch = app_source.index("if (isLegalPath())")
    auth_import = app_source.index('import("../auth/AuthShell.js")')
    workspace_import = app_source.index('import("./workspaceBootstrap.js")')
    assert legal_branch < auth_import
    assert legal_branch < workspace_import
    assert 'pathname === "/legal"' in legal_source
    assert 'event.key === "ArrowRight"' in legal_source
    assert '"pushState"' in legal_source
    assert 'window.addEventListener("popstate"' in legal_source
