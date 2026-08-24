"""Read-only aggregate loader using the canonical visibility predicate."""

from __future__ import annotations

from backend.sync.mapper import attach_child_rows_to_items, map_db_to_json
from backend.sync.queries import get_expert_relations_for_packages
from backend.legal_versioning.repository import LegalVersioningRepository
from backend.version_comparison.errors import VersionComparisonError


ENTITY_TABLES = {
    "kehoach": "ke_hoach_lcnt",
    "goithau": "goi_thau",
}
_MAX_RELATION_ROWS = 5000
_COUNT_CHUNK_SIZE = 500

_PLAN_ATTACHMENT_TABLES = (
    ("ke_hoach_cong_viec", "ke_hoach_id", "", False),
)

_PACKAGE_ATTACHMENT_TABLES = (
    ("goi_thau_phan_lo", "goi_thau_id", " AND archived_at IS NULL", False),
    ("goi_thau_tuy_chon_mua_them", "goi_thau_id", "", False),
    ("goi_thau_gia_han", "goi_thau_id", "", False),
    ("goi_thau_lam_ro", "goi_thau_id", "", False),
    ("goi_thau_moc_tien_do", "goi_thau_id", "", True),
    ("goi_thau_dieu_chinh_hsmt", "goi_thau_id", "", True),
)

_OPENING_ATTACHMENT_TABLES = (
    (
        "thong_tin_mo_thau_lien_danh_thanh_vien",
        "thong_tin_mo_thau_id",
        "",
        False,
    ),
    ("ket_qua_danh_gia_nha_thau", "thong_tin_mo_thau_id", "", False),
)

_RECORD_RELATIONS = {
    "cvDaThucHienList": "planCompletedWork",
    "cvKhongApDungList": "planNotApplicableWork",
    "cvChuaDuDieuKienList": "planPendingWork",
    "phanLoList": "phanLoList",
    "awardedPhanLoList": "awardedPhanLoList",
    "tuyChonMuaThemList": "tuyChonMuaThemList",
    "giaHanList": "giaHanList",
    "yeuCauLamRoList": "yeuCauLamRoList",
    "traLoiLamRoList": "traLoiLamRoList",
    "timelineItems": "timelineItems",
    "ehsmtAdjustments": "ehsmtAdjustments",
    "toChuyenGia": "toChuyenGia",
    "toThamDinh": "toThamDinh",
}


class VersionComparisonReadRepository:
    def __init__(self, cursor, visibility_scope, *, include_legal_binding=False):
        self.cursor = cursor
        self.visibility_scope = visibility_scope
        self.include_legal_binding = bool(include_legal_binding)
        self._relation_rows_loaded = 0

    @staticmethod
    def _row_dict(row):
        return dict(row) if row is not None else None

    def authorize_version(self, entity_type, version_id):
        table_name = ENTITY_TABLES.get(entity_type)
        if table_name is None:
            return None
        predicate = self.visibility_scope.live_predicate(table_name, "version_row")
        row = self.cursor.execute(
            f"""SELECT version_row.* FROM {table_name} AS version_row
                 WHERE {predicate.sql} AND version_row.id = ?
                   AND version_row.archived_at IS NULL
                 LIMIT 1""",  # noqa: S608 - table is a closed registry; predicate is canonical.
            (*predicate.parameters, str(version_id)),
        ).fetchone()
        if row is None:
            return None
        row_dict = self._row_dict(row)
        item = map_db_to_json(table_name, row_dict)
        item["entityType"] = entity_type
        item["organizationId"] = row_dict.get("organization_id")
        return item

    def _mapped_rows(self, table_name, rows):
        return [map_db_to_json(table_name, self._row_dict(row)) for row in rows]

    def _remaining_relation_rows(self):
        return max(0, _MAX_RELATION_ROWS - self._relation_rows_loaded)

    def _reserve_relation_rows(self, count):
        next_total = self._relation_rows_loaded + max(0, int(count))
        if next_total > _MAX_RELATION_ROWS:
            raise VersionComparisonError(
                "VERSION_COMPARISON_RELATION_TOO_LARGE",
                "Aggregate relations exceed the 5,000-row comparison budget.",
                status_code=413,
            )
        self._relation_rows_loaded = next_total

    def _table_exists(self, table_name):
        return self.cursor.execute(
            """SELECT 1 FROM information_schema.tables
                 WHERE table_schema = current_schema() AND table_name = ?""",
            (table_name,),
        ).fetchone() is not None

    def _bounded_child_ids(
        self,
        table_name,
        parent_column,
        parent_ids,
        *,
        extra_where="",
        optional=False,
        select_column="id",
    ):
        if not parent_ids or (optional and not self._table_exists(table_name)):
            return []
        row_ids = []
        for offset in range(0, len(parent_ids), _COUNT_CHUNK_SIZE):
            parent_chunk = parent_ids[offset:offset + _COUNT_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in parent_chunk)
            rows = self.cursor.execute(
                f"""SELECT {select_column} FROM {table_name}
                      WHERE organization_id = ?
                        AND {parent_column} IN ({placeholders}){extra_where}
                      ORDER BY {parent_column}, {select_column} LIMIT ?""",  # noqa: S608 - identifiers and filters are closed constants above.
                (
                    self.visibility_scope.organization_id,
                    *parent_chunk,
                    self._remaining_relation_rows() - len(row_ids) + 1,
                ),
            ).fetchall()
            row_ids.extend(str(row[0]) for row in rows)
            if len(row_ids) > self._remaining_relation_rows():
                self._reserve_relation_rows(len(row_ids))
        self._reserve_relation_rows(len(row_ids))
        return row_ids

    def _preflight_plan_attachments(self, plan_ids):
        for table_name, parent_column, extra_where, optional in _PLAN_ATTACHMENT_TABLES:
            self._bounded_child_ids(
                table_name,
                parent_column,
                plan_ids,
                extra_where=extra_where,
                optional=optional,
            )

    def _preflight_package_attachments(self, package_ids):
        for table_name, parent_column, extra_where, optional in _PACKAGE_ATTACHMENT_TABLES:
            self._bounded_child_ids(
                table_name,
                parent_column,
                package_ids,
                extra_where=extra_where,
                optional=optional,
            )
        self._bounded_child_ids(
            "goi_thau_chuyen_gia",
            "goi_thau_id",
            package_ids,
            select_column="chuyen_gia_id",
        )
        round_ids = self._bounded_child_ids(
            "vong_danh_gia",
            "goi_thau_id",
            package_ids,
        )
        self._bounded_child_ids(
            "tieu_chi_danh_gia",
            "vong_danh_gia_id",
            round_ids,
        )

    def _preflight_opening_attachments(self, opening_ids):
        for table_name, parent_column, extra_where, optional in _OPENING_ATTACHMENT_TABLES:
            self._bounded_child_ids(
                table_name,
                parent_column,
                opening_ids,
                extra_where=extra_where,
                optional=optional,
            )
        report_ids = self._bounded_child_ids(
            "bao_cao_danh_gia_nha_thau",
            "thong_tin_mo_thau_id",
            opening_ids,
        )
        self._bounded_child_ids(
            "chi_tiet_danh_gia_nha_thau",
            "bao_cao_danh_gia_nha_thau_id",
            report_ids,
        )

    def _load_rows(self, table_name, parent_column, parent_ids, *, extra=""):
        if not parent_ids:
            return []
        placeholders = ", ".join("?" for _ in parent_ids)
        predicate = self.visibility_scope.live_predicate(table_name, "relation_row")
        rows = self.cursor.execute(
            f"""SELECT relation_row.* FROM {table_name} AS relation_row
                  WHERE {predicate.sql}
                    AND relation_row.{parent_column} IN ({placeholders}) {extra}
                  ORDER BY relation_row.{parent_column}, relation_row.id LIMIT ?""",  # noqa: S608 - identifiers are internal constants; predicate is canonical.
            (
                *predicate.parameters,
                *parent_ids,
                self._remaining_relation_rows() + 1,
            ),
        ).fetchall()
        if len(rows) > _MAX_RELATION_ROWS:
            raise VersionComparisonError(
                "VERSION_COMPARISON_RELATION_TOO_LARGE",
                "Relation vượt quá giới hạn so sánh trong một yêu cầu.",
                status_code=413,
            )
        self._reserve_relation_rows(len(rows))
        return self._mapped_rows(table_name, rows)

    @staticmethod
    def _extract_record_relations(record):
        relations = {}
        for field, path in _RECORD_RELATIONS.items():
            value = record.pop(field, None)
            if isinstance(value, list):
                relations[path] = value
        return relations

    @staticmethod
    def _group_by(items, key):
        grouped = {}
        for item in items:
            grouped.setdefault(str(item.get(key) or ""), []).append(item)
        return grouped

    def _load_package_snapshot(self, record):
        package_id = str(record["id"])
        package_items = [record]
        self._preflight_package_attachments([package_id])
        attach_child_rows_to_items(
            self.cursor,
            "goi_thau",
            package_items,
            organization_id=self.visibility_scope.organization_id,
        )
        experts = get_expert_relations_for_packages(
            self.cursor,
            [package_id],
            self.visibility_scope.organization_id,
        ).get(package_id, {})
        record["toChuyenGia"] = experts.get("to_cg", [])
        record["toThamDinh"] = experts.get("to_td", [])
        relations = self._extract_record_relations(record)
        lot_codes = {
            str(item.get("id") or ""): item.get("maPhanLo") or item.get("tenPhanLo") or ""
            for item in relations.get("phanLoList", [])
        }
        goods = self._load_rows("goi_thau_hang_hoa", "goi_thau_id", [package_id])
        for item in goods:
            item["maPhanLo"] = lot_codes.get(str(item.get("phanLoId") or ""), "")
        openings = self._load_rows("thong_tin_mo_thau", "goi_thau_id", [package_id])
        self._preflight_opening_attachments([
            str(item.get("id") or "") for item in openings
        ])
        attach_child_rows_to_items(
            self.cursor,
            "thong_tin_mo_thau",
            openings,
            organization_id=self.visibility_scope.organization_id,
        )
        for item in openings:
            item["maPhanLo"] = lot_codes.get(str(item.get("phanLoId") or ""), "")
        goods_by_id = {str(item.get("id") or ""): item for item in goods}
        openings_by_id = {str(item.get("id") or ""): item for item in openings}
        bidder_goods = self._load_rows("hang_hoa_du_thau_nha_thau", "goi_thau_id", [package_id])
        for item in bidder_goods:
            opening = openings_by_id.get(str(item.get("thongTinMoThauId") or ""), {})
            requirement = goods_by_id.get(str(item.get("goiThauHangHoaId") or ""), {})
            item["maNhaThau"] = opening.get("maNhaThau") or ""
            item["tenNhaThau"] = opening.get("tenNhaThau") or ""
            item["maHangHoa"] = requirement.get("maHangHoa") or ""
            item["maPhanLo"] = requirement.get("maPhanLo") or opening.get("maPhanLo") or ""
        relations.update({
            "hangHoa": goods,
            "openings": openings,
            "bidderGoods": bidder_goods,
            "assignments": self._load_rows(
                "phan_cong_nhan_su",
                "id_muc_tieu",
                [package_id],
                extra="AND relation_row.loai_doi_tuong = 'goithau'",
            ),
        })
        plan = None
        plan_id = str(record.get("keHoachId") or "")
        if plan_id:
            plan_predicate = self.visibility_scope.live_predicate(
                "ke_hoach_lcnt", "plan_row"
            )
            plan_row = self.cursor.execute(
                f"""SELECT plan_row.* FROM ke_hoach_lcnt AS plan_row
                    WHERE {plan_predicate.sql}
                      AND plan_row.id = ? AND plan_row.archived_at IS NULL""",  # noqa: S608 - predicate is canonical.
                (*plan_predicate.parameters, plan_id),
            ).fetchone()
            if plan_row is not None:
                plan = map_db_to_json("ke_hoach_lcnt", self._row_dict(plan_row))
        return {"record": record, "relations": relations, "context": {"plan": plan or {}}}

    def _load_plan_snapshot(self, record):
        plan_id = str(record["id"])
        self._preflight_plan_attachments([plan_id])
        attach_child_rows_to_items(
            self.cursor,
            "ke_hoach_lcnt",
            [record],
            organization_id=self.visibility_scope.organization_id,
        )
        relations = self._extract_record_relations(record)
        package_predicate = self.visibility_scope.live_predicate("goi_thau", "package_row")
        package_rows = self.cursor.execute(
            f"""SELECT package_row.* FROM goi_thau AS package_row
                 WHERE {package_predicate.sql}
                   AND package_row.ke_hoach_id = ?
                   AND package_row.archived_at IS NULL
                 ORDER BY package_row.id LIMIT ?""",  # noqa: S608 - predicate is canonical.
            (*package_predicate.parameters, plan_id, _MAX_RELATION_ROWS + 1),
        ).fetchall()
        if len(package_rows) > _MAX_RELATION_ROWS:
            raise VersionComparisonError(
                "VERSION_COMPARISON_RELATION_TOO_LARGE",
                "Số gói thầu trong snapshot vượt quá giới hạn so sánh.",
                status_code=413,
            )
        self._reserve_relation_rows(len(package_rows))
        packages = self._mapped_rows("goi_thau", package_rows)
        package_ids = [str(package.get("id") or "") for package in packages]
        self._preflight_package_attachments(package_ids)
        attach_child_rows_to_items(
            self.cursor,
            "goi_thau",
            packages,
            organization_id=self.visibility_scope.organization_id,
        )
        expert_relations = get_expert_relations_for_packages(
            self.cursor,
            package_ids,
            self.visibility_scope.organization_id,
        )
        goods = self._load_rows("goi_thau_hang_hoa", "goi_thau_id", package_ids)
        openings = self._load_rows("thong_tin_mo_thau", "goi_thau_id", package_ids)
        self._preflight_opening_attachments([
            str(item.get("id") or "") for item in openings
        ])
        attach_child_rows_to_items(
            self.cursor,
            "thong_tin_mo_thau",
            openings,
            organization_id=self.visibility_scope.organization_id,
        )
        bidder_goods = self._load_rows(
            "hang_hoa_du_thau_nha_thau", "goi_thau_id", package_ids
        )
        package_assignments = self._load_rows(
            "phan_cong_nhan_su",
            "id_muc_tieu",
            package_ids,
            extra="AND relation_row.loai_doi_tuong = 'goithau'",
        )
        lot_codes = {
            str(lot.get("id") or ""): lot.get("maPhanLo") or lot.get("tenPhanLo") or ""
            for package in packages
            for lot in package.get("phanLoList") or []
        }
        for item in goods:
            item["maPhanLo"] = lot_codes.get(str(item.get("phanLoId") or ""), "")
        for item in openings:
            item["maPhanLo"] = lot_codes.get(str(item.get("phanLoId") or ""), "")
        goods_by_id = {str(item.get("id") or ""): item for item in goods}
        openings_by_id = {str(item.get("id") or ""): item for item in openings}
        for item in bidder_goods:
            opening = openings_by_id.get(str(item.get("thongTinMoThauId") or ""), {})
            requirement = goods_by_id.get(str(item.get("goiThauHangHoaId") or ""), {})
            item["maNhaThau"] = opening.get("maNhaThau") or ""
            item["tenNhaThau"] = opening.get("tenNhaThau") or ""
            item["maHangHoa"] = requirement.get("maHangHoa") or ""
            item["maPhanLo"] = requirement.get("maPhanLo") or opening.get("maPhanLo") or ""
        goods_by_package = self._group_by(goods, "goiThauId")
        openings_by_package = self._group_by(openings, "goiThauId")
        bidder_goods_by_package = self._group_by(bidder_goods, "goiThauId")
        assignments_by_package = self._group_by(package_assignments, "targetId")
        for package in packages:
            package_id = str(package.get("id") or "")
            experts = expert_relations.get(package_id, {})
            package["toChuyenGia"] = experts.get("to_cg", [])
            package["toThamDinh"] = experts.get("to_td", [])
            package["hangHoa"] = sorted(
                goods_by_package.get(package_id, []),
                key=lambda item: (
                    str(item.get("maPhanLo") or ""),
                    str(item.get("maHangHoa") or item.get("tenHangHoa") or ""),
                ),
            )
            package["openings"] = sorted(
                openings_by_package.get(package_id, []),
                key=lambda item: (
                    str(item.get("maPhanLo") or ""),
                    str(item.get("maNhaThau") or item.get("tenNhaThau") or ""),
                ),
            )
            package["bidderGoods"] = sorted(
                bidder_goods_by_package.get(package_id, []),
                key=lambda item: (
                    str(item.get("maPhanLo") or ""),
                    str(item.get("maNhaThau") or item.get("tenNhaThau") or ""),
                    str(item.get("maHangHoa") or ""),
                ),
            )
            package["assignments"] = sorted(
                assignments_by_package.get(package_id, []),
                key=lambda item: (str(item.get("type") or ""), str(item.get("empId") or "")),
            )
        relations["packages"] = packages
        relations["assignments"] = self._load_rows(
            "phan_cong_nhan_su",
            "id_muc_tieu",
            [plan_id],
            extra="AND relation_row.loai_doi_tuong = 'kehoach'",
        )
        return {"record": record, "relations": relations, "context": {"packages": packages}}

    def _generated_documents(self, record_id):
        rows = self.cursor.execute(
            """SELECT artifact_id, template_version_id, template_sha256,
                      record_row_version, artifact_sha256, created_at
                 FROM generated_document_provenance
                WHERE organization_id = ? AND record_id = ?
                ORDER BY created_at, id LIMIT 500""",
            (self.visibility_scope.organization_id, record_id),
        ).fetchall()
        return [{
            "artifactId": row[0], "templateVersionId": row[1],
            "templateSha256": row[2], "recordRowVersion": row[3],
            "artifactSha256": row[4], "createdAt": row[5],
        } for row in rows]

    def load_snapshot(self, entity_type, authorized_record):
        self._relation_rows_loaded = 0
        record = dict(authorized_record)
        if entity_type == "goithau":
            snapshot = {"entityType": entity_type, **self._load_package_snapshot(record)}
            target_type = "package"
        elif entity_type == "kehoach":
            snapshot = {"entityType": entity_type, **self._load_plan_snapshot(record)}
            target_type = "plan"
        else:
            raise ValueError("Unsupported comparison entity type")
        if self.include_legal_binding:
            snapshot.setdefault("context", {})["legalBinding"] = (
                LegalVersioningRepository(self.cursor).get_binding(
                    self.visibility_scope.organization_id,
                    target_type,
                    str(record.get("id") or ""),
                )
            )
        snapshot.setdefault("context", {})["generatedDocuments"] = (
            self._generated_documents(str(record.get("id") or ""))
        )
        return snapshot
