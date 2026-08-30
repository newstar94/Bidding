from backend.documents.document_job_routes import document_job_routes
from backend.documents.package_document_routes import package_document_routes
from backend.lifecycle_policy_routes import lifecycle_policy_routes
from backend.procurement_lookup.routes import procurement_lookup_routes
from backend.sync.api import sync_http_routes


class Route:
    def __init__(self, path, endpoint, methods):
        self.path = path
        self.endpoint = endpoint
        self.methods = tuple(methods)


def test_feature_route_registries_keep_critical_endpoints_registered():
    routes = [
        *sync_http_routes(Route),
        *package_document_routes(Route),
        *document_job_routes(Route),
        *lifecycle_policy_routes(Route),
        *procurement_lookup_routes(Route),
    ]
    registrations = {(route.path, route.methods) for route in routes}

    assert ("/api/sync", ("POST",)) in registrations
    assert ("/api/sync/delta", ("GET",)) in registrations
    assert ("/api/sync/restore", ("POST",)) in registrations
    assert ("/api/versioning/aggregate", ("POST",)) in registrations
    assert ("/api/plans/finalize-draft", ("POST",)) in registrations
    assert ("/api/packages/{package_id}/documents", ("GET",)) in registrations
    assert ("/api/document-jobs/{job_id}/download", ("GET",)) in registrations
    assert ("/api/contracts/package-lifecycle", ("GET",)) in registrations
    assert ("/api/procurement/lookup", ("POST",)) in registrations


def test_commercial_workspace_deep_links_are_registered_for_browser_refresh():
    from backend.app import routes
    from backend.auth.username_validator import validate_username

    registered_get_paths = {
        route.path
        for route in routes
        if "GET" in getattr(route, "methods", set())
    }

    assert "/thuong-mai-thanh-toan" in registered_get_paths
    assert "/goi-va-thanh-toan" in registered_get_paths
    assert "/thanh-toan-gia-lap/{profile_id}/{order_code}" in registered_get_paths
    assert "/thanh-toan/ket-qua" in registered_get_paths
    assert "/thanh-toan/huy" in registered_get_paths
    assert validate_username("thuong_mai_thanh_toan")[0] is False
    assert validate_username("goi_va_thanh_toan")[0] is False


def test_usage_analytics_routes_and_reserved_spa_slug_are_registered():
    from backend.app import routes
    from backend.auth.username_validator import validate_username
    from backend.usage_analytics.routes import (
        usage_analytics_event_api,
        usage_analytics_summary_api,
    )

    registered = {
        (route.path, frozenset(getattr(route, "methods", set())), route.endpoint)
        for route in routes
        if hasattr(route, "endpoint")
    }

    assert (
        "/api/usage-analytics/events",
        frozenset({"POST"}),
        usage_analytics_event_api,
    ) in registered
    assert (
        "/api/admin/usage-analytics/summary",
        frozenset({"GET", "HEAD"}),
        usage_analytics_summary_api,
    ) in registered
    assert any(path == "/phan-tich-su-dung" for path, _methods, _endpoint in registered)
    assert validate_username("phan_tich_su_dung")[0] is False
