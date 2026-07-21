"""Normalization rules for investor representative and head positions."""

from __future__ import annotations

import re


_VICE_PREFIX = re.compile(r"^phó(?=\s|$|[:,-])[\s:,-]*", re.IGNORECASE)
_VICE_PRINCIPAL_PREFIX = re.compile(
    r"^hiệu\s+phó(?=\s|$|[:,-])",
    re.IGNORECASE,
)


def derive_investor_head_position(representative_position) -> str:
    """Derive the head position from an investor representative position.

    A non-deputy position is retained. Deputy prefixes are removed, while the
    Vietnamese special form ``Hiệu phó`` is normalized to ``Hiệu trưởng``.
    """

    position = str(representative_position or "").strip()
    if not position:
        return ""

    if _VICE_PRINCIPAL_PREFIX.match(position):
        head_position = _VICE_PRINCIPAL_PREFIX.sub("Hiệu trưởng", position, count=1)
    elif _VICE_PREFIX.match(position):
        head_position = _VICE_PREFIX.sub("", position, count=1).strip()
    else:
        return position

    if not head_position:
        return position
    return head_position[0].upper() + head_position[1:]
