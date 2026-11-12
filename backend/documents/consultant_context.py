"""ADR 0043: consultant firm (TVL/TVT) roots for package Word exports.

A package's preparation consultant (tư vấn lập) and appraisal consultant
(tư vấn thẩm định) are the contractors of its current linked contracts whose
classification is "Tư vấn" or "Thẩm định".  The classification rule is the one
the Tiến độ tab uses, so documents and the timeline name the same firm.
"""

from __future__ import annotations

from backend.timeline.effective_timeline import consultant_contract_kind


PREPARATION_CONSULTANT_ROOT = "don_vi_tu_van_lap"
APPRAISAL_CONSULTANT_ROOT = "don_vi_tu_van_tham"
CONSULTANT_ROOT_BY_KIND = {
    "preparation": PREPARATION_CONSULTANT_ROOT,
    "appraisal": APPRAISAL_CONSULTANT_ROOT,
}
CONSULTANT_ROOTS = tuple(CONSULTANT_ROOT_BY_KIND.values())

# Contractor columns exposed for a consultant firm.  Bank fields and the seal
# image keep the existing Word capability gates (financial/signature) because
# the projection filters them by field name.
CONSULTANT_FIELDS = (
    "ten_nha_thau",
    "ten_viet_tat",
    "ma_so_thue",
    "nguoi_dai_dien",
    "chuc_vu_dai_dien",
    "danh_xung",
    "dia_chi",
    "so_dien_thoai",
    "email",
    "so_tai_khoan",
    "noi_mo_tai_khoan",
    "ma_ngan_hang",
    "anh_dau",
)


def select_consultant_contracts(contracts):
    """Return ``{root: contract}`` using the first contract of each kind.

    ``contracts`` keeps the loader order (latest version first, then most
    recently signed), which is also the order the Tiến độ tab evaluates.
    """

    selected = {}
    for contract in contracts or ():
        if not isinstance(contract, dict):
            continue
        root = CONSULTANT_ROOT_BY_KIND.get(consultant_contract_kind(contract))
        if root and root not in selected:
            selected[root] = contract
    return selected


def load_consultant_word_context(cursor, organization_id, contracts):
    """Load the consultant firm of each kind with the caller's tenant cursor.

    Every root is always present; it stays empty when the package has no such
    contract or the contractor row is not in the organization.
    """

    values = {root: {} for root in CONSULTANT_ROOTS}
    columns = ", ".join(CONSULTANT_FIELDS)
    for root, contract in select_consultant_contracts(contracts).items():
        contractor_id = str(contract.get("nha_thau_id") or "").strip()
        if not contractor_id:
            continue
        cursor.execute(
            f"SELECT {columns} FROM nha_thau WHERE organization_id = ? AND id = ?",  # noqa: S608 - fixed column allowlist
            (organization_id, contractor_id),
        )
        row = cursor.fetchone()
        if row:
            record = dict(row)
            values[root] = {
                field: record.get(field) for field in CONSULTANT_FIELDS
            }
    return values
