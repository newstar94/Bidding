import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ERRORS = []

for base in (ROOT / "backend", ROOT / "scripts"):
    for path in base.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError as exc:
            ERRORS.append(f"{path.relative_to(ROOT)}:{exc.lineno}: {exc.msg}")
            tree = None
        if tree is not None and path.is_relative_to(ROOT / "backend"):
            relative_parts = path.relative_to(ROOT / "backend").parts
            data_core = relative_parts and relative_parts[0] in {"auth", "sync", "documents"}
            if data_core:
                for node in ast.walk(tree):
                    if not isinstance(node, ast.ExceptHandler):
                        continue
                    catches_exception = isinstance(node.type, ast.Name) and node.type.id == "Exception"
                    if catches_exception and node.body and all(isinstance(statement, ast.Pass) for statement in node.body):
                        ERRORS.append(
                            f"{path.relative_to(ROOT)}:{node.lineno}: silent except Exception is forbidden in data core"
                        )
        for number, line in enumerate(text.splitlines(), start=1):
            if line.rstrip() != line:
                ERRORS.append(f"{path.relative_to(ROOT)}:{number}: trailing whitespace")
            if "\t" in line[: len(line) - len(line.lstrip())]:
                ERRORS.append(f"{path.relative_to(ROOT)}:{number}: tab indentation")

if ERRORS:
    raise SystemExit("\n".join(ERRORS))
print("Python static checks passed.")
