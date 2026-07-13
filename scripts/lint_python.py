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
            ast.parse(text, filename=str(path))
        except SyntaxError as exc:
            ERRORS.append(f"{path.relative_to(ROOT)}:{exc.lineno}: {exc.msg}")
        for number, line in enumerate(text.splitlines(), start=1):
            if line.rstrip() != line:
                ERRORS.append(f"{path.relative_to(ROOT)}:{number}: trailing whitespace")
            if "\t" in line[: len(line) - len(line.lstrip())]:
                ERRORS.append(f"{path.relative_to(ROOT)}:{number}: tab indentation")

if ERRORS:
    raise SystemExit("\n".join(ERRORS))
print("Python static checks passed.")

