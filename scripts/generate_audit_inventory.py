"""Generate a deterministic, machine-readable BiddingFlow source inventory."""

from __future__ import annotations

import ast
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "audits" / "BIDDINGFLOW_AUDIT_BASELINE.json"
SOURCE_ROOTS = ("backend", "frontend", "scripts", "tests", "views", ".github")
TEXT_SUFFIXES = {
    ".py": "Python",
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".css": "CSS",
    ".html": "HTML",
    ".json": "JSON",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".md": "Markdown",
    ".toml": "TOML",
}
JS_IMPORT_RE = re.compile(
    r"(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+|import\()"
    r"[\"'](?P<path>[^\"']+)[\"']"
)
STORAGE_KEY_RE = re.compile(
    r"(?:localStorage|sessionStorage)\?*\.(?:getItem|setItem|removeItem)\(\s*[\"']([^\"']+)[\"']"
)
ROUTE_RE = re.compile(r"\b(?:Route|WebSocketRoute)\(\s*[\"']([^\"']+)[\"']")


def _files():
    for root_name in SOURCE_ROOTS:
        source_root = ROOT / root_name
        if not source_root.exists():
            continue
        for path in sorted(source_root.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            if path.suffix.casefold() in TEXT_SUFFIXES:
                yield path


def _relative(path):
    return path.relative_to(ROOT).as_posix()


def _text(path):
    return path.read_text(encoding="utf-8-sig", errors="replace")


def _python_module(path):
    return ".".join(path.relative_to(ROOT).with_suffix("").parts)


def _python_inventory(paths):
    functions = []
    imports = defaultdict(set)
    decision_nodes = (
        ast.If,
        ast.IfExp,
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.Try,
        ast.BoolOp,
        ast.Match,
        ast.comprehension,
    )
    for path in paths:
        try:
            tree = ast.parse(_text(path), filename=str(path))
        except SyntaxError:
            continue
        module_name = _python_module(path)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                end_line = int(getattr(node, "end_lineno", node.lineno))
                complexity = 1 + sum(
                    1 for child in ast.walk(node) if isinstance(child, decision_nodes)
                )
                functions.append(
                    {
                        "file": _relative(path),
                        "name": node.name,
                        "line": node.lineno,
                        "lines": end_line - node.lineno + 1,
                        "cyclomaticApproximation": complexity,
                    }
                )
            elif isinstance(node, ast.Import):
                imports[module_name].update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports[module_name].add(node.module)
    functions.sort(
        key=lambda item: (item["cyclomaticApproximation"], item["lines"]),
        reverse=True,
    )
    return functions[:100], {key: sorted(value) for key, value in sorted(imports.items())}


def _javascript_imports(paths):
    graph = {}
    for path in paths:
        imports = sorted({match.group("path") for match in JS_IMPORT_RE.finditer(_text(path))})
        if imports:
            graph[_relative(path)] = imports
    return graph


def _bundle_inventory():
    result = []
    assets = ROOT / "dist" / "assets"
    if not assets.is_dir():
        return result
    try:
        import brotli
    except ImportError:  # pragma: no cover - optional local measurement helper.
        brotli = None
    for path in sorted(assets.glob("*")):
        if not path.is_file():
            continue
        content = path.read_bytes()
        if brotli:
            brotli_bytes = len(brotli.compress(content))
        else:
            completed = subprocess.run(
                [
                    "node",
                    "-e",
                    (
                        "const fs=require('node:fs'),z=require('node:zlib');"
                        "const b=fs.readFileSync(process.argv[1]);"
                        "process.stdout.write(String(z.brotliCompressSync(b,{params:{"
                        "[z.constants.BROTLI_PARAM_QUALITY]:11}}).length));"
                    ),
                    str(path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            brotli_bytes = int(completed.stdout)
        result.append(
            {
                "file": _relative(path),
                "bytes": len(content),
                "gzipBytes": len(gzip.compress(content, compresslevel=9)),
                "brotliBytes": brotli_bytes,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    return result


def _git_value(*arguments):
    completed = subprocess.run(
        ["git", *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


def main():
    paths = list(_files())
    file_records = []
    language_counts = defaultdict(lambda: {"files": 0, "lines": 0})
    directory_counts = defaultdict(lambda: {"files": 0, "lines": 0})
    storage_keys = defaultdict(set)
    routes = []
    for path in paths:
        content = _text(path)
        line_count = len(content.splitlines())
        language = TEXT_SUFFIXES[path.suffix.casefold()]
        relative = _relative(path)
        file_records.append({"file": relative, "language": language, "lines": line_count})
        language_counts[language]["files"] += 1
        language_counts[language]["lines"] += line_count
        directory_counts[path.relative_to(ROOT).parts[0]]["files"] += 1
        directory_counts[path.relative_to(ROOT).parts[0]]["lines"] += line_count
        if language == "JavaScript":
            storage_keys[relative].update(STORAGE_KEY_RE.findall(content))
        if path.suffix == ".py":
            routes.extend(
                {"file": relative, "path": match.group(1)}
                for match in ROUTE_RE.finditer(content)
            )

    python_paths = [path for path in paths if path.suffix == ".py"]
    javascript_paths = [path for path in paths if path.suffix in {".js", ".mjs", ".cjs"}]
    functions, python_imports = _python_inventory(python_paths)
    file_records.sort(key=lambda item: item["lines"], reverse=True)
    schema = {
        table: {
            "columns": list(spec.get("columns", {})),
            "primaryKeys": list(spec.get("primary_keys", ())),
            "uniqueConstraints": list(spec.get("unique_constraints", ())),
            "foreignKeys": list(spec.get("foreign_keys", ())),
        }
        for table, spec in sorted(SCHEMA_DINH_NGHIA.items())
    }
    payload = {
        "formatVersion": 1,
        "git": {
            "commit": _git_value("rev-parse", "HEAD"),
            "branch": _git_value("branch", "--show-current"),
            "workingTreeDirty": bool(_git_value("status", "--porcelain")),
        },
        "baselineMeasurements": {
            "runtime": {"python": "3.14.5", "node": "24.18.0", "npm": "11.16.0"},
            "pythonTests": {"passed": 132, "failed": 0, "seconds": 4.31},
            "javascriptTests": {"passed": 117, "failed": 0, "seconds": 0.999},
            "compileall": {"exitCode": 0, "seconds": 0.350},
            "securityLint": {"exitCode": 0, "seconds": 3.196},
            "vendorAudit": {"exitCode": 0, "seconds": 0.970},
            "secureBuild": {
                "exitCode": 0,
                "seconds": 11.742,
                "javascriptReportedBytes": 1854470,
                "javascriptGzipReportedBytes": 406040,
                "cssReportedBytes": 316670,
                "cssGzipReportedBytes": 56790,
            },
            "productionPackage": {
                "exitCode": 1,
                "seconds": 10.898,
                "error": "Required production directory is missing: deploy",
            },
            "browserE2E": {
                "passed": 0,
                "failed": 5,
                "failedCommands": [
                    "test:bidder-goods-e2e",
                    "test:crud-modules-e2e",
                    "test:multi-assignee-e2e",
                    "test:joint-venture-e2e",
                    "test:lifecycle",
                ],
            },
            "coverageAfterRegressionTests": {
                "pythonTotalPercent": 33,
                "javascriptLinesPercent": 32.30,
                "javascriptBranchesPercent": 55.19,
                "javascriptFunctionsPercent": 37.24,
            },
        },
        "totals": {
            "files": len(file_records),
            "lines": sum(item["lines"] for item in file_records),
        },
        "byLanguage": dict(sorted(language_counts.items())),
        "byTopLevelDirectory": dict(sorted(directory_counts.items())),
        "largestFiles": file_records[:100],
        "largestPythonFunctions": functions,
        "dependencyGraph": {
            "pythonImports": python_imports,
            "javascriptImports": _javascript_imports(javascript_paths),
        },
        "routes": routes,
        "browserStorageKeys": {
            key: sorted(value) for key, value in sorted(storage_keys.items()) if value
        },
        "database": {
            "schemaVersion": DB_SCHEMA_VERSION,
            "upgrades": [
                {"version": upgrade.version, "name": upgrade.name}
                for upgrade in UPGRADES
            ],
            "tables": schema,
        },
        "bundle": _bundle_inventory(),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"Audit inventory written to {OUTPUT.relative_to(ROOT)} "
        f"({payload['totals']['files']} files, {payload['totals']['lines']} lines)."
    )


if __name__ == "__main__":
    main()
