import json
import re

import pytest

from backend.sync import mapper


class RecordingCursor:
    def __init__(
        self,
        datasets=None,
        *,
        stored_bid=("package-1", "contractor-1", " L1 ", "Liên danh"),
        expert_exists=True,
        table_exists=True,
    ):
        self.datasets = datasets or {}
        self.stored_bid = stored_bid
        self.expert_exists = expert_exists
        self.table_exists = table_exists
        self.calls = []
        self.many_calls = []
        self.last_sql = ""
        self.last_params = ()

    def execute(self, sql, params=()):
        self.last_sql = " ".join(str(sql).split())
        self.last_params = tuple(params)
        self.calls.append((self.last_sql, self.last_params))
        return self

    def executemany(self, sql, rows):
        normalized = " ".join(str(sql).split())
        values = list(rows)
        self.many_calls.append((normalized, values))
        return self

    def fetchone(self):
        if "FROM chuyen_gia" in self.last_sql:
            return (1,) if self.expert_exists else None
        if "SELECT id FROM chi_tiet_danh_gia_nha_thau" in self.last_sql:
            return self.datasets.get("detail_lookup")
        if "FROM vong_danh_gia" in self.last_sql:
            round_lookups = self.datasets.get("round_lookups")
            if isinstance(round_lookups, dict):
                return round_lookups.get(self.last_params[-1])
            return self.datasets.get("round_lookup")
        if "FROM tieu_chi_danh_gia" in self.last_sql:
            criterion_lookups = self.datasets.get("criterion_lookups")
            if isinstance(criterion_lookups, dict):
                return criterion_lookups.get(self.last_params[-1])
            return self.datasets.get("criterion_lookup")
        if "FROM thong_tin_mo_thau" in self.last_sql:
            return self.stored_bid
        if "FROM information_schema.tables" in self.last_sql:
            return (1,) if self.table_exists else None
        return None

    def fetchall(self):
        if "SELECT ma_phan_lo FROM goi_thau_phan_lo" in self.last_sql:
            return [
                (row.get("ma_phan_lo"),)
                for row in self.datasets.get("goi_thau_phan_lo", [])
            ]
        if "SELECT id, COALESCE(NULLIF(id_goc, ''), id) FROM nha_thau" in self.last_sql:
            return list(self.datasets.get("contractor_roots", []))
        if (
            "SELECT thanh_vien_nha_thau_id" in self.last_sql
            and "thong_tin_mo_thau_lien_danh_thanh_vien" in self.last_sql
        ):
            return list(self.datasets.get("opening_member_ids", []))
        match = re.search(r"\bFROM\s+([a-z_]+)", self.last_sql, flags=re.IGNORECASE)
        if match:
            return list(self.datasets.get(match.group(1), []))
        return []


def _many_rows(cursor, table):
    return next(
        rows
        for sql, rows in cursor.many_calls
        if f"INSERT INTO {table}" in sql
    )


def test_mapper_key_resolution_canonicalization_and_db_serialization(monkeypatch):
    assert mapper.json_key_for_column("goi_thau", "id_goc") == "rootId"
    assert mapper.db_column_for_json_key("goi_thau", "maGoiThau") == "ma_goi_thau"
    assert mapper.db_column_for_json_key("unknown", "unsafeCamel") == "unsafe_camel"
    assert mapper.get_payload_value(
        "goi_thau", {"maGoiThau": "GT-01"}, "ma_goi_thau"
    ) == "GT-01"
    assert mapper.canonicalize_payload_item("goi_thau", None) == {}

    normalized = mapper.canonicalize_payload_item(
        "goi_thau",
        {
            "ma_goi_thau": "  gt / 01 ",
            "hinhThucLuaChon": " Chào hàng cạnh tranh ",
            "danhGiaHsdtMetadata": json.dumps(
                {
                    "technical": {
                        "soBctdKt": "secret",
                        "ngayBctdKt": "2026-01-01",
                        "keep": True,
                    },
                    "result": {
                        "soBctdKetQua": "secret",
                        "ngayBctdKetQua": "2026-01-02",
                    },
                }
            ),
            "clientOnly": "preserved",
        },
    )
    metadata = json.loads(normalized["danhGiaHsdtMetadata"])
    assert normalized["maGoiThau"] == "GT / 01"
    assert normalized["yeuCauThamDinhHsmt"] == "Không"
    assert normalized["toThamDinh"] == []
    assert metadata["technical"] == {"keep": True}
    assert metadata["result"] == {}
    assert normalized["clientOnly"] == "preserved"

    malformed = mapper.canonicalize_payload_item(
        "goi_thau",
        {
            "hinhThucLuaChon": "chào hàng cạnh tranh",
            "danhGiaHsdtMetadata": "{broken",
        },
    )
    assert malformed["danhGiaHsdtMetadata"] == "{broken"

    investor = mapper.canonicalize_payload_item(
        "chu_dau_tu",
        {
            "maChuDauTu": " cdt 01 ",
            "maSoThue": " 031-234 ",
            "tenChuDauTu": "  công ty   á châu ",
        },
    )
    assert investor["maChuDauTu"] == "CDT 01"
    assert investor["maSoThue"] == "031-234"
    assert investor["tenChuDauTu"] == "Công ty á châu"

    item = mapper.map_db_to_json(
        "chu_dau_tu",
        {
            "id": "investor-1",
            "ten_chu_dau_tu": "  công ty   á châu ",
            "dai_dien_cdt": "  nguyễn   văn a ",
        },
    )
    assert item["id"] == "investor-1"
    assert item["tenChuDauTu"] == "Công ty á châu"
    assert item["daiDienCdt"] == "Nguyễn Văn A"

    package = mapper.map_db_to_json(
        "goi_thau",
        {
            "id": "package-1",
            "gia_goi_thau": "123456",
        },
    )
    assert package["giaGoiThau"] == "123456"

    monkeypatch.setitem(
        mapper.SCHEMA_DINH_NGHIA,
        "json_test",
        {
            "columns": {"id": "TEXT", "payload_list": "TEXT"},
            "json_fields": ["payload_list"],
        },
    )
    assert mapper.map_db_to_json(
        "json_test", {"id": "1", "payload_list": '[{"safe":true}]'}
    )["payloadList"] == [{"safe": True}]
    assert mapper.map_db_to_json(
        "json_test", {"id": "1", "payload_list": "{broken"}
    )["payloadList"] == []
    assert mapper.map_db_to_json(
        "json_test", {"id": "1", "payload_list": ""}
    )["payloadList"] == []


def test_child_value_helpers_are_strict_and_deduplicate():
    assert mapper._parse_child_list(None) == []
    assert mapper._parse_child_list([{"id": "1"}, "bad"]) == [{"id": "1"}]
    assert mapper._parse_child_list('[{"id":"1"},2]') == [{"id": "1"}]
    assert mapper._parse_child_list("{bad") == []
    assert mapper._parse_child_list(1) == []
    assert mapper._dedupe_child_items(
        [{"id": "a"}, {"id": "a"}, {"id": ""}, {"id": "b"}],
        lambda item: item["id"],
    ) == [{"id": "a"}, {"id": "b"}]
    assert mapper._first_value({"snake": 0}, "camel", "snake", default=1) == 0
    assert mapper._first_value({}, "missing", default="fallback") == "fallback"
    assert mapper._child_number("not-number") == 0
    assert mapper._child_money("not-money") == 0


def test_save_plan_and_complete_package_children():
    cursor = RecordingCursor()
    mapper.save_child_payloads(
        cursor,
        "ke_hoach_lcnt",
        {
            "id": "plan-1",
            "cvDaThucHienList": [
                {
                    "id": "work-1",
                    "tenCongViec": "Công việc",
                    "giaTri": "1500000",
                    "donViThucHien": "Đơn vị",
                    "vanBanPheDuyet": "VB-1",
                }
            ],
            "cvKhongApDungList": "[]",
        },
        "org-1",
        "organization",
        3,
        "2026-07-19",
    )
    plan_rows = _many_rows(cursor, "ke_hoach_cong_viec")
    assert len(plan_rows) == 1
    assert plan_rows[0][0] == "work-1"
    assert plan_rows[0][6] == 1_500_000

    package = {
        "id": "package-1",
        "phanLoList": [
            {
                "id": "lot-1",
                "maPhanLo": "L1",
                "tenPhanLo": "Lô 1",
                "giaTriPhanLo": "2000000",
                "baoDamDuThau": "100000",
            }
        ],
        "awardedPhanLoList": [
            {
                "maPhanLo": "L1",
                "nhaThauTrungThauId": "contractor-1",
                "giaTrungThau": "1900000",
            },
            {
                "maPhanLo": "L2",
                "tenPhanLo": "Lô 2",
                "nhaThauTrungThauId": "contractor-2",
            },
        ],
        "tuyChonMuaThemList": [
            {
                "id": "option-1",
                "hangMuc": "Hạng mục",
                "donVi": "cái",
                "soLuong": "2",
                "tyLe": "10.5",
                "giaTriUocTinh": "500000",
            }
        ],
        "giaHanList": [
            {"thoiGianDongThau": "2026-07-20 10:00", "lyDoGiaHan": "A"},
            {"thoiGianDongThau": " 2026-07-20 10:00 ", "lyDoGiaHan": " a "},
        ],
        "yeuCauLamRoList": [
            {
                "thoiGianYeuCau": "2026-07-20 11:00",
                "noiDungYeuCau": "Làm rõ",
            }
        ],
        "traLoiLamRoList": [
            {
                "thoiGianTraLoi": "2026-07-20 12:00",
                "noiDungTraLoi": "Trả lời",
            }
        ],
        "timelineItems": [
            {
                "id": "timeline-1",
                "maNhom": "PREP",
                "tenNhom": "Chuẩn bị",
                "maMoc": "M1",
                "congViec": "Công việc",
                "isOptional": "1",
                "sortOrder": 2,
                "templateVersion": 3,
            }
        ],
        "toChuyenGia": [
            {
                "chuyenGiaId": "expert-1",
                "chucVu": "Tổ trưởng",
                "congViec": "Đánh giá",
            }
        ],
        "toThamDinh": [],
        "danhGiaHsdtMetadata": {
            "is1G2T": True,
            "resultEdit": {"type": "whole"},
            "technical": {
                "saved": True,
                "qualifiedSaved": True,
                "soBaoCao": "BC-1",
                "criteria": [
                    "bad",
                    {"code": "", "name": "missing"},
                    {
                        "id": "criterion-1",
                        "code": "TC-1",
                        "name": "Kỹ thuật",
                        "maxScore": "100",
                        "weight": "0.7",
                        "group": "technical",
                        "resultType": "score",
                        "required": True,
                        "parentCriterionId": None,
                        "extension": "kept",
                    },
                ],
            },
            "financial": {"saved": False, "criteria": []},
        },
    }
    mapper.save_child_payloads(
        cursor,
        "goi_thau",
        package,
        "org-1",
        "organization",
        4,
        "2026-07-19",
        actor_user_id="user-1",
    )

    lots = _many_rows(cursor, "goi_thau_phan_lo")
    assert len(lots) == 2
    assert lots[0][9] == "contractor-1"
    assert lots[0][10] == 1_900_000
    assert len(_many_rows(cursor, "goi_thau_tuy_chon_mua_them")) == 1
    assert len(_many_rows(cursor, "goi_thau_gia_han")) == 1
    assert len(_many_rows(cursor, "goi_thau_lam_ro")) == 2
    assert len(_many_rows(cursor, "goi_thau_moc_tien_do")) == 1
    assert len(_many_rows(cursor, "goi_thau_chuyen_gia")) == 1
    evaluation_round_params = [
        params
        for sql, params in cursor.calls
        if "INSERT INTO vong_danh_gia" in sql
    ]
    assert len(evaluation_round_params) == 2
    assert all(params[8] is None for params in evaluation_round_params)
    technical_round = next(params for params in evaluation_round_params if params[4] == "technical")
    assert json.loads(technical_round[12])["resultEdit"] == {"type": "whole"}
    criterion_params = next(
        params
        for sql, params in cursor.calls
        if "INSERT INTO tieu_chi_danh_gia" in sql
    )
    assert criterion_params[8:12] == ("technical", "score", 1, None)


def _save_detailed_report(cursor, report, *, organization_id="org-1"):
    mapper.save_child_payloads(
        cursor,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "baoCaoDanhGiaChiTietList": [report],
        },
        organization_id,
        "organization",
        5,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )


def test_save_lots_preserves_existing_identity_and_archives_removed_rows():
    cursor = RecordingCursor(
        {
            "goi_thau_phan_lo": [
                {"id": "stable-lot-a", "ma_phan_lo": "A"},
                {"id": "stable-lot-b", "ma_phan_lo": "B"},
                {"id": "removed-lot-c", "ma_phan_lo": "C"},
            ]
        }
    )

    mapper._save_lots(
        cursor,
        "package-1",
        [
            {"maPhanLo": "B", "tenPhanLo": "Lô B"},
            {"maPhanLo": "A", "tenPhanLo": "Lô A"},
        ],
        [],
        "org-1",
        "organization",
        5,
        "2026-07-22",
    )

    rows = _many_rows(cursor, "goi_thau_phan_lo")
    assert [row[0] for row in rows] == ["stable-lot-b", "stable-lot-a"]
    assert not any(
        sql.startswith("DELETE FROM goi_thau_phan_lo")
        for sql, _ in cursor.calls
    )
    archive_call = next(
        (sql, params)
        for sql, params in cursor.calls
        if sql.startswith("UPDATE goi_thau_phan_lo SET archived_at")
    )
    assert "id NOT IN (?, ?)" in archive_call[0]
    assert archive_call[1][-2:] == ("stable-lot-b", "stable-lot-a")


def test_save_members_opening_registry_and_bid_evaluation():
    datasets = {
        "contractor_roots": [
            ("contractor-v2", "contractor-root"),
            ("missing-root", ""),
        ]
    }
    cursor = RecordingCursor(datasets)
    member = {
        "id": "member-1",
        "thanhVienNhaThauId": "contractor-v2",
        "tenNhaThau": "Nhà thầu",
        "maNhaThau": "NT-1",
        "maSoThue": "0123",
        "vaiTro": "Đứng đầu",
        "nguoiDaiDien": "  nguyễn văn a ",
        "email": "owner@example.test",
    }
    mapper.save_child_payloads(
        cursor,
        "nha_thau",
        {"id": "joint-venture-1", "thanhVienLienDanh": [member]},
        "org-1",
        "organization",
        1,
        "2026-07-19",
    )
    assert _many_rows(cursor, "nha_thau_lien_danh_thanh_vien")[0][9] == "Nguyễn Văn A"

    mapper.save_child_payloads(
        cursor,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "thanhVienLienDanh": [member, member],
            "danhGiaHopLe": "Đạt",
            "danhGiaKetLuan": "Đạt",
            "diemDanhGia": "95.5",
            "nguyenNhanKhongDatHopLe": "Không có",
        },
        "org-1",
        "organization",
        2,
        "2026-07-19",
        actor_user_id="reviewer-1",
    )

    registry_rows = _many_rows(cursor, "nha_thau_tham_du_mo_thau")
    assert len(registry_rows) == 1
    assert registry_rows[0][4:8] == (
        "package-1",
        "l1",
        "contractor-root",
        "contractor-v2",
    )
    evaluation = next(
        params
        for sql, params in cursor.calls
        if "INSERT INTO ket_qua_danh_gia_nha_thau" in sql
    )
    assert evaluation[10] == 95.5
    assert evaluation[11] == "Không có"


def test_expert_relation_and_registry_reject_invalid_or_missing_references():
    cursor = RecordingCursor(expert_exists=False)
    with pytest.raises(ValueError, match="khong thuoc owner"):
        mapper._save_package_expert_relations(
            cursor,
            "package-1",
            {"toChuyenGia": [{"chuyenGiaId": "cross-tenant-expert"}]},
            "org-1",
            "organization",
        )

    cursor = RecordingCursor(stored_bid=None)
    mapper._save_opening_participant_registry(
        cursor, "opening-1", {}, "org-1", "organization"
    )
    assert not cursor.many_calls

    cursor = RecordingCursor(
        {"opening_member_ids": [("",)]},
        stored_bid=("package-1", None, None, "Liên danh"),
    )
    mapper._save_opening_participant_registry(
        cursor, "opening-1", {}, "org-1", "organization"
    )
    assert not cursor.many_calls


def test_attach_plan_package_and_evaluation_children_in_both_namings():
    datasets = {
        "ke_hoach_cong_viec": [
            {
                "id": "work-1",
                "ke_hoach_id": "plan-1",
                "loai": "da_thuc_hien",
                "ten_cong_viec": "Công việc",
                "gia_tri": 100,
                "don_vi_thuc_hien": "Đơn vị",
                "van_ban_phe_duyet": "VB",
            },
            {
                "id": "ignored",
                "ke_hoach_id": "other",
                "loai": "unknown",
            },
        ],
        "goi_thau_phan_lo": [
            {
                "id": "lot-1",
                "goi_thau_id": "package-1",
                "ma_phan_lo": "L1",
                "ten_phan_lo": "Lô 1",
                "gia_tri_phan_lo": 1000,
                "gia_trung_thau": 900,
            }
        ],
        "goi_thau_tuy_chon_mua_them": [
            {
                "id": "option-1",
                "goi_thau_id": "package-1",
                "hang_muc": "Mục",
                "so_luong": 2,
            }
        ],
        "goi_thau_gia_han": [
            {
                "id": "extension-1",
                "goi_thau_id": "package-1",
                "thoi_gian_dong_thau": "2026-07-20",
                "ly_do_gia_han": "Lý do",
            }
        ],
        "goi_thau_lam_ro": [
            {
                "id": "request-1",
                "goi_thau_id": "package-1",
                "loai": "yeu_cau",
                "thoi_gian": "2026-07-20",
                "noi_dung": "Yêu cầu",
            },
            {
                "id": "reply-1",
                "goi_thau_id": "package-1",
                "loai": "tra_loi",
                "thoi_gian": "2026-07-21",
                "noi_dung": "Trả lời",
            },
        ],
        "goi_thau_moc_tien_do": [
            {
                "id": "timeline-1",
                "goi_thau_id": "package-1",
                "ma_nhom": "PREP",
                "is_optional": 1,
                "sort_order": 2,
                "template_version": 3,
            }
        ],
        "vong_danh_gia": [
            {
                "id": "round-tech",
                "goi_thau_id": "package-1",
                "loai_vong": "technical",
                "trang_thai": "completed",
                "da_luu_danh_sach_dat": 1,
                "so_bao_cao": "BC",
                "ngay_bao_cao": "2026-07-19",
                "extension_json": '{"schemaVersion":1,"note":"kept","resultEdit":{"type":"whole"}}',
            },
            {
                "id": "round-fin",
                "goi_thau_id": "package-1",
                "loai_vong": "financial",
                "trang_thai": "draft",
                "extension_json": "{broken",
            },
        ],
        "tieu_chi_danh_gia": [
            {
                "id": "criterion-1",
                "vong_danh_gia_id": "round-tech",
                "ma_tieu_chi": "TC-1",
                "ten_tieu_chi": "Kỹ thuật",
                "diem_toi_da": 100,
                "trong_so": 1,
                "nhom_danh_gia": "technical",
                "loai_ket_qua": "score",
                "bat_buoc": 1,
                "tieu_chi_cha_id": None,
                "extension_json": json.dumps({
                    "schemaVersion": 1,
                    "stt": "3.1",
                    "sourceStt": "3.1",
                    "source": "muasamcong",
                    "isSection": True,
                    "requirement": "YÃªu cáº§u tá»« E-HSMT",
                }),
            }
        ],
    }
    cursor = RecordingCursor(datasets)
    plan = {"id": "plan-1"}
    assert mapper.attach_child_rows(
        cursor, "ke_hoach_lcnt", plan, organization_id="org-1"
    ) is plan
    assert plan["cvDaThucHienList"][0]["giaTri"] == "100"

    package = {"id": "package-1", "danhGiaHsdtMetadata": "{}"}
    mapper.attach_child_rows(
        cursor, "goi_thau", package, organization_id="org-1", naming="camel"
    )
    assert package["phanLoList"][0]["maPhanLo"] == "L1"
    assert package["awardedPhanLoList"][0]["giaTrungThau"] == "900"
    assert package["timelineItems"][0]["isOptional"] is True
    metadata = json.loads(package["danhGiaHsdtMetadata"])
    assert metadata["is1G2T"] is True
    assert metadata["technical"]["criteria"][0]["code"] == "TC-1"
    assert metadata["technical"]["criteria"][0]["group"] == "technical"
    assert metadata["technical"]["criteria"][0]["resultType"] == "score"
    assert metadata["technical"]["criteria"][0]["required"] is True
    assert metadata["technical"]["criteria"][0]["stt"] == "3.1"
    assert metadata["technical"]["criteria"][0]["sourceStt"] == "3.1"
    assert metadata["technical"]["criteria"][0]["source"] == "muasamcong"
    assert metadata["technical"]["criteria"][0]["isSection"] is True
    assert metadata["technical"]["criteria"][0]["requirement"] == "YÃªu cáº§u tá»« E-HSMT"
    assert metadata["resultEdit"] == {"type": "whole"}
    assert metadata["financial"]["schemaVersion"] == 1

    snake = {"id": "package-1", "danh_gia_hsdt_metadata": "{}"}
    mapper.attach_child_rows(
        cursor, "goi_thau", snake, organization_id=None, naming="snake"
    )
    assert snake["phan_lo_list"][0]["ma_phan_lo"] == "L1"
    assert snake["yeu_cau_lam_ro_list"][0]["noi_dung_yeu_cau"] == "Yêu cầu"


def test_attach_opening_members_evaluation_and_versioned_contractor_details():
    datasets = {
        "thong_tin_mo_thau_lien_danh_thanh_vien": [
            {
                "id": "member-1",
                "thong_tin_mo_thau_id": "opening-1",
                "thanh_vien_nha_thau_id": "contractor-v2",
                "ten_nha_thau": "stale",
                "nguoi_dai_dien": "stale",
            }
        ],
        "ket_qua_danh_gia_nha_thau": [
            {
                "id": "evaluation-1",
                "thong_tin_mo_thau_id": "opening-1",
                "danh_gia_hop_le": "Đạt",
                "diem": 98,
            },
            {
                "id": "orphan",
                "thong_tin_mo_thau_id": "other",
            },
        ],
        "nha_thau": [
            {
                "id": "contractor-v2",
                "ten_nha_thau": "  công ty   mới ",
                "ma_nha_thau": "NT-2",
                "ma_so_thue": "0123",
                "nguoi_dai_dien": " nguyễn văn b ",
                "email": "owner@example.test",
            }
        ],
    }
    cursor = RecordingCursor(datasets)
    opening = {
        "id": "opening-1",
        "nhaThauId": "contractor-v2",
        "loaiNhaThau": "Độc lập",
    }
    mapper.attach_child_rows(
        cursor,
        "thong_tin_mo_thau",
        opening,
        organization_id="org-1",
    )

    assert opening["tenNhaThau"] == "Công ty mới"
    assert opening["danhGiaHopLe"] == "Đạt"
    assert opening["diemDanhGia"] == 98
    member = opening["thanhVienLienDanh"][0]
    assert member["tenNhaThau"] == "Công ty mới"
    assert member["nguoiDaiDien"] == "Nguyễn Văn B"

    no_ids = [{"not": "a record"}, "invalid"]
    assert mapper.attach_child_rows_to_items(
        cursor, "nha_thau", no_ids, organization_id="org-1"
    ) is no_ids
    assert mapper.attach_child_rows_to_items(
        cursor, "nha_thau", [], organization_id="org-1"
    ) == []


def test_attach_opening_always_returns_normalized_detailed_evaluation_reports():
    datasets = {
        "bao_cao_danh_gia_nha_thau": [
            {
                "id": "report-technical",
                "thong_tin_mo_thau_id": "opening-1",
                "vong_danh_gia_id": "round-technical",
                "loai_vong": "technical",
                "trang_thai": "draft",
                "ket_luan": "",
                "nguoi_cham_id": None,
                "hoan_thanh_luc": None,
                "extension_json": '{"schemaVersion":1,"projectionPending":true}',
            }
        ],
        "chi_tiet_danh_gia_nha_thau": [
            {
                "id": "detail-1",
                "bao_cao_danh_gia_nha_thau_id": "report-technical",
                "tieu_chi_danh_gia_id": "criterion-1",
                "ket_qua": "pass",
                "diem": None,
                "noi_dung_hsdt": "HSDT",
                "nhan_xet": "Meets the requirement",
                "ly_do_khong_dat": "",
                "yeu_cau_lam_ro": "",
                "ket_qua_lam_ro": "",
                "tai_lieu_tham_chieu": "M1",
                "thu_tu": 0,
                "extension_json": '{"schemaVersion":1,"ketQuaTuDong":"pass"}',
            }
        ],
    }
    cursor = RecordingCursor(
        datasets,
        stored_bid=("package-1", "contractor-1", "", "independent"),
    )
    opening = {"id": "opening-1", "nhaThauId": "contractor-1"}

    mapper.attach_child_rows(
        cursor,
        "thong_tin_mo_thau",
        opening,
        organization_id="org-1",
    )

    assert opening["baoCaoDanhGiaChiTietList"] == [
        {
            "id": "report-technical",
            "vongDanhGiaId": "round-technical",
            "loaiVong": "technical",
            "trangThai": "draft",
            "ketLuan": "",
            "nguoiChamId": None,
            "hoanThanhLuc": None,
            "extension": {"projectionPending": True},
            "chiTietList": [
                {
                    "id": "detail-1",
                    "tieuChiDanhGiaId": "criterion-1",
                    "ketQua": "pass",
                    "diem": None,
                    "noiDungHsdt": "HSDT",
                    "nhanXet": "Meets the requirement",
                    "lyDoKhongDat": "",
                    "yeuCauLamRo": "",
                    "ketQuaLamRo": "",
                    "taiLieuThamChieu": "M1",
                    "extension": {"ketQuaTuDong": "pass"},
                }
            ],
        }
    ]

    empty_opening = {"id": "opening-2"}
    mapper.attach_child_rows(
        RecordingCursor(stored_bid=None),
        "thong_tin_mo_thau",
        empty_opening,
        organization_id="org-1",
    )
    assert empty_opening["baoCaoDanhGiaChiTietList"] == []


def test_attach_detailed_rows_uses_criterion_order_not_row_identity():
    datasets = {
        "bao_cao_danh_gia_nha_thau": [
            {
                "id": "report-technical",
                "thong_tin_mo_thau_id": "opening-1",
                "vong_danh_gia_id": "round-technical",
                "loai_vong": "technical",
                "trang_thai": "draft",
            }
        ],
        "vong_danh_gia": [
            {"id": "round-technical", "loai_vong": "technical"},
        ],
        "tieu_chi_danh_gia": [
            {"id": "criterion-first", "thu_tu": 1},
            {"id": "criterion-second", "thu_tu": 2},
        ],
        "chi_tiet_danh_gia_nha_thau": [
            {
                "id": "a-row",
                "bao_cao_danh_gia_nha_thau_id": "report-technical",
                "tieu_chi_danh_gia_id": "criterion-second",
                "ket_qua": "pass",
            },
            {
                "id": "z-row",
                "bao_cao_danh_gia_nha_thau_id": "report-technical",
                "tieu_chi_danh_gia_id": "criterion-first",
                "ket_qua": "pass",
            },
        ],
    }
    cursor = RecordingCursor(datasets, stored_bid=("package-1", "contractor-1", "", "independent"))
    opening = {"id": "opening-1"}

    mapper.attach_child_rows(
        cursor,
        "thong_tin_mo_thau",
        opening,
        organization_id="org-1",
    )

    assert [
        row["tieuChiDanhGiaId"] for row in opening["baoCaoDanhGiaChiTietList"][0]["chiTietList"]
    ] == ["criterion-first", "criterion-second"]


def test_save_detailed_evaluation_reports_obeys_presence_and_upsert_contract():
    untouched = RecordingCursor()
    mapper.save_child_payloads(
        untouched,
        "thong_tin_mo_thau",
        {"id": "opening-1", "goiThauId": "package-1"},
        "org-1",
        "organization",
        4,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )
    assert not any(
        "bao_cao_danh_gia_nha_thau" in sql
        or "chi_tiet_danh_gia_nha_thau" in sql
        for sql, _params in untouched.calls
    )

    cleared = RecordingCursor()
    mapper.save_child_payloads(
        cleared,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "baoCaoDanhGiaChiTietList": [],
        },
        "org-1",
        "organization",
        4,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )
    assert any(
        sql.startswith("DELETE FROM bao_cao_danh_gia_nha_thau")
        and params == ("org-1", "opening-1")
        for sql, params in cleared.calls
    )

    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "technical"),
            "criterion_lookup": ("round-technical", 100),
        }
    )
    mapper.save_child_payloads(
        cursor,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "baoCaoDanhGiaChiTietList": [
                {
                    "id": "report-1",
                    "vongDanhGiaId": "round-technical",
                    "loaiVong": "technical",
                    "trangThai": "completed",
                    "ketLuan": "Đạt",
                    "chiTietList": [
                        {
                            "id": "detail-1",
                            "tieuChiDanhGiaId": "criterion-1",
                            "ketQua": "pass",
                            "diem": 95,
                            "nhanXet": "Đáp ứng",
                        }
                    ],
                }
            ],
        },
        "org-1",
        "organization",
        4,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )

    report_sql, report_params = next(
        (sql, params)
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO bao_cao_danh_gia_nha_thau")
    )
    detail_sql, detail_params = next(
        (sql, params)
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO chi_tiet_danh_gia_nha_thau")
    )
    assert "ON CONFLICT(organization_id, vong_danh_gia_id, thong_tin_mo_thau_id)" in report_sql
    assert report_params[0:7] == (
        "report-1",
        "org-1",
        "organization",
        "round-technical",
        "opening-1",
        "completed",
        "Đạt",
    )
    assert "ON CONFLICT(organization_id, bao_cao_danh_gia_nha_thau_id, tieu_chi_danh_gia_id)" in detail_sql
    assert detail_params[0:7] == (
        "detail-1",
        "org-1",
        "organization",
        "report-1",
        "criterion-1",
        "pass",
        95.0,
    )


def test_save_single_detailed_evaluation_report():
    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "single"),
            "criterion_lookup": ("round-single", None, 1),
            "tieu_chi_danh_gia": [("criterion-single", "pass", "")],
        }
    )

    _save_detailed_report(
        cursor,
        {
            "id": "report-single",
            "vongDanhGiaId": "round-single",
            "loaiVong": "single",
            "trangThai": "completed",
            "chiTietList": [{
                "id": "detail-single",
                "tieuChiDanhGiaId": "criterion-single",
                "ketQua": "pass",
            }],
        },
    )

    report_params = next(
        params
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO bao_cao_danh_gia_nha_thau")
    )
    detail_params = next(
        params
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO chi_tiet_danh_gia_nha_thau")
    )
    assert report_params[0:8] == (
        "report-single",
        "org-1",
        "organization",
        "round-single",
        "opening-1",
        "completed",
        "",
        "reviewer-1",
    )
    assert detail_params[3:6] == (
        "report-single",
        "criterion-single",
        "pass",
    )


@pytest.mark.parametrize("include_empty_details", [False, True])
def test_completed_detailed_evaluation_requires_every_required_criterion(
    include_empty_details,
):
    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "single"),
            "tieu_chi_danh_gia": [("criterion-required", "pending", "")],
        }
    )
    report = {
        "id": "report-single",
        "vongDanhGiaId": "round-single",
        "loaiVong": "single",
        "trangThai": "completed",
    }
    if include_empty_details:
        report["chiTietList"] = []

    with pytest.raises(ValueError, match="bat buoc chua duoc danh gia"):
        _save_detailed_report(cursor, report)


def test_save_detailed_evaluation_reuses_existing_detail_identity():
    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "technical"),
            "criterion_lookup": ("round-technical", 100, 1),
            "detail_lookup": ("detail-stable",),
        }
    )

    mapper.save_child_payloads(
        cursor,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "baoCaoDanhGiaChiTietList": [
                {
                    "id": "report-1",
                    "vongDanhGiaId": "round-technical",
                    "loaiVong": "technical",
                    "trangThai": "draft",
                    "chiTietList": [
                        {
                            "id": "detail-client-temp",
                            "tieuChiDanhGiaId": "criterion-1",
                            "ketQua": "pass",
                        }
                    ],
                }
            ],
        },
        "org-1",
        "organization",
        5,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )

    detail_params = next(
        params
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO chi_tiet_danh_gia_nha_thau")
    )
    assert detail_params[0] == "detail-stable"
    cleanup_params = next(
        params
        for sql, params in cursor.calls
        if sql.startswith("DELETE FROM chi_tiet_danh_gia_nha_thau")
    )
    assert cleanup_params[-1] == "detail-stable"


def test_save_detailed_evaluation_rejects_criterion_from_another_round():
    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "technical"),
            "criterion_lookup": ("round-financial", 100, 1),
        }
    )

    with pytest.raises(ValueError, match="khong thuoc vong bao cao"):
        _save_detailed_report(
            cursor,
            {
                "vongDanhGiaId": "round-technical",
                "loaiVong": "technical",
                "chiTietList": [
                    {
                        "tieuChiDanhGiaId": "criterion-financial",
                        "ketQua": "pass",
                    }
                ],
            },
        )


def test_save_detailed_evaluation_rejects_opening_from_another_package():
    cursor = RecordingCursor(
        {"round_lookup": ("package-1", "technical")},
        stored_bid=("package-other", "contractor-1", "", "independent"),
    )

    with pytest.raises(ValueError, match="khong thuoc goi thau cua ho so"):
        _save_detailed_report(
            cursor,
            {
                "vongDanhGiaId": "round-technical",
                "loaiVong": "technical",
                "chiTietList": [],
            },
        )


def test_save_detailed_evaluation_rejects_cross_organization_round():
    cursor = RecordingCursor({"round_lookup": None})

    with pytest.raises(ValueError, match="khong thuoc owner hien tai"):
        _save_detailed_report(
            cursor,
            {
                "vongDanhGiaId": "round-other-organization",
                "loaiVong": "technical",
                "chiTietList": [],
            },
        )


def test_save_detailed_evaluation_rejects_score_above_criterion_maximum():
    cursor = RecordingCursor(
        {
            "round_lookup": ("package-1", "technical"),
            "criterion_lookup": ("round-technical", 10, 1),
        }
    )

    with pytest.raises(ValueError, match="ngoai pham vi"):
        _save_detailed_report(
            cursor,
            {
                "vongDanhGiaId": "round-technical",
                "loaiVong": "technical",
                "chiTietList": [
                    {
                        "tieuChiDanhGiaId": "criterion-1",
                        "ketQua": "pass",
                        "diem": 10.01,
                    }
                ],
            },
        )


def test_save_detailed_evaluation_keeps_technical_and_financial_reports_separate():
    cursor = RecordingCursor(
        {
            "round_lookups": {
                "round-technical": ("package-1", "technical"),
                "round-financial": ("package-1", "financial"),
            },
            "criterion_lookups": {
                "criterion-technical": ("round-technical", None, 1),
                "criterion-financial": ("round-financial", None, 1),
            },
        }
    )

    mapper.save_child_payloads(
        cursor,
        "thong_tin_mo_thau",
        {
            "id": "opening-1",
            "goiThauId": "package-1",
            "baoCaoDanhGiaChiTietList": [
                {
                    "id": "report-technical",
                    "vongDanhGiaId": "round-technical",
                    "loaiVong": "technical",
                    "chiTietList": [
                        {
                            "id": "detail-technical",
                            "tieuChiDanhGiaId": "criterion-technical",
                            "ketQua": "pass",
                        }
                    ],
                },
                {
                    "id": "report-financial",
                    "vongDanhGiaId": "round-financial",
                    "loaiVong": "financial",
                    "chiTietList": [
                        {
                            "id": "detail-financial",
                            "tieuChiDanhGiaId": "criterion-financial",
                            "ketQua": "pass",
                        }
                    ],
                },
            ],
        },
        "org-1",
        "organization",
        5,
        "2026-07-25",
        actor_user_id="reviewer-1",
    )

    report_params = [
        params
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO bao_cao_danh_gia_nha_thau")
    ]
    detail_params = [
        params
        for sql, params in cursor.calls
        if sql.startswith("INSERT INTO chi_tiet_danh_gia_nha_thau")
    ]
    assert [(params[0], params[3]) for params in report_params] == [
        ("report-technical", "round-technical"),
        ("report-financial", "round-financial"),
    ]
    assert [(params[0], params[3]) for params in detail_params] == [
        ("detail-technical", "report-technical"),
        ("detail-financial", "report-financial"),
    ]


def test_select_fetch_and_format_helpers_are_owner_scoped():
    cursor = RecordingCursor(
        {
            "goi_thau_phan_lo": [
                {
                    "ma_phan_lo": "L1",
                    "gia_trung_thau": 0,
                    "thoi_gian_hop_dong": "",
                },
                {
                    "ma_phan_lo": "L2",
                    "nha_thau_trung_thau_id": "contractor-1",
                },
            ]
        }
    )
    assert mapper.fetch_package_lot_codes(cursor, "package-1", "org-1") == [
        "L1",
        "L2",
    ]
    assert mapper._table_exists(cursor, "goi_thau_moc_tien_do") is True
    assert mapper._fetch_awards(cursor, "package-1", "org-1")[0]["maPhanLo"] == "L2"
    assert mapper._has_lot_award({"gia_trung_thau": 1}) is True
    assert mapper._has_lot_award({}) is False

    shaped = mapper._format_timeline_child(
        {"id": "1", "is_optional": 0, "sort_order": None, "template_version": None},
        "snake",
    )
    assert shaped["is_optional"] is False
    assert shaped["sort_order"] == 0
    assert mapper._format_clarification_child(
        {"id": "1", "thoi_gian": "now", "noi_dung": "x"},
        "camel",
        False,
    )["noiDungTraLoi"] == "x"
