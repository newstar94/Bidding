"""Source-neutral wire contract (ADR 0088), never a storage/log redactor."""

import json
import re

from starlette.datastructures import MutableHeaders


_PROVIDERS = {
    "MUASAMCONG": "AUTOMATIC_DATA", "MUASAMCONG_BROWSER": "AUTOMATIC_BROWSER",
    "MuaSamCong": "automatic", "muasamcong": "automatic",
    "VNEPS": "EXTERNAL_DATA", "VNEPS_FIXTURE": "EXTERNAL_FIXTURE",
    "MuaSamCongFixture": "automatic_fixture",
}
_INTERNAL_PROVIDERS = {value: key for key, value in _PROVIDERS.items()}
_IDENTITY_FIELDS = {"provider", "source", "sourceProvider", "source_provider", "authority", "versionAuthority"}
_SOURCE_HOST = re.compile(r"(?<![\w.-])(?:https?://)?(?:[\w-]+\.)*muasamcong(?:\.(?:mpi|mof))?\.gov\.vn(?![.\w-])[^\s\"'<>]*", re.I)
_SOURCE_NAME = re.compile(r"Mua\s*Sắm\s*Công|MuaSamCong|\bMSC\b|\bVNEPS\b", re.I)
_CRITERION = re.compile(r"^((?:detailed-evaluation-row:.+:)?evaluation-criterion:.+:)?MSC_([A-Z0-9_]+)$")
_PUBLIC_CRITERION = re.compile(r"^((?:detailed-evaluation-row:.+:)?evaluation-criterion:.+:)?AUTO_([A-Z0-9_]+)$")
_CRITERION_FIELDS = {"id", "code", "criterionId", "parentCriterionId", "maTieuChi", "tieuChiDanhGiaId"}
_URL_FIELDS = {"sourceUrl", "source_url", "publicUrl", "portalUrl", "url", "link", "href", "origin", "homepage"}
_LABEL_FIELDS = {"name", "description", "badge", "variantLabel", "periodLabel", "benefits", "displayName", "packageName"}
_VERSION_FIELDS = {"schemaVersion", "schema_version", "mappingSchemaVersion", "parserVersion", "templateVersion", "version"}
_WIRE_MARKER = re.compile(rb'mua|vneps|msc_|\bmsc\b|\\u00|"sources"', re.I)


def source_neutral_message(value):
    return _SOURCE_NAME.sub("dịch vụ lấy dữ liệu tự động", _SOURCE_HOST.sub("dịch vụ lấy dữ liệu tự động", value))


def source_neutral_label(value):
    value = re.sub(r"lấy\s+(?:dữ liệu|hồ sơ)(?:\s+từ)?\s+Mua\s*Sắm\s*Công", "lấy dữ liệu tự động", value, flags=re.I)
    value = re.sub(r"dữ liệu\s+Mua\s*Sắm\s*Công", "dữ liệu tự động", value, flags=re.I)
    return _SOURCE_NAME.sub("lấy dữ liệu tự động", _SOURCE_HOST.sub("dịch vụ lấy dữ liệu tự động", value))


def _criterion_alias(value, *, internal=False):
    pattern = _PUBLIC_CRITERION if internal else _CRITERION
    prefix = "MSC_" if internal else "AUTO_"
    return pattern.sub(lambda match: f"{match[1] or ''}{prefix}{match[2]}", value)


def _version_alias(value, key, *, internal=False):
    if key in {"version", "templateVersion"}:
        prefix = "automatic" if internal else "muasamcong"
        if not re.fullmatch(rf"{prefix}-(?:standard|medicine)-v[0-9]+", value):
            return value
    if internal:
        return value.replace("automatic-", "muasamcong-").replace("external-", "vneps-")
    return value.replace("muasamcong-", "automatic-").replace("vneps-", "external-")


def public_source_payload(value, *, catalog=False, _path=()):
    """Copy metadata only; business text and authorized PII are not redacted."""
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {"endpoint", "requestUrl", "responseUrl"} and "sources" in _path:
                continue
            if key in _URL_FIELDS and isinstance(item, str) and _SOURCE_HOST.search(item):
                continue
            result[_criterion_alias(key)] = public_source_payload(item, catalog=catalog, _path=(*_path, key))
        return result
    if isinstance(value, (list, tuple)):
        return [public_source_payload(item, catalog=catalog, _path=_path) for item in value]
    if not isinstance(value, str):
        return value
    key = _path[-1] if _path else ""
    if key in _IDENTITY_FIELDS:
        return _PROVIDERS.get(value, value)
    if key in _VERSION_FIELDS:
        return _version_alias(value, key)
    if key in _CRITERION_FIELDS or value.startswith(("evaluation-criterion:", "detailed-evaluation-row:")):
        return _criterion_alias(value)
    if key in {"message", "error", "lastError", "reason", "warning"} and (
        len(_path) == 1 or any(part in {"errors", "blockingErrors", "warnings", "failures", "sources", "session", "api"} for part in _path[:-1])
    ):
        return source_neutral_message(value)
    if key in _LABEL_FIELDS and (
        "display" in _path or key in {"displayName", "packageName"}
        or (catalog and any(part in {"packages", "offers", "skus"} for part in _path[:-1]))
    ):
        return source_neutral_label(value)
    return value


def internal_source_payload(value, *, _key=""):
    """Decode aliases before normal validation; no new authority or migration."""
    if isinstance(value, (dict, list)):
        # The existing request validator owns depth limits. Do not introduce a
        # recursive walk that can fail before that validator returns its 400.
        result = {} if isinstance(value, dict) else []
        pending = [(value, result, _key)]
        while pending:
            source, target, parent_key = pending.pop()
            items = source.items() if isinstance(source, dict) else enumerate(source)
            for key, item in items:
                field = key if isinstance(source, dict) else parent_key
                if isinstance(item, (dict, list)):
                    projected = {} if isinstance(item, dict) else []
                    pending.append((item, projected, field))
                else:
                    projected = internal_source_payload(item, _key=field)
                if isinstance(target, dict):
                    target[_criterion_alias(key, internal=True)] = projected
                else:
                    target.append(projected)
        return result
    if not isinstance(value, str):
        return value
    if _key in _IDENTITY_FIELDS:
        return _INTERNAL_PROVIDERS.get(value, value)
    if _key in _VERSION_FIELDS:
        return _version_alias(value, _key, internal=True)
    if _key in _CRITERION_FIELDS or value.startswith(("evaluation-criterion:", "detailed-evaluation-row:")):
        return _criterion_alias(value, internal=True)
    return value


class SourcePrivacyMiddleware:
    """Project API JSON, including fragments; pass files/SSE through untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        start = None
        chunks = []
        path = scope.get("path", "")
        catalog = path.startswith(("/api/commercial", "/api/public/commercial", "/api/billing"))

        async def public_send(message):
            nonlocal start
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if (headers.get("content-type", "").split(";", 1)[0] == "application/json"
                        and scope.get("method") != "HEAD" and message["status"] not in {204, 304}):
                    start = {**message, "headers": list(message.get("headers", []))}
                    return
            if message["type"] == "http.response.body" and start is not None:
                chunks.append(message.get("body", b""))
                if message.get("more_body", False):
                    return
                original = b"".join(chunks)
                body = original
                if _WIRE_MARKER.search(original):
                    payload = json.loads(original)
                    projected = public_source_payload(payload, catalog=catalog)
                    if projected != payload:
                        body = json.dumps(projected, ensure_ascii=False, allow_nan=False,
                                          separators=(",", ":")).encode("utf-8")
                headers = MutableHeaders(scope=start)
                headers["content-length"] = str(len(body))
                for header in ("etag", "content-md5", "digest"):
                    if body != original and header in headers:
                        del headers[header]
                await send(start)
                await send({**message, "body": body})
                start = None
                return
            await send(message)

        await self.app(scope, receive, public_send)
