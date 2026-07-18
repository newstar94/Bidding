import ast
from pathlib import Path


def _async_connection_calls(path):
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    violations = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for child in ast.walk(node):
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr == "get_connection"
            ):
                violations.append(f"{node.name}:{child.lineno}")
    return violations


def test_migrated_route_coroutines_never_open_database_connections_directly():
    files = (
        "backend/api/org_routes.py",
        "backend/auth/auth_routes.py",
        "backend/auth/otp_routes.py",
        "backend/auth/google_auth_routes.py",
    )
    violations = {
        path: _async_connection_calls(path)
        for path in files
        if _async_connection_calls(path)
    }
    assert violations == {}
