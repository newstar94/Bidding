"""Conservative static-module preloads for the development source transport.

This only discovers files the browser already needs for the selected shell.
Unsupported syntax or paths are omitted; normal ESM loading remains the fallback.
It does not execute modules, change response caching, or follow dynamic imports.
"""

from __future__ import annotations

from collections import deque
from functools import lru_cache
from pathlib import Path, PurePosixPath
import posixpath


_ALLOWED_SOURCE_ROOTS = frozenset({"frontend", "views", "vendor"})
_MAX_MODULES = 512
_MAX_SOURCE_BYTES = 2 * 1024 * 1024
_MAX_CLAUSE_TOKENS = 256


def _skip_string(source: str, start: int) -> tuple[int, str | None]:
    quote = source[start]
    index = start + 1
    escaped = False
    while index < len(source):
        char = source[index]
        if char == "\\":
            escaped = True
            index += 2
        elif char == quote:
            return index + 1, None if escaped else source[start + 1:index]
        elif char in "\r\n":
            return index, None
        else:
            index += 1
    return index, None


def _skip_comment(source: str, start: int) -> int:
    if source.startswith("//", start):
        end = source.find("\n", start + 2)
        return len(source) if end < 0 else end
    end = source.find("*/", start + 2)
    return len(source) if end < 0 else end + 2


def _skip_regex(source: str, start: int) -> int:
    """Skip a slash-delimited body when it terminates on the same line.

    A division pair can also match. Omitting its expression tokens is safe for
    this conservative declaration collector and avoids guessing JS regex goals.
    """
    index = start + 1
    in_class = False
    while index < len(source) and source[index] not in "\r\n":
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            in_class = True
        elif char == "]":
            in_class = False
        elif char == "/" and not in_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        index += 1
    return start + 1


def _skip_template(source: str, start: int, nesting: int = 0) -> int:
    if nesting >= 32:
        return len(source)
    index = start + 1
    while index < len(source):
        if source[index] == "\\":
            index += 2
        elif source[index] == "`":
            return index + 1
        elif source.startswith("${", index):
            index = _skip_template_expression(source, index + 2, nesting + 1)
        else:
            index += 1
    return index


def _skip_template_expression(source: str, start: int, nesting: int) -> int:
    index = start
    depth = 1
    while index < len(source):
        char = source[index]
        if char in "\"'":
            index, _ = _skip_string(source, index)
        elif char == "`":
            index = _skip_template(source, index, nesting)
        elif source.startswith(("//", "/*"), index):
            index = _skip_comment(source, index)
        elif char == "/":
            index = _skip_regex(source, index)
        else:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return index + 1
            index += 1
    return index


def _tokens(source: str) -> list[tuple[str, str | None]]:
    tokens = []
    index = 0
    while index < len(source):
        char = source[index]
        if char.isspace():
            index += 1
        elif source.startswith(("//", "/*"), index):
            index = _skip_comment(source, index)
        elif char in "\"'":
            index, literal = _skip_string(source, index)
            tokens.append(("string", literal))
        elif char == "`":
            index = _skip_template(source, index)
            tokens.append(("opaque", None))
        elif char == "/":
            end = _skip_regex(source, index)
            tokens.append(("opaque", None) if end > index + 1 else ("punct", "/"))
            index = end
        elif char.isalpha() or char in "_$":
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in "_$"):
                end += 1
            tokens.append(("word", source[index:end]))
            index = end
        else:
            tokens.append(("punct", char))
            index += 1
    return tokens


def _after_named_clause(tokens: list[tuple[str, str | None]], index: int) -> int | None:
    end = min(len(tokens), index + _MAX_CLAUSE_TOKENS)
    for current in range(index + 1, end):
        kind, value = tokens[current]
        if (kind, value) == ("punct", "}"):
            return current + 1
        if kind not in {"word", "string"} and (kind, value) != ("punct", ","):
            return None
    return None


def _static_specifier(tokens: list[tuple[str, str | None]], start: int) -> str | None:
    declaration = tokens[start][1]
    index = start + 1
    if index >= len(tokens):
        return None
    if declaration == "import" and tokens[index][0] == "string":
        return tokens[index][1]
    if declaration == "import" and tokens[index][0] == "word":
        index += 1  # Default binding.
        if index < len(tokens) and tokens[index] == ("punct", ","):
            index += 1
        elif index < len(tokens) and tokens[index] != ("word", "from"):
            return None
    if index >= len(tokens):
        return None
    if tokens[index] == ("punct", "{"):
        index = _after_named_clause(tokens, index)
        if index is None:
            return None
    elif tokens[index] == ("punct", "*"):
        index += 1
        if index < len(tokens) and tokens[index] == ("word", "as"):
            index += 1
            if index >= len(tokens) or tokens[index][0] != "word":
                return None
            index += 1
        elif declaration == "import":
            return None
    elif tokens[index] != ("word", "from") or declaration != "import":
        return None
    if index + 1 < len(tokens) and tokens[index] == ("word", "from"):
        if tokens[index + 1][0] == "string":
            return tokens[index + 1][1]
    return None


def _static_specifiers(source: str) -> tuple[str, ...]:
    tokens = _tokens(source)
    depths = {"{": 0, "(": 0, "[": 0}
    closers = {"}": "{", ")": "(", "]": "["}
    result = []
    for index, token in enumerate(tokens):
        kind, value = token
        if kind == "word" and value in {"import", "export"} and not any(depths.values()):
            if index == 0 or tokens[index - 1] != ("punct", "."):
                specifier = _static_specifier(tokens, index)
                if specifier is not None and specifier not in result:
                    result.append(specifier)
                    if len(result) >= _MAX_MODULES:
                        break
        if kind == "punct" and value in depths:
            depths[value] += 1
        elif kind == "punct" and value in closers:
            opener = closers[value]
            depths[opener] = max(0, depths[opener] - 1)
    return tuple(result)


@lru_cache(maxsize=_MAX_MODULES)
def _file_dependencies(path: str, mtime_ns: int, size: int) -> tuple[str, ...]:
    # Signature arguments intentionally participate in the cache key.
    del mtime_ns
    if size > _MAX_SOURCE_BYTES:
        return ()
    try:
        with Path(path).open(encoding="utf-8-sig") as source_file:
            source = source_file.read(_MAX_SOURCE_BYTES + 1)
    except (OSError, UnicodeError):
        return ()
    if len(source) > _MAX_SOURCE_BYTES:
        return ()
    return _static_specifiers(source)


def _source_file(project_root: Path, relative: str) -> tuple[str, Path] | None:
    if not isinstance(relative, str) or any(char in relative for char in "\\:?#%\"'<>`\x00"):
        return None
    if PurePosixPath(relative).is_absolute():
        return None
    normalized = posixpath.normpath(relative)
    parts = PurePosixPath(normalized).parts
    if not parts or parts[0] not in _ALLOWED_SOURCE_ROOTS or ".." in parts:
        return None
    candidate = project_root.joinpath(*parts)
    try:
        resolved = candidate.resolve(strict=True)
        resolved_relative = resolved.relative_to(project_root)
        if resolved_relative.parts[0] not in _ALLOWED_SOURCE_ROOTS:
            return None
        if not resolved.is_file() or resolved.suffix not in {".js", ".mjs"}:
            return None
    except (OSError, ValueError, IndexError):
        return None
    return normalized, resolved


def resolve_source_preload_graph(
    project_root: str | Path, entry_keys: tuple[str, ...],
) -> tuple[str, ...]:
    """Return bounded, deduplicated project-relative static module URL paths.

    Each request checks reached file signatures, including dependencies, so an
    edit can add/remove an edge without restarting the development backend.
    Only exact existing relative JS module imports are followed. Browser ESM
    loading still owns missing, dynamic, external, or unsupported dependencies.
    """
    root = Path(project_root).resolve()
    queued = set()
    pending = deque()
    for entry in entry_keys[:_MAX_MODULES]:
        if isinstance(entry, str):
            normalized = posixpath.normpath(entry)
            if normalized not in queued:
                queued.add(normalized)
                pending.append(normalized)
    visited = set()
    sources = []
    while pending and len(visited) < _MAX_MODULES:
        relative = pending.popleft()
        source_file = _source_file(root, relative)
        if source_file is None:
            continue
        url_path, resolved = source_file
        if url_path in visited:
            continue
        visited.add(url_path)
        sources.append(url_path)
        try:
            stat = resolved.stat()
        except OSError:
            continue
        dependencies = _file_dependencies(str(resolved), stat.st_mtime_ns, stat.st_size)
        for specifier in dependencies:
            if specifier.startswith(("./", "../")):
                dependency = posixpath.normpath(posixpath.join(posixpath.dirname(url_path), specifier))
                if dependency not in queued and len(queued) < _MAX_MODULES:
                    queued.add(dependency)
                    pending.append(dependency)
    return tuple(sources)
