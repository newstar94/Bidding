"""THROWAWAY PROTOTYPE — not imported by the sync runtime.

Question answered: what can a generic three-way conflict kernel decide without
an approved business allowlist? Run with:

    python -m backend.sync.conflict_resolution.prototype_merge_cli

The prototype keeps all state in memory and prints every scenario. It deliberately
has no persistence, HTTP adapter, resolution token, mutation, or production flag.
"""

from __future__ import annotations

import json
import sys
from copy import deepcopy


MISSING = object()


def display(value):
    return "<MISSING>" if value is MISSING else value


def merge_scalar(base, local, server):
    """Conservative vocabulary experiment; not an approved business policy."""

    local_changed = local != base
    server_changed = server != base
    if not local_changed and not server_changed:
        return "UNCHANGED", deepcopy(base)
    if local_changed and not server_changed:
        return "TAKE_LOCAL", deepcopy(local)
    if server_changed and not local_changed:
        return "TAKE_SERVER", deepcopy(server)
    if local == server:
        return "BOTH_SAME", deepcopy(local)
    return "NEEDS_DECISION", None


def inspect_field(path, base, local, server, *, approved_scalar=False):
    values = (base, local, server)
    has_delete = any(value is MISSING for value in values)
    has_nested = any(isinstance(value, (dict, list, tuple, set)) for value in values)
    if not approved_scalar:
        status, effective = "UNSUPPORTED_FIELD", None
    elif has_delete:
        status, effective = "UNSUPPORTED_DELETE", None
    elif has_nested:
        status, effective = "UNSUPPORTED_NESTED", None
    else:
        status, effective = merge_scalar(base, local, server)
    return {
        "path": path,
        "base": display(base),
        "local": display(local),
        "server": display(server),
        "approvedScalarForPrototype": approved_scalar,
        "status": status,
        "effective": display(effective),
    }


def scenarios():
    return [
        inspect_field("tenGoiThau", "A", "A", "A", approved_scalar=True),
        inspect_field("tenGoiThau", "A", "B", "A", approved_scalar=True),
        inspect_field("tenGoiThau", "A", "A", "C", approved_scalar=True),
        inspect_field("tenGoiThau", "A", "B", "B", approved_scalar=True),
        inspect_field("tenGoiThau", "A", "B", "C", approved_scalar=True),
        inspect_field("ghiChu", None, "Bổ sung", None, approved_scalar=True),
        inspect_field("tenGoiThau", "A", MISSING, "A", approved_scalar=True),
        inspect_field(
            "phanLoList",
            [{"maPhanLo": "L01"}],
            [{"maPhanLo": "L01"}, {"maPhanLo": "L02"}],
            [{"maPhanLo": "L01", "tenPhanLo": "Server"}],
            approved_scalar=True,
        ),
        inspect_field("soTaiKhoan", "001", "002", "001", approved_scalar=False),
    ]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    payload = {
        "prototype": True,
        "productionWiring": False,
        "question": (
            "What can generic three-way merge decide before DG-07 approves "
            "table/field/delete/nested policies?"
        ),
        "verdict": (
            "Only explicitly supplied scalar fields can be classified. Unknown "
            "fields, delete/missing values, and nested relations must stop. "
            "NEEDS_DECISION is not a mutation instruction."
        ),
        "scenarios": scenarios(),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
