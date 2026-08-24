"""Stable comparison paths and technical-field exclusions."""

TECHNICAL_FIELDS = frozenset({
    "id",
    "rootId",
    "phienBan",
    "isLatest",
    "rowVersion",
    "expectedVersion",
    "syncVersion",
    "organizationId",
    "entityType",
    "ownerType",
    "archivedAt",
    "allVersions",
    "referenceOnly",
    "createdAt",
    "updatedAt",
})

LABEL_KEYS = {
    "thoiGianDongThau": "package.bidClosingTime",
    "giaGoiThau": "package.price",
    "trangThai": "package.status",
    "maGoiThau": "package.code",
    "tenGoiThau": "package.name",
    "maKeHoach": "plan.code",
    "tenKeHoach": "plan.name",
}

# Unknown strings stay strings. Date/time normalization is opt-in so arbitrary
# business text is never reinterpreted by a heuristic parser.
DATE_TIME_FIELDS = frozenset({
    "createdAt",
    "updatedAt",
    "archivedAt",
    "thoiGian",
    "thoiGianDongThau",
    "thoiGianMoThau",
    "thoiGianBatDauToChuc",
    "thoiGianToChuc",
    "hoanThanhLuc",
})

DATE_FIELDS = frozenset({
    "ngayBaoCao",
    "ngayPheDuyet",
    "ngayQuyetDinh",
})


def label_key(path):
    return LABEL_KEYS.get(path, f"business.{path}")


def comparison_type(path):
    leaf = str(path or "").rsplit(".", 1)[-1]
    if leaf in DATE_TIME_FIELDS:
        return "DATETIME"
    if leaf in DATE_FIELDS:
        return "DATE"
    return "AUTO"
