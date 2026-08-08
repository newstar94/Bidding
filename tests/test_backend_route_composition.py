from backend.documents.document_job_routes import document_job_routes
from backend.documents.package_document_routes import package_document_routes
from backend.lifecycle_policy_routes import lifecycle_policy_routes
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
    ]
    registrations = {(route.path, route.methods) for route in routes}

    assert ("/api/sync", ("POST",)) in registrations
    assert ("/api/sync/delta", ("GET",)) in registrations
    assert ("/api/sync/restore", ("POST",)) in registrations
    assert ("/api/versioning/aggregate", ("POST",)) in registrations
    assert ("/api/packages/{package_id}/documents", ("GET",)) in registrations
    assert ("/api/document-jobs/{job_id}/download", ("GET",)) in registrations
    assert ("/api/contracts/package-lifecycle", ("GET",)) in registrations
