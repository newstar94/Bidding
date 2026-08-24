"""Pure conservative three-way merge classification for scalar fields."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any


MISSING = object()


@dataclass(frozen=True, slots=True)
class FieldInspection:
    field: str
    status: str
    base: Any
    local: Any
    server: Any
    suggested_value: Any = None
    requires_choice: bool = False

    def as_dict(self) -> dict[str, Any]:
        def value(item):
            return {"missing": True} if item is MISSING else deepcopy(item)

        result = {
            "field": self.field,
            "status": self.status,
            "base": value(self.base),
            "local": value(self.local),
            "server": value(self.server),
            "requiresChoice": self.requires_choice,
        }
        if self.suggested_value is not MISSING:
            result["suggestedValue"] = value(self.suggested_value)
        return result


def inspect_three_way(
    field: str,
    base: Any,
    local: Any,
    server: Any,
    *,
    approved_scalar: bool,
    always_require_choice: bool = False,
) -> FieldInspection:
    """Classify one field without turning a classification into a write."""

    values = (base, local, server)
    if not approved_scalar:
        return FieldInspection(field, "UNSUPPORTED_FIELD", base, local, server, MISSING, True)
    if any(value is MISSING for value in values):
        return FieldInspection(field, "UNSUPPORTED_DELETE", base, local, server, MISSING, True)
    if any(isinstance(value, (dict, list, tuple, set)) for value in values):
        return FieldInspection(field, "UNSUPPORTED_NESTED", base, local, server, MISSING, True)

    local_changed = local != base
    server_changed = server != base
    if not local_changed and not server_changed:
        return FieldInspection(field, "UNCHANGED", base, local, server, deepcopy(base), False)
    if local_changed and not server_changed:
        return FieldInspection(
            field,
            "LOCAL_ONLY",
            base,
            local,
            server,
            deepcopy(local),
            always_require_choice,
        )
    if server_changed and not local_changed:
        return FieldInspection(
            field,
            "SERVER_ONLY",
            base,
            local,
            server,
            deepcopy(server),
            always_require_choice,
        )
    if local == server:
        return FieldInspection(field, "BOTH_SAME", base, local, server, deepcopy(local), False)
    return FieldInspection(field, "CONFLICT", base, local, server, MISSING, True)
