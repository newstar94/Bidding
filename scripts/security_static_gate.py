"""Fail CI on a small set of high-confidence dangerous source constructs."""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (ROOT / "backend", ROOT / "scripts")
DISALLOWED_SERIALIZERS = {"pickle", "cPickle"}
DYNAMIC_SQL_BASELINE = ROOT / "security" / "dynamic-sql-baseline.json"
SQL_METHODS = {"execute", "executemany"}


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        parts = [node.func.attr]
        value = node.func.value
        while isinstance(value, ast.Attribute):
            parts.append(value.attr)
            value = value.value
        if isinstance(value, ast.Name):
            parts.append(value.id)
        return ".".join(reversed(parts))
    return ""


def scan_python_file(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
    findings: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".", 1)[0] in DISALLOWED_SERIALIZERS:
                    findings.append(
                        f"{relative}:{node.lineno}: unsafe serializer import {alias.name}"
                    )
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".", 1)[0] in DISALLOWED_SERIALIZERS:
                findings.append(
                    f"{relative}:{node.lineno}: unsafe serializer import {node.module}"
                )
        elif isinstance(node, ast.Call):
            call_name = _call_name(node)
            if call_name in {"eval", "exec"}:
                findings.append(
                    f"{relative}:{node.lineno}: dynamic code execution via {call_name}"
                )
            if call_name.endswith((".extractall", ".extract")):
                findings.append(
                    f"{relative}:{node.lineno}: unreviewed archive extraction API"
                )
            if call_name.startswith("subprocess."):
                for keyword in node.keywords:
                    if (
                        keyword.arg == "shell"
                        and isinstance(keyword.value, ast.Constant)
                        and keyword.value.value is True
                    ):
                        findings.append(
                            f"{relative}:{node.lineno}: subprocess shell=True"
                        )
    return findings


def dynamic_sql_fingerprint(path: Path) -> tuple[int, str] | None:
    tree = ast.parse(
        path.read_text(encoding="utf-8"),
        filename=path.relative_to(ROOT).as_posix(),
    )
    expressions = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in SQL_METHODS
            and node.args
            and isinstance(node.args[0], (ast.JoinedStr, ast.BinOp))
        ):
            expressions.append(
                ast.dump(node.args[0], annotate_fields=True, include_attributes=False)
            )
    if not expressions:
        return None
    material = "\n".join(sorted(expressions)).encode("utf-8")
    return len(expressions), hashlib.sha256(material).hexdigest()


def verify_dynamic_sql_baseline(paths: list[Path]) -> list[str]:
    if not DYNAMIC_SQL_BASELINE.is_file():
        return ["security/dynamic-sql-baseline.json: reviewed baseline is missing"]
    baseline_document = json.loads(
        DYNAMIC_SQL_BASELINE.read_text(encoding="utf-8")
    )
    expected = baseline_document.get("files")
    if (
        baseline_document.get("formatVersion") != 1
        or not isinstance(expected, dict)
    ):
        return ["security/dynamic-sql-baseline.json: invalid baseline format"]
    actual = {}
    for path in paths:
        fingerprint = dynamic_sql_fingerprint(path)
        if fingerprint:
            actual[path.relative_to(ROOT).as_posix()] = {
                "count": fingerprint[0],
                "sha256": fingerprint[1],
            }
    if actual == expected:
        return []
    findings = []
    for name in sorted(set(actual) | set(expected)):
        if actual.get(name) != expected.get(name):
            findings.append(
                f"{name}: dynamic SQL changed; require security review and baseline update"
            )
    return findings


def main() -> int:
    findings: list[str] = []
    scanned = 0
    paths: list[Path] = []
    for root in SOURCE_ROOTS:
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            paths.append(path)
            scanned += 1
            findings.extend(scan_python_file(path))
    findings.extend(verify_dynamic_sql_baseline(paths))
    if findings:
        print("Security static gate failed:")
        for finding in findings:
            print(f"  {finding}")
        return 1
    print(f"Security static gate passed ({scanned} Python files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
