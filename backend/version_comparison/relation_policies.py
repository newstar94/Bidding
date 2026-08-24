"""Business identity policies for cloned aggregate relations."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RelationPolicy:
    path: str
    identity_candidates: tuple[tuple[str, ...], ...]
    ordered: bool = False
    registered: bool = True


RELATION_POLICIES = {
    "hangHoa": RelationPolicy(
        "hangHoa",
        (("maHangHoa",),),
    ),
    "assignments": RelationPolicy(
        "assignments",
        (("empId", "type"), ("idNhanVien", "loaiDoiTuong")),
    ),
    "packages": RelationPolicy(
        "packages",
        (("rootId",), ("maGoiThau",)),
    ),
    "openings": RelationPolicy(
        "openings",
        (("maNhaThau", "maPhanLo"),),
    ),
    "bidderGoods": RelationPolicy(
        "bidderGoods",
        (("maNhaThau", "maHangHoa", "maPhanLo"),),
    ),
    "phanLoList": RelationPolicy("phanLoList", (("maPhanLo",),)),
    "awardedPhanLoList": RelationPolicy("awardedPhanLoList", (("maPhanLo",),)),
    "tuyChonMuaThemList": RelationPolicy("tuyChonMuaThemList", ()),
    "giaHanList": RelationPolicy("giaHanList", (("thoiGianDongThau",),)),
    "yeuCauLamRoList": RelationPolicy("yeuCauLamRoList", ()),
    "traLoiLamRoList": RelationPolicy("traLoiLamRoList", ()),
    "timelineItems": RelationPolicy("timelineItems", (("milestoneKey", "instanceKey"),)),
    "ehsmtAdjustments": RelationPolicy("ehsmtAdjustments", (("sequence",), ("approvalDecisionNumber",))),
    "toChuyenGia": RelationPolicy("toChuyenGia", (("chuyenGiaId",),)),
    "toThamDinh": RelationPolicy("toThamDinh", (("chuyenGiaId",),)),
    "planCompletedWork": RelationPolicy("planCompletedWork", ()),
    "planNotApplicableWork": RelationPolicy("planNotApplicableWork", ()),
    "planPendingWork": RelationPolicy("planPendingWork", ()),
    "danhGiaHsdtMetadata.technical.criteria": RelationPolicy(
        "danhGiaHsdtMetadata.technical.criteria",
        (("maTieuChi",), ("code",)),
        ordered=True,
    ),
    "danhGiaHsdtMetadata.financial.criteria": RelationPolicy(
        "danhGiaHsdtMetadata.financial.criteria",
        (("maTieuChi",), ("code",)),
        ordered=True,
    ),
    "danhGiaHsdtMetadata.criteria": RelationPolicy(
        "danhGiaHsdtMetadata.criteria",
        (("maTieuChi",), ("code",)),
        ordered=True,
    ),
}


def relation_policy(path):
    # Unknown relations are deliberately unmatchable. The diff kernel returns
    # their full authorized rows as ambiguous instead of guessing identity from
    # mutable content, physical IDs, or position.
    return RELATION_POLICIES.get(
        path,
        RelationPolicy(path, (), registered=False),
    )


def business_identity(policy, item):
    for fields in policy.identity_candidates:
        values = tuple(str(item.get(field) or "").strip().casefold() for field in fields)
        if all(values):
            return values, {field: item.get(field) for field in fields}
    return None, None
