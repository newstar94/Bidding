"""Read-only application structure discovery for the AI assistant."""

from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from functools import lru_cache
from pathlib import Path
import re
import unicodedata

from backend.ai.types import AiRequestContext, ToolResult


ROOT = Path(__file__).resolve().parents[2]
_ROUTE_PATTERN = re.compile(
    r'^\s*(?:"([^"]+)"|([A-Za-z0-9_-]+)):\s*\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]',
    re.MULTILINE,
)
_ADMIN_TABS = frozenset({"superadmin-dashboard", "superadmin"})
_MANAGER_TABS = frozenset({"managernhanvien", "managerhosogiay"})
_TAB_PERMISSIONS = {
    "kehoach": "kehoach",
    "goithau": "goithau",
    "goithau-timeline": "goithau",
    "mothau": "goithau",
    "danhgiahsdt": "goithau",
    "hopdong": "hopdong",
    "chudautu": "chudautu",
    "nhathau": "nhathau",
    "chuyengia": "chuyengia",
    "bieumau": "goithau",
}


def _text(value: object) -> str:
    return " ".join(str(value or "").split()).strip()


def _fold(value: object) -> str:
    text = _text(value).casefold().replace("đ", "d")
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


def _tokens(value: object) -> tuple[str, ...]:
    return tuple(re.findall(r"[a-z0-9]+", _fold(value)))


class _SidebarParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        if tag != "button":
            return
        attributes = dict(attrs)
        tab = _text(attributes.get("data-tab"))
        label = _text(attributes.get("aria-label") or attributes.get("data-tooltip"))
        if tab and label:
            self.items[tab] = label


class _TabTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._capture: str | None = None
        self._buffer: list[str] = []
        self.headings: list[str] = []
        self.actions: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {"h1", "h2", "h3", "h4"}:
            self._capture = "heading"
            self._buffer = []
        elif tag in {"button", "a"}:
            self._capture = "action"
            self._buffer = []
        elif tag == "label" and "procurement-source-toggle" in str(
            attributes.get("class") or ""
        ).split():
            self._capture = "action"
            self._buffer = []
        elif attributes.get("aria-label"):
            self.actions.append(_text(attributes["aria-label"]))

    def handle_data(self, data):
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag):
        if not self._capture:
            return
        if (self._capture == "heading" and tag in {"h1", "h2", "h3", "h4"}) or (self._capture == "action" and tag in {"button", "a", "label"}):
            value = _text(" ".join(self._buffer))
            if value:
                (self.headings if self._capture == "heading" else self.actions).append(value)
            self._capture = None
            self._buffer = []


def _source_signature() -> tuple[tuple[str, int], ...]:
    paths = [
        ROOT / "views" / "vendor" / "initial-route.js",
        ROOT / "views" / "components" / "sidebar.html",
        *sorted((ROOT / "views" / "tabs").glob("tab_*.html")),
        *sorted((ROOT / "views" / "modals").glob("modal_*.html")),
    ]
    return tuple((str(path), path.stat().st_mtime_ns if path.is_file() else 0) for path in paths)


@lru_cache(maxsize=4)
def _load_manifest(signature: tuple[tuple[str, int], ...]) -> tuple[dict, ...]:
    del signature
    route_source = (ROOT / "views" / "vendor" / "initial-route.js").read_text(encoding="utf-8")
    route_map = {}
    for match in _ROUTE_PATTERN.finditer(route_source):
        route, bare_route, tab, title, loading = match.groups()
        route_map[route or bare_route] = {"tab": tab, "title": _text(title), "loading": _text(loading)}

    sidebar = _SidebarParser()
    sidebar.feed((ROOT / "views" / "components" / "sidebar.html").read_text(encoding="utf-8"))
    tab_details = {}
    for path in sorted((ROOT / "views" / "tabs").glob("tab_*.html")):
        parser = _TabTextParser()
        parser.feed(path.read_text(encoding="utf-8"))
        tab_details[path.stem.removeprefix("tab_")] = {
            "headings": tuple(dict.fromkeys(parser.headings))[:8],
            "actions": tuple(dict.fromkeys(parser.actions))[:12],
        }

    for path in sorted((ROOT / "views" / "modals").glob("modal_*.html")):
        modal_key = path.stem.removeprefix("modal_")
        candidate_tabs = (modal_key, modal_key.removeprefix("detail_"))
        tab = next((item for item in candidate_tabs if item in tab_details), None)
        if not tab:
            continue
        parser = _TabTextParser()
        parser.feed(path.read_text(encoding="utf-8"))
        current = tab_details[tab]
        tab_details[tab] = {
            "headings": tuple(
                dict.fromkeys((*current["headings"], *parser.headings))
            )[:8],
            "actions": tuple(
                dict.fromkeys((*current["actions"], *parser.actions))
            )[:12],
        }

    records = []
    for route, details in route_map.items():
        tab = details["tab"]
        tab_detail = tab_details.get(tab, {"headings": (), "actions": ()})
        title = details["title"] or sidebar.items.get(tab) or tab
        records.append({
            "route": f"/{route}",
            "tab": tab,
            "title": title,
            "description": details["loading"] or title,
            "headings": list(tab_detail["headings"]),
            "actions": list(tab_detail["actions"]),
            "keywords": [route, tab, title, details["loading"], *tab_detail["headings"], *tab_detail["actions"]],
        })
    return tuple(records)


def _is_admin(context: AiRequestContext) -> bool:
    role = _fold(context.platform_role)
    return "superadmin" in role or "super admin" in role


def _is_visible(record: dict, context: AiRequestContext) -> bool:
    tab = record["tab"]
    if tab in _ADMIN_TABS:
        return _is_admin(context)
    if tab in _MANAGER_TABS:
        return _is_admin(context) or _fold(context.membership_role) == "manager"
    permission = _TAB_PERMISSIONS.get(tab)
    return not permission or bool(context.permissions.get(permission))


def search_app_structure(context: AiRequestContext, query: str, *, current_route: str = "/", limit: int = 5) -> ToolResult:
    """Search safe, source-derived route/module metadata without workspace records."""

    safe_limit = max(1, min(int(limit or 5), 8))
    query_text = _text(query)
    query_tokens = _tokens(query_text)
    current_route = _text(current_route) or "/"
    visible = [record for record in _load_manifest(_source_signature()) if _is_visible(record, context)]
    ranked = []
    for record in visible:
        searchable = _fold(" ".join(record["keywords"]))
        score = 0
        if _fold(record["route"]) == _fold(current_route):
            score += 8
        if query_tokens:
            score += sum(6 if token in _fold(record["title"]) else 2 if token in searchable else 0 for token in query_tokens)
            if all(token in searchable for token in query_tokens):
                score += 5
            if any(token in query_tokens for token in ("tao", "them", "moi")):
                if "-chi-tiet" in record["route"]:
                    score -= 4
                elif "danh sach" in _fold(record["title"]):
                    score += 2
        else:
            score = 1
        if score:
            ranked.append((score, record))
    ranked.sort(key=lambda item: (-item[0], item[1]["title"]))
    selected = ranked[:safe_limit]
    records = [
        {
            "route": record["route"],
            "tab": record["tab"],
            "title": record["title"],
            "description": record["description"],
            "headings": record["headings"],
            "actions": record["actions"],
        }
        for _score, record in selected
    ]
    source_links = [
        {"type": "app", "label": record["title"], "url": record["route"]}
        for record in records
    ]
    return ToolResult(
        tool_name="search_app_structure",
        scope={"organizationId": context.organization_id, "membershipRole": context.membership_role},
        filters={"query": query_text, "currentRoute": current_route},
        summary={"type": "app_structure", "matched": len(records)},
        records=records,
        generated_at=datetime.now(timezone.utc).isoformat(),
        source_links=source_links,
    )


def app_structure_tool_definitions() -> list[dict]:
    return [{
        "type": "function",
        "name": "search_app_structure",
        "description": "Tra cứu cấu trúc màn hình, module, route và thao tác của BiddingFlow từ source hiện tại. Không trả dữ liệu nghiệp vụ của workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 240},
                "currentRoute": {"type": "string", "maxLength": 160},
                "limit": {"type": "integer", "minimum": 1, "maximum": 8},
            },
            "required": ["query", "currentRoute", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    }]


def execute_app_structure_tool(context: AiRequestContext, arguments: dict) -> ToolResult:
    return search_app_structure(
        context,
        str(arguments.get("query") or ""),
        current_route=str(arguments.get("currentRoute") or "/"),
        limit=int(arguments.get("limit") or 5),
    )
