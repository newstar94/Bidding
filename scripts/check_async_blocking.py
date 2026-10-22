"""Fail when an ``async def`` in backend/ performs blocking database I/O inline.

Async Starlette handlers share one event loop per worker. A synchronous
PostgreSQL round-trip (including ``pool.getconn()`` while the pool is
exhausted) inside such a handler stalls every request served by that worker.
Blocking work must go through ``run_database_read`` / ``run_database_write`` /
``run_blocking_io`` / ``asyncio.to_thread`` instead; passing the function as a
reference (``run_database_read(verify_session, request)``) is allowed.

Usage: ``python scripts/check_async_blocking.py`` (exit code 1 on violations).
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

# Direct calls that perform synchronous database or sleeping work.
BLOCKING_ATTRIBUTE_CALLS = {"get_connection"}
BLOCKING_NAME_CALLS = {"verify_session", "log_audit"}
BLOCKING_QUALIFIED_CALLS = {("time", "sleep")}

# Existing exceptions, each with the reason it is acceptable today. Keys are
# "<path relative to repo>::<async function name>". Shrink this list; do not
# grow it without a reviewed reason.
ALLOWLIST: dict[str, str] = {
    "backend/auth/auth_routes.py::_log_audit_off_event_loop": (
        "inline fallback only when the write lane rejects the job; keeps best-effort audit lossless"
    ),
    "backend/auth/google_auth_routes.py::_log_audit_off_event_loop": (
        "inline fallback only when the write lane rejects the job; keeps best-effort audit lossless"
    ),
    "backend/documents/routes_docx.py::_log_audit_off_event_loop": (
        "inline fallback only when the write lane rejects the job; keeps required audit lossless"
    ),
}


def _call_label(node: ast.Call) -> str | None:
    func = node.func
    if isinstance(func, ast.Attribute):
        if func.attr in BLOCKING_ATTRIBUTE_CALLS:
            return func.attr
        if isinstance(func.value, ast.Name) and (func.value.id, func.attr) in BLOCKING_QUALIFIED_CALLS:
            return f"{func.value.id}.{func.attr}"
    elif isinstance(func, ast.Name) and func.id in BLOCKING_NAME_CALLS:
        if func.id == "log_audit" and any(keyword.arg == "cursor" for keyword in node.keywords):
            # Transactional audit binds to a cursor already owned by a lane.
            return None
        return func.id
    return None


class _AsyncBodyVisitor(ast.NodeVisitor):
    """Collect blocking calls made directly in one async function body."""

    def __init__(self) -> None:
        self.hits: list[tuple[int, str]] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        # Nested sync helpers run wherever their caller sends them.
        return None

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return None

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return None

    def visit_Call(self, node: ast.Call) -> None:
        label = _call_label(node)
        if label:
            self.hits.append((node.lineno, label))
        self.generic_visit(node)


def scan(paths: list[Path]) -> list[str]:
    violations: list[str] = []
    for path in paths:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        relative = path.relative_to(ROOT).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            key = f"{relative}::{node.name}"
            if key in ALLOWLIST:
                continue
            visitor = _AsyncBodyVisitor()
            for statement in node.body:
                visitor.visit(statement)
            for lineno, label in visitor.hits:
                violations.append(f"{relative}:{lineno}: {node.name} calls {label}() on the event loop")
    return violations


def main(argv: list[str]) -> int:
    paths = [Path(arg).resolve() for arg in argv] or sorted(BACKEND.rglob("*.py"))
    violations = scan(paths)
    stale = [key for key in ALLOWLIST if not _allowlist_target_exists(key)]
    for message in violations:
        print(message)
    for key in stale:
        print(f"stale allowlist entry: {key}")
    if violations or stale:
        print(
            "Blocking I/O must run through run_database_read/run_database_write/"
            "run_blocking_io instead of the event loop.",
            file=sys.stderr,
        )
        return 1
    print("async blocking check passed")
    return 0


def _allowlist_target_exists(key: str) -> bool:
    relative, _, name = key.partition("::")
    path = ROOT / relative
    if not path.is_file():
        return False
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return any(isinstance(node, ast.AsyncFunctionDef) and node.name == name for node in ast.walk(tree))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
