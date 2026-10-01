"""Runtime Node imports must survive the documented production install."""

import json
import re
from pathlib import Path


def test_backend_node_imports_are_production_dependencies():
    root = Path(__file__).resolve().parents[1]
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    dependencies = package["dependencies"]
    assert lock["packages"][""]["dependencies"] == dependencies
    imports = set()
    for module in (root / "backend").rglob("*.mjs"):
        for specifier in re.findall(r'from\s+[\'"]([^\'"]+)[\'"]', module.read_text(encoding="utf-8")):
            if specifier.startswith((".", "/", "node:")):
                continue
            name = "/".join(specifier.split("/")[:2]) if specifier.startswith("@") else specifier.split("/")[0]
            imports.add(name)
    assert imports
    assert imports <= dependencies.keys(), f"Missing production Node dependencies: {imports - dependencies.keys()}"
    for name in imports:
        assert not lock["packages"][f"node_modules/{name}"].get("dev", False)
