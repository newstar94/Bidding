import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import backend.app as app_module


def test_landing_metadata_is_public_crawlable_and_truthful(monkeypatch):
    monkeypatch.setattr(app_module, "APP_PUBLIC_URL", "https://biddingflow.example")
    title, description, canonical = app_module._page_metadata("/")
    robots, social, structured = app_module._page_discovery_metadata(
        "/", title, description
    )

    assert title == "BiddingFlow – Phần mềm quản lý đấu thầu và gói thầu"
    assert 120 <= len(description) <= 170
    assert '<link rel="canonical" href="https://biddingflow.example">' == canonical
    assert "index, follow" in robots
    assert 'property="og:image"' in social
    assert "/assets/biddingflow-social-preview.png" in social

    payload = structured.removeprefix(
        '<script type="application/ld+json">'
    ).removesuffix("</script>")
    parsed = json.loads(payload)
    assert parsed["@context"] == "https://schema.org"
    assert [item["@type"] for item in parsed["@graph"]] == ["WebApplication"]
    assert "aggregateRating" not in payload
    assert "review" not in payload.casefold()


def test_workspace_routes_are_not_advertised_to_crawlers():
    title, description, _ = app_module._page_metadata("/tong-quan")
    robots, social, structured = app_module._page_discovery_metadata(
        "/tong-quan", title, description
    )
    assert robots == '<meta name="robots" content="noindex, nofollow">'
    assert social == ""
    assert structured == ""


def test_robots_and_sitemap_advertise_only_public_pages(monkeypatch):
    monkeypatch.setattr(app_module, "APP_PUBLIC_URL", "https://biddingflow.example")
    request = SimpleNamespace(base_url="http://unused.local/")
    robots = asyncio.run(app_module.robots_txt(request))
    sitemap = asyncio.run(app_module.sitemap_xml(request))

    assert robots.status_code == 200
    assert b"Allow: /" in robots.body
    assert b"https://biddingflow.example/sitemap.xml" in robots.body
    assert sitemap.status_code == 200
    assert b"https://biddingflow.example/legal" in sitemap.body
    assert b"/tong-quan" not in sitemap.body


def test_landing_marketing_copy_is_present_in_initial_html():
    markup = (
        Path(app_module.project_root)
        / "views"
        / "components"
        / "landing_page.html"
    ).read_text(encoding="utf-8")
    assert markup.count("<h1") == 1
    assert "Quản lý toàn bộ quy trình đấu thầu trên một nền tảng duy nhất" in markup
    assert '<main id="landing-main">' in markup
    assert 'id="giai-phap"' in markup
    assert 'id="quy-trinh"' in markup
    assert 'id="vai-tro"' in markup


def test_landing_shell_is_visible_without_waiting_for_application_javascript():
    source = (
        '<body class="bf-init-loading" hidden>'
        '<!-- BF_SHELL_LANDING_START --><main>Landing</main><!-- BF_SHELL_LANDING_END -->'
        '<!-- BF_SHELL_LEGAL_START --><main>Legal</main><!-- BF_SHELL_LEGAL_END -->'
        '<!-- BF_SHELL_WORKSPACE_START --><main>Workspace</main><!-- BF_SHELL_WORKSPACE_END -->'
        '</body>'
    )

    landing = app_module._page_shell(source, "/")
    workspace = app_module._page_shell(source, "/tong-quan")

    assert '<body class="bf-init-loading">' in landing
    assert "Landing" in landing
    assert "Workspace" not in landing
    assert '<body class="bf-init-loading" hidden>' in workspace
