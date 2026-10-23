"""Organization tax-code normalization and verification state (ADR 0094)."""

from __future__ import annotations

import os
import re


# Same accepted shapes as the frontend partner tax-code helpers. The check
# digit is intentionally not enforced so real tax codes are never rejected.
_TAX_CODE_RE = re.compile(r"^(?:\d{9,14}|\d{10}-\d{3})$")
TAX_CODE_VERIFIED = "verified"
TAX_CODE_UNVERIFIED = "unverified"


def normalize_tax_code(value):
    """Return the canonical tax code, or ``None`` when the shape is invalid.

    Spaces, dots and underscores are dropped and a 13-digit branch code is
    written ``XXXXXXXXXX-XXX`` so one tax code has exactly one spelling.
    """

    candidate = re.sub(r"[\s._]", "", str(value or ""))
    if re.fullmatch(r"\d{13}", candidate):
        candidate = f"{candidate[:10]}-{candidate[10:]}"
    return candidate if _TAX_CODE_RE.fullmatch(candidate) else None


def organizations_created_per_day():
    try:
        return max(1, int(os.environ.get("ORGANIZATION_CREATE_PER_DAY", "3")))
    except ValueError:
        return 3


def verified_tax_code_holder(cursor, tax_code, *, exclude_organization_id=None):
    """Return the id and name of the organization verified for ``tax_code``."""

    row = cursor.execute(
        """SELECT id, ten_to_chuc FROM to_chuc
            WHERE ma_so_thue = ? AND tax_code_status = 'verified' AND id <> ?
            LIMIT 1""",
        (tax_code, str(exclude_organization_id or "")),
    ).fetchone()
    return (str(row[0]), str(row[1])) if row else None


def is_tax_code_verified(status):
    return str(status or "").strip().lower() == TAX_CODE_VERIFIED
