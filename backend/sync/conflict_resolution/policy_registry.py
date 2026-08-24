"""Closed v1 registry for fields that may participate in conflict resolution."""

from __future__ import annotations

from dataclasses import dataclass


POLICY_VERSION = "conflict-scalar-v1"


@dataclass(frozen=True, slots=True)
class ConflictPolicy:
    entity_type: str
    table_name: str
    payload_key: str
    scalar_fields: frozenset[str]
    explicit_choice_fields: frozenset[str]


_PLAN_FIELDS = frozenset({
    "tenKeHoach", "tenDuAnDuToan", "loaiHinhMuaSam", "donViTrinhCdt",
    "tenVietTatDonViTrinh", "tongMucDauTu", "isTongMucTuDong",
    "ngayPheDuyet", "quyetDinhPheDuyet", "thoiGianDangMa", "nguonVon",
    "thoiGianDuAn", "diaDiemQuyMo", "thongTinKhac", "soQdPheDuyetDuAn",
    "ngayQdPheDuyetDuAn", "coQuanPheDuyetDuAn", "pheDuyet",
    "soToTrinhDuToan", "ngayTrinhDuToan", "ngayPheDuyetDuToan",
    "soQdPheDuyetDuToan", "soToTrinhKeHoach", "soToTrinhDuToanKeHoach",
    "ngayTrinhKeHoach",
})

_PACKAGE_FIELDS = frozenset({
    "tenGoiThau", "giaGoiThau", "loaiHopDong", "hinhThucLuaChon",
    "phuongThucLuaChon", "quaMang", "trongNuocQuocTe", "thoiGianThucHien",
    "nguonVon", "giaTrungThau", "linhVuc", "tuyChonMuaThem",
    "thoiGianToChuc", "thoiGianBatDauToChuc", "phanLo", "thoiGianDangTai",
    "thoiGianDongThau", "thoiGianMoThau", "thoiGianMoEhsdxtc",
    "soQuyetDinh", "ngayQuyetDinh", "soQuyetDinhKetQua",
    "ngayQuyetDinhKetQua", "thoiGianGoiThau", "thoiGianHopDong",
    "giaTriDamBaoDuThau", "hieuLucHsdt", "hieuLucDamBaoDuThau",
    "phuongPhapDanhGia", "trongSoKyThuat", "tyLeBaoDamHopDong", "isThuoc",
    "yeuCauThamDinhHsmt", "yeuCauThamDinhHsmtCode",
    "soBaoCaoThamDinhHsmt", "ngayBaoCaoThamDinhHsmt", "soToTrinhHsmt",
    "ngayTrinhHsmt",
})

# Monetary/identifier-adjacent values remain fully visible after authorization,
# but the server never preselects them for the actor.
_PLAN_EXPLICIT = frozenset({"tongMucDauTu", "quyetDinhPheDuyet", "soQdPheDuyetDuAn", "soQdPheDuyetDuToan"})
_PACKAGE_EXPLICIT = frozenset({
    "giaGoiThau", "giaTrungThau", "giaTriDamBaoDuThau", "soQuyetDinh",
    "soQuyetDinhKetQua", "soBaoCaoThamDinhHsmt", "soToTrinhHsmt",
})

_REGISTRY = {
    "kehoach": ConflictPolicy("kehoach", "ke_hoach_lcnt", "kehoach", _PLAN_FIELDS, _PLAN_EXPLICIT),
    "goithau": ConflictPolicy("goithau", "goi_thau", "goithau", _PACKAGE_FIELDS, _PACKAGE_EXPLICIT),
}


def get_conflict_policy(entity_type: str) -> ConflictPolicy | None:
    return _REGISTRY.get(str(entity_type or "").strip().casefold())
