import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"


def _module_name(path: Path) -> str:
    relative = path.relative_to(PROJECT_ROOT).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _backend_import_graph() -> dict[str, set[str]]:
    modules = {
        _module_name(path): path
        for path in BACKEND_ROOT.rglob("*.py")
    }
    graph = {module: set() for module in modules}
    for module, path in modules.items():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                imported = [node.module]
            else:
                continue
            for candidate in imported:
                target = candidate
                while target and target not in modules:
                    target = target.rpartition(".")[0]
                if target and target != module:
                    graph[module].add(target)
    return graph


def _cyclic_components(graph: dict[str, set[str]]) -> list[tuple[str, ...]]:
    next_index = 0
    indices: dict[str, int] = {}
    low_links: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    components: list[tuple[str, ...]] = []

    def visit(module: str) -> None:
        nonlocal next_index
        indices[module] = next_index
        low_links[module] = next_index
        next_index += 1
        stack.append(module)
        on_stack.add(module)

        for dependency in graph[module]:
            if dependency not in indices:
                visit(dependency)
                low_links[module] = min(low_links[module], low_links[dependency])
            elif dependency in on_stack:
                low_links[module] = min(low_links[module], indices[dependency])

        if low_links[module] != indices[module]:
            return
        component = []
        while True:
            dependency = stack.pop()
            on_stack.remove(dependency)
            component.append(dependency)
            if dependency == module:
                break
        if len(component) > 1:
            components.append(tuple(sorted(component)))

    for module in graph:
        if module not in indices:
            visit(module)
    return sorted(components)


def test_backend_import_graph_has_no_cycles():
    assert _cyclic_components(_backend_import_graph()) == []
