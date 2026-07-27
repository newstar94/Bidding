from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import inspect
import json
import os
import ssl
import threading
import time
from zoneinfo import ZoneInfo

import psycopg
import pytest
from cryptography.fernet import Fernet
from psycopg import sql

from backend.db import db_helper
from backend.db.db_helper import PostgresDatabase, _convert_qmark_parameters
from backend.db.postgres_schema import (
    assert_foreign_key_integrity,
    assert_schema_contract,
    initialize_postgres_database,
)
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.db_utils import recalculate_is_latest
from backend.auth import auth_service
from backend.auth import email_delivery_service
from backend.auth.session_store import (
    create_session,
    load_session_user,
    replace_user_session,
)
from backend.auth.email_utils import EmailDeliveryResult
from backend.observability import metrics
from backend.partners import partner_lookup_service
from backend.documents import document_worker
from backend.shared.audit_chain import (
    build_audit_checkpoint,
    insert_audit_row,
    inspect_audit_chain,
    inspect_audit_chain_against_checkpoint,
    inspect_audit_chain_incremental,
)
from backend.shared.audit_monitor import _inspect_database
from backend.sync.repository import next_sync_version
from backend.sync import mapper
from backend.sync.websocket import (
    _acquire_cluster_ip_lease,
    _attach_cluster_user_lease,
    _release_cluster_lease,
)
from backend.shared.date_utils import VIETNAM_TIMEZONE_NAME, vietnam_now
from backend.shared import logging_utils
from backend.lot_lifecycle_service import (
    create_batch,
    finalize_batch_award,
    query_lifecycle,
)
from backend.lot_selection_lifecycle import LotLifecyclePolicyError


@pytest.fixture(scope="session")
def postgres_database() -> PostgresDatabase:
    database_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    original_admin_password = os.environ.get("ADMIN_PASSWORD")
    os.environ["ADMIN_PASSWORD"] = "Test admin password 2026!"
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    database = PostgresDatabase(database_url)
    initialize_postgres_database(database)
    yield database
    database.close()
    if original_admin_password is None:
        os.environ.pop("ADMIN_PASSWORD", None)
    else:
        os.environ["ADMIN_PASSWORD"] = original_admin_password


def test_qmark_conversion_preserves_literals_and_comments() -> None:
    statement = "SELECT '?', \"?\" FROM demo WHERE id = ? -- ?\nAND note = 'it''s ?'"
    converted = _convert_qmark_parameters(statement)
    assert converted == "SELECT '?', \"?\" FROM demo WHERE id = %s -- ?\nAND note = 'it''s ?'"


def test_fresh_schema_contract(postgres_database: PostgresDatabase) -> None:
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        assert_schema_contract(cursor)
        assert_foreign_key_integrity(cursor)
        table_count = cursor.execute(
            """SELECT count(*) FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"""
        ).fetchone()[0]
        assert table_count == len(SCHEMA_DINH_NGHIA)
        assert cursor.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()[0] == DB_SCHEMA_VERSION


def test_detailed_evaluation_round_trip_tenant_isolation_and_cascade(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = cursor.execute(
            "SELECT id FROM to_chuc ORDER BY id LIMIT 1"
        ).fetchone()[0]
        reviewer_id = cursor.execute(
            "SELECT id FROM tai_khoan ORDER BY id LIMIT 1"
        ).fetchone()[0]
        suffix = "detailed-evaluation-integration"
        investor_id = f"investor-{suffix}"
        plan_id = f"plan-{suffix}"
        package_id = f"package-{suffix}"
        contractor_id = f"contractor-{suffix}"
        opening_id = f"opening-{suffix}"
        technical_round_id = f"evaluation-round:{package_id}:technical"
        financial_round_id = f"evaluation-round:{package_id}:financial"
        technical_criterion_id = f"criterion-technical-{suffix}"
        financial_criterion_id = f"criterion-financial-{suffix}"

        cursor.execute(
            """INSERT INTO chu_dau_tu (
                   organization_id, id, owner_type, ten_chu_dau_tu
               ) VALUES (?, ?, 'organization', ?)""",
            (organization_id, investor_id, "Integration investor"),
        )
        cursor.execute(
            """INSERT INTO ke_hoach_lcnt (
                   organization_id, id, owner_type, ten_ke_hoach,
                   ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                   ngay_phe_duyet, quyet_dinh_phe_duyet
               ) VALUES (?, ?, 'organization', ?, ?, ?, ?, ?, ?)""",
            (
                organization_id,
                plan_id,
                "Integration plan",
                "Integration project",
                "Khác",
                investor_id,
                "2026-07-25",
                "QD-INT",
            ),
        )
        cursor.execute(
            """INSERT INTO goi_thau (
                   organization_id, id, owner_type, ke_hoach_id,
                   ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien,
                   nguon_von, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                   phuong_thuc_lua_chon
               ) VALUES (?, ?, 'organization', ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id,
                package_id,
                plan_id,
                "Integration package",
                1000000,
                "30 ngày",
                "Ngân sách",
                "Q3/2026",
                "2026-07-25",
                "Một giai đoạn hai túi hồ sơ",
            ),
        )
        cursor.execute(
            """INSERT INTO nha_thau (
                   organization_id, id, owner_type, ten_nha_thau
               ) VALUES (?, ?, 'organization', ?)""",
            (organization_id, contractor_id, "Integration contractor"),
        )
        cursor.execute(
            """INSERT INTO thong_tin_mo_thau (
                   organization_id, id, owner_type, goi_thau_id, nha_thau_id
               ) VALUES (?, ?, 'organization', ?, ?)""",
            (organization_id, opening_id, package_id, contractor_id),
        )
        cursor.execute(
            """INSERT INTO vong_danh_gia (
                   organization_id, id, owner_type, goi_thau_id,
                   loai_vong, thu_tu
               ) VALUES (?, ?, 'organization', ?, ?, ?)""",
            (organization_id, technical_round_id, package_id, "technical", 0),
        )
        cursor.execute(
            """INSERT INTO vong_danh_gia (
                   organization_id, id, owner_type, goi_thau_id,
                   loai_vong, thu_tu
               ) VALUES (?, ?, 'organization', ?, ?, ?)""",
            (organization_id, financial_round_id, package_id, "financial", 1),
        )
        cursor.execute(
            """INSERT INTO tieu_chi_danh_gia (
                   organization_id, id, owner_type, vong_danh_gia_id,
                   ma_tieu_chi, ten_tieu_chi, nhom_danh_gia,
                   loai_ket_qua, bat_buoc, thu_tu
               ) VALUES (?, ?, 'organization', ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id,
                technical_criterion_id,
                technical_round_id,
                "TECH-1",
                "Technical criterion",
                "technical",
                "pass_fail",
                1,
                1,
            ),
        )
        cursor.execute(
            """INSERT INTO tieu_chi_danh_gia (
                   organization_id, id, owner_type, vong_danh_gia_id,
                   ma_tieu_chi, ten_tieu_chi, nhom_danh_gia,
                   loai_ket_qua, bat_buoc, thu_tu
               ) VALUES (?, ?, 'organization', ?, ?, ?, ?, ?, ?, ?)""",
            (
                organization_id,
                financial_criterion_id,
                financial_round_id,
                "FIN-1",
                "Financial criterion",
                "financial",
                "pass_fail",
                1,
                1,
            ),
        )

        mapper.save_child_payloads(
            cursor,
            "thong_tin_mo_thau",
            {
                "id": opening_id,
                "goiThauId": package_id,
                "baoCaoDanhGiaChiTietList": [
                    {
                        "id": "report-technical-client",
                        "vongDanhGiaId": technical_round_id,
                        "loaiVong": "technical",
                        "trangThai": "completed",
                        "ketLuan": "Đạt",
                        "extension": {"projectionPending": True},
                        "chiTietList": [{
                            "id": "detail-technical-client",
                            "tieuChiDanhGiaId": technical_criterion_id,
                            "ketQua": "pass",
                            "extension": {"ketQuaTuDong": "pass"},
                        }],
                    }
                ],
            },
            organization_id,
            "organization",
            1,
            "2026-07-25",
            actor_user_id=reviewer_id,
        )

        loaded = {"id": opening_id}
        mapper.attach_child_rows(
            cursor,
            "thong_tin_mo_thau",
            loaded,
            organization_id=organization_id,
        )
        assert [report["loaiVong"] for report in loaded["baoCaoDanhGiaChiTietList"]] == [
            "technical"
        ]
        assert loaded["baoCaoDanhGiaChiTietList"][0]["extension"] == {
            "projectionPending": True
        }
        assert loaded["baoCaoDanhGiaChiTietList"][0]["chiTietList"][0][
            "tieuChiDanhGiaId"
        ] == technical_criterion_id
        assert loaded["baoCaoDanhGiaChiTietList"][0]["chiTietList"][0][
            "extension"
        ] == {"ketQuaTuDong": "pass"}

        mapper.save_child_payloads(
            cursor,
            "goi_thau",
            {
                "id": package_id,
                "danhGiaHsdtMetadata": {
                    "is1G2T": True,
                    "technical": {
                        "criteria": [{
                            "id": technical_criterion_id,
                            "code": "TECH-1",
                            "name": "Technical criterion",
                            "group": "technical",
                            "resultType": "pass_fail",
                            "required": True,
                            "stt": "3.1",
                            "sourceStt": "3.1",
                            "source": "muasamcong",
                            "isSection": True,
                            "requirement": "Source requirement",
                        }],
                    },
                    "financial": {
                        "criteria": [{
                            "id": financial_criterion_id,
                            "code": "FIN-1",
                            "name": "Financial criterion",
                            "group": "financial",
                            "resultType": "pass_fail",
                            "required": True,
                        }],
                    },
                },
            },
            organization_id,
            "organization",
            2,
            "2026-07-25",
            actor_user_id=reviewer_id,
        )
        loaded_package = {"id": package_id, "danhGiaHsdtMetadata": "{}"}
        mapper.attach_child_rows(
            cursor,
            "goi_thau",
            loaded_package,
            organization_id=organization_id,
        )
        loaded_technical_criterion = json.loads(
            loaded_package["danhGiaHsdtMetadata"]
        )["technical"]["criteria"][0]
        assert loaded_technical_criterion["stt"] == "3.1"
        assert loaded_technical_criterion["sourceStt"] == "3.1"
        assert loaded_technical_criterion["source"] == "muasamcong"
        assert loaded_technical_criterion["isSection"] is True
        assert loaded_technical_criterion["requirement"] == "Source requirement"
        assert cursor.execute(
            "SELECT count(*) FROM chi_tiet_danh_gia_nha_thau WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()[0] == 1

        mapper.save_child_payloads(
            cursor,
            "thong_tin_mo_thau",
            {
                "id": opening_id,
                "goiThauId": package_id,
                "baoCaoDanhGiaChiTietList": [
                    {
                        "id": "report-technical-new-client-id",
                        "vongDanhGiaId": technical_round_id,
                        "loaiVong": "technical",
                        "trangThai": "completed",
                        "chiTietList": [{
                            "id": "detail-technical-new-client-id",
                            "tieuChiDanhGiaId": technical_criterion_id,
                            "ketQua": "pass",
                        }],
                    },
                    {
                        "id": "report-financial",
                        "vongDanhGiaId": financial_round_id,
                        "loaiVong": "financial",
                        "trangThai": "completed",
                        "chiTietList": [{
                            "id": "detail-financial",
                            "tieuChiDanhGiaId": financial_criterion_id,
                            "ketQua": "pass",
                        }],
                    },
                ],
            },
            organization_id,
            "organization",
            2,
            "2026-07-25",
            actor_user_id=reviewer_id,
        )
        assert cursor.execute(
            "SELECT count(*) FROM bao_cao_danh_gia_nha_thau WHERE organization_id = ? AND thong_tin_mo_thau_id = ?",
            (organization_id, opening_id),
        ).fetchone()[0] == 2
        assert cursor.execute(
            "SELECT count(*) FROM chi_tiet_danh_gia_nha_thau WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()[0] == 2

        other_organization_id = f"org-detailed-isolation-{suffix}"
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (other_organization_id, "Other integration organization"),
        )
        with pytest.raises(ValueError, match="khong thuoc owner hien tai"):
            mapper.save_child_payloads(
                cursor,
                "thong_tin_mo_thau",
                {
                    "id": opening_id,
                    "goiThauId": package_id,
                    "baoCaoDanhGiaChiTietList": [{
                        "vongDanhGiaId": technical_round_id,
                        "loaiVong": "technical",
                        "chiTietList": [],
                    }],
                },
                other_organization_id,
                "organization",
                3,
                "2026-07-25",
                actor_user_id=reviewer_id,
            )

        # Package deletion intentionally protects referenced opening bids with
        # RESTRICT. Exercise both new descendant cascade edges directly without
        # changing that legacy archive/delete policy.
        cursor.execute(
            "DELETE FROM thong_tin_mo_thau WHERE organization_id = ? AND id = ?",
            (organization_id, opening_id),
        )
        assert cursor.execute(
            "SELECT count(*) FROM bao_cao_danh_gia_nha_thau WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()[0] == 0
        assert cursor.execute(
            "SELECT count(*) FROM chi_tiet_danh_gia_nha_thau WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()[0] == 0
        cursor.execute(
            "DELETE FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        )
        assert cursor.execute(
            "SELECT count(*) FROM vong_danh_gia WHERE organization_id = ? AND goi_thau_id = ?",
            (organization_id, package_id),
        ).fetchone()[0] == 0
    finally:
        connection.rollback()
        connection.close()


def test_v13_database_is_reconciled_to_fresh_schema(
    postgres_database: PostgresDatabase,
) -> None:
    lifecycle_tables = (
        "dot_xu_ly_phan_lo",
        "dot_xu_ly_phan_lo_chi_tiet",
        "nhom_phu_thuoc_phan_lo",
        "nhom_phu_thuoc_phan_lo_thanh_vien",
        "ho_so_nghiep_vu_lcnt",
        "ho_so_nghiep_vu_lcnt_phan_lo",
    )
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        foreign_keys = cursor.execute(
            """SELECT conrelid::regclass::text, conname
               FROM pg_constraint
               WHERE contype = 'f'
                 AND conrelid::regclass::text = ANY(?)""",
            (list(lifecycle_tables),),
        ).fetchall()
        for table_name, constraint_name in foreign_keys:
            cursor.execute(
                sql.SQL("ALTER TABLE {} DROP CONSTRAINT {}").format(
                    sql.Identifier(table_name),
                    sql.Identifier(constraint_name),
                )
            )
        primary_key_name = cursor.execute(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = 'danh_muc_trang_thai_hop_dong'::regclass
                 AND contype = 'p'"""
        ).fetchone()[0]
        cursor.execute(
            sql.SQL(
                "ALTER TABLE danh_muc_trang_thai_hop_dong DROP CONSTRAINT {}"
            ).format(sql.Identifier(primary_key_name))
        )
        cursor.execute(
            """ALTER TABLE danh_muc_trang_thai_hop_dong
               ADD CONSTRAINT danh_muc_trang_thai_hop_dong_pkey
               PRIMARY KEY (id)"""
        )
        cursor.execute(
            """DROP TRIGGER IF EXISTS
                   trg_danh_muc_trang_thai_hop_dong_workspace_owner
               ON danh_muc_trang_thai_hop_dong"""
        )
        cursor.execute(
            "UPDATE database_metadata SET schema_version = 13 WHERE id = 1"
        )

    assert initialize_postgres_database(postgres_database) == DB_SCHEMA_VERSION

    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        assert cursor.execute(
            """SELECT count(*) FROM pg_constraint
               WHERE contype = 'f'
                 AND conrelid::regclass::text = ANY(?)""",
            (list(lifecycle_tables),),
        ).fetchone()[0] == len(foreign_keys)
        primary_key_columns = cursor.execute(
            """SELECT array_agg(attribute.attname ORDER BY keys.ordinality)
               FROM pg_constraint constraint_row
               CROSS JOIN LATERAL
                    unnest(constraint_row.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
               JOIN pg_attribute attribute
                 ON attribute.attrelid = constraint_row.conrelid
                AND attribute.attnum = keys.attnum
               WHERE constraint_row.conrelid =
                     'danh_muc_trang_thai_hop_dong'::regclass
                 AND constraint_row.contype = 'p'"""
        ).fetchone()[0]
        assert primary_key_columns == ["organization_id", "id"]
        assert cursor.execute(
            """SELECT count(*) FROM pg_trigger
               WHERE tgrelid = 'danh_muc_trang_thai_hop_dong'::regclass
                 AND tgname =
                     'trg_danh_muc_trang_thai_hop_dong_workspace_owner'
                 AND NOT tgisinternal"""
        ).fetchone()[0] == 1


def test_lot_batch_command_claims_scope_atomically(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id = cursor.execute(
            "SELECT id FROM to_chuc ORDER BY id LIMIT 1"
        ).fetchone()[0]
        user_id = cursor.execute(
            "SELECT id FROM tai_khoan ORDER BY id LIMIT 1"
        ).fetchone()[0]
        cursor.execute(
            """INSERT INTO chu_dau_tu (
                   id, organization_id, owner_type, ten_chu_dau_tu
               ) VALUES ('lot-test-investor', ?, 'organization', 'Chủ đầu tư')""",
            (organization_id,),
        )
        cursor.execute(
            """INSERT INTO ke_hoach_lcnt (
                   id, organization_id, owner_type, ten_ke_hoach,
                   ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                   ngay_phe_duyet, quyet_dinh_phe_duyet
               ) VALUES (
                   'lot-test-plan', ?, 'organization', 'Kế hoạch',
                   'Dự án', 'Mua sắm', 'lot-test-investor',
                   '2026-07-22', 'QĐ-KH'
               )""",
            (organization_id,),
        )
        cursor.execute(
            """INSERT INTO goi_thau (
                   id, organization_id, owner_type, ke_hoach_id,
                   ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien,
                   nguon_von, thoi_gian_to_chuc,
                   thoi_gian_bat_dau_to_chuc, phan_lo,
                   phuong_thuc_lua_chon
               ) VALUES (
                   'lot-test-package', ?, 'organization', 'lot-test-plan',
                   'Gói nhiều lô', 100, '30 ngày', 'Ngân sách', '30 ngày',
                   '2026-07-22', 'Có', 'Một giai đoạn hai túi hồ sơ'
               )""",
            (organization_id,),
        )
        cursor.executemany(
            """INSERT INTO goi_thau_phan_lo (
                   id, organization_id, owner_type, goi_thau_id,
                   ma_phan_lo, ten_phan_lo, gia_tri_phan_lo, sort_order
               ) VALUES (?, ?, 'organization', 'lot-test-package', ?, ?, ?, ?)""",
            [
                ('lot-test-a', organization_id, 'A', 'Lô A', 40, 0),
                ('lot-test-b', organization_id, 'B', 'Lô B', 60, 1),
            ],
        )

        batch = create_batch(
            cursor,
            organization_id,
            'lot-test-package',
            ['lot-test-a'],
            approval_mode='CONSOLIDATED_APPROVAL',
            actor_user_id=user_id,
        )

        assert batch['initialStage'] == 'TECHNICAL_DRAFT'
        assert batch['lotIds'] == ['lot-test-a']
        lifecycle = query_lifecycle(cursor, organization_id, 'lot-test-package')
        assert lifecycle['packageStatus'] == 'IN_PROGRESS'
        assert lifecycle['counts'] == {
            'totalLots': 2,
            'completedLots': 0,
            'pendingLots': 2,
        }
        assert lifecycle['batches'][0]['lots'][0]['lot_id'] == 'lot-test-a'

        with pytest.raises(LotLifecyclePolicyError):
            create_batch(
                cursor,
                organization_id,
                'lot-test-package',
                ['lot-test-a'],
                approval_mode='CONSOLIDATED_APPROVAL',
                actor_user_id=user_id,
            )

        first_result = finalize_batch_award(
            cursor,
            organization_id,
            'lot-test-package',
            batch['id'],
            {'lot-test-a': 'NO_RESPONSIVE_BID'},
            {
                "expectedVersion": 1,
                "decisionNumber": "QĐ-KQ-1",
                "decisionDate": "2026-07-23",
                "metadata": {"result": {"saved": True}},
                "lotResults": [
                    {
                        "lotId": "lot-test-a",
                        "winnerId": "",
                        "awardPrice": 0,
                        "packageDuration": "",
                        "contractDuration": "",
                    }
                ],
            },
            actor_user_id=user_id,
        )
        assert first_result['packageStatus'] == 'PARTIALLY_COMPLETED'
        assert first_result['counts']['completedLots'] == 1
        assert first_result["packageRowVersion"] == 2

        second_batch = create_batch(
            cursor,
            organization_id,
            'lot-test-package',
            ['lot-test-b'],
            approval_mode='STAGED_APPROVAL',
            actor_user_id=user_id,
        )
        final_result = finalize_batch_award(
            cursor,
            organization_id,
            'lot-test-package',
            second_batch['id'],
            {'lot-test-b': 'NO_RESPONSIVE_BID'},
            {
                "expectedVersion": 2,
                "decisionNumber": "QĐ-KQ-2",
                "decisionDate": "2026-07-24",
                "metadata": {"result": {"saved": True}},
                "lotResults": [
                    {
                        "lotId": "lot-test-b",
                        "winnerId": "",
                        "awardPrice": 0,
                        "packageDuration": "",
                        "contractDuration": "",
                    }
                ],
            },
            actor_user_id=user_id,
        )
        assert final_result['packageStatus'] == 'COMPLETED'
        assert final_result['counts']['completedLots'] == 2
        package_result = cursor.execute(
            """SELECT trang_thai, nha_thau_trung_thau_id, gia_trung_thau,
                      so_quyet_dinh_ket_qua, row_version
               FROM goi_thau
               WHERE organization_id = ? AND id = 'lot-test-package'""",
            (organization_id,),
        ).fetchone()
        assert tuple(package_result) == (
            "AWARDED",
            None,
            0,
            "QĐ-KQ-2",
            3,
        )
        artifacts = cursor.execute(
            """SELECT count(*) FROM ho_so_nghiep_vu_lcnt
               WHERE organization_id = ?
                 AND batch_id IN (?, ?)
                 AND artifact_type = 'RESULT_APPROVAL_DECISION'
                 AND status = 'FINAL'""",
            (organization_id, batch["id"], second_batch["id"]),
        ).fetchone()[0]
        assert artifacts == 2
    finally:
        connection.rollback()
        connection.close()


def test_session_lookup_and_cleanup_indexes_are_narrow(
    postgres_database: PostgresDatabase,
) -> None:
    source = inspect.getsource(load_session_user).lower()
    assert "accounts.*" not in source

    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        indexes = {
            row[0]
            for row in cursor.execute(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = 'auth_sessions'
                """
            ).fetchall()
        }
        assert {
            "auth_sessions_token_hash_key",
            "idx_auth_sessions_one_active_per_user",
            "idx_auth_sessions_active_idle_expiry",
            "idx_auth_sessions_active_absolute_expiry",
            "idx_auth_sessions_revoked_cleanup",
        } <= indexes


def test_replacing_session_revokes_previous_login_and_database_rejects_second_active(
    postgres_database: PostgresDatabase,
) -> None:
    now = int(time.time())
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        user_id = cursor.execute(
            "SELECT id FROM tai_khoan WHERE username_norm = 'admin'"
        ).fetchone()[0]
        replace_user_session(
            cursor,
            user_id=user_id,
            token="first-device-token",
            absolute_expires_at=now + 3600,
            idle_timeout_seconds=1800,
            now=now,
        )
        connection.commit()

        replace_user_session(
            cursor,
            user_id=user_id,
            token="second-device-token",
            absolute_expires_at=now + 3600,
            idle_timeout_seconds=1800,
            now=now + 1,
        )
        connection.commit()

        sessions = cursor.execute(
            """SELECT token_hash, revoked_at
               FROM auth_sessions WHERE user_id = ? ORDER BY created_at, id""",
            (user_id,),
        ).fetchall()
        assert len(sessions) == 2
        assert sum(row[1] is None for row in sessions) == 1

        with pytest.raises(psycopg.IntegrityError):
            create_session(
                cursor,
                user_id=user_id,
                token="forbidden-third-token",
                absolute_expires_at=now + 3600,
                idle_timeout_seconds=1800,
                now=now + 2,
            )
        connection.rollback()


def test_every_foreign_key_has_a_leading_index(
    postgres_database: PostgresDatabase,
) -> None:
    with postgres_database.get_connection() as connection:
        missing = connection.execute(
            """
            SELECT conrelid::regclass::text, conname
            FROM pg_constraint AS constraints
            WHERE constraints.contype = 'f'
              AND constraints.connamespace = current_schema()::regnamespace
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_index AS indexes
                  WHERE indexes.indrelid = constraints.conrelid
                    AND indexes.indisvalid
                    AND (indexes.indkey::smallint[])[
                        0:cardinality(constraints.conkey) - 1
                    ] = constraints.conkey
              )
            ORDER BY 1, 2
            """
        ).fetchall()
    assert missing == []


def test_websocket_quota_is_enforced_in_postgres_across_workers(
    postgres_database: PostgresDatabase,
    monkeypatch,
) -> None:
    from backend.sync import websocket

    monkeypatch.setattr(websocket, "database", postgres_database)
    with postgres_database.get_connection() as connection:
        user_id = connection.execute(
            "SELECT id FROM tai_khoan ORDER BY id LIMIT 1"
        ).fetchone()[0]
        organization_id = connection.execute(
            "SELECT id FROM to_chuc ORDER BY id LIMIT 1"
        ).fetchone()[0]

    assert _acquire_cluster_ip_lease("ws-lease-1", "ip-hash-a", 2)
    assert _acquire_cluster_ip_lease("ws-lease-2", "ip-hash-a", 2)
    assert not _acquire_cluster_ip_lease("ws-lease-3", "ip-hash-a", 2)
    assert _attach_cluster_user_lease(
        "ws-lease-1",
        user_id,
        organization_id,
        1,
    )
    assert not _attach_cluster_user_lease(
        "ws-lease-2",
        user_id,
        organization_id,
        1,
    )
    _release_cluster_lease("ws-lease-1")
    assert _attach_cluster_user_lease(
        "ws-lease-2",
        user_id,
        organization_id,
        1,
    )
    _release_cluster_lease("ws-lease-2")


def test_partner_enrichment_jobs_are_durable_claimed_and_dead_lettered(
    postgres_database: PostgresDatabase,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        partner_lookup_service,
        "database",
        postgres_database,
    )
    with postgres_database.get_connection() as connection:
        organization_id = connection.execute(
            "SELECT id FROM to_chuc ORDER BY id LIMIT 1"
        ).fetchone()[0]
        for suffix in ("a", "b"):
            connection.execute(
                """
                INSERT INTO nha_thau (
                    id, organization_id, owner_type, ngay_ap_dung,
                    ten_nha_thau, ma_nha_thau
                ) VALUES (?, ?, 'organization', '2026-07-19', ?, ?)
                """,
                (
                    f"durable-partner-{suffix}",
                    organization_id,
                    "Nhà thầu (Chưa cập nhật thông tin)",
                    f"ORG-{suffix}",
                ),
            )
        connection.commit()

    assert partner_lookup_service._enqueue_partner_enrichment_jobs(
        organization_id,
        ["durable-partner-a", "durable-partner-b"],
    ) == 2
    first = partner_lookup_service._claim_partner_enrichment_job()
    second = partner_lookup_service._claim_partner_enrichment_job()
    assert first and second
    assert first["id"] != second["id"]
    assert partner_lookup_service._claim_partner_enrichment_job() is None

    monkeypatch.setenv("PARTNER_ENRICHMENT_MAX_ATTEMPTS", "1")
    partner_lookup_service._finish_partner_enrichment_job(
        first,
        error=RuntimeError("upstream unavailable"),
    )
    partner_lookup_service._finish_partner_enrichment_job(second)
    with postgres_database.get_connection() as connection:
        statuses = {
            row["contractor_id"]: row["status"]
            for row in connection.execute(
                """
                SELECT contractor_id, status
                FROM partner_enrichment_jobs
                WHERE organization_id = ?
                """,
                (organization_id,),
            ).fetchall()
        }
    assert statuses[first["contractor_id"]] == "failed"
    assert statuses[second["contractor_id"]] == "completed"


def test_document_job_survives_stale_worker_claim(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DOCUMENT_WORKER_TEMP_DIR",
        str(tmp_path / "durable-document-jobs"),
    )
    monkeypatch.setenv("DOCUMENT_JOB_MAX_ATTEMPTS", "3")
    job_id = document_worker._enqueue_durable_document_job(
        "test_delay",
        {"seconds": 0},
        database=postgres_database,
    )
    abandoned = document_worker._claim_durable_document_job(
        postgres_database,
        job_id,
    )
    assert abandoned and abandoned["attempt_count"] == 1
    with postgres_database.get_connection() as connection:
        connection.execute(
            "UPDATE document_jobs SET locked_at = ? WHERE id = ?",
            (int(time.time()) - 1_000, job_id),
        )
        connection.commit()

    recovered = document_worker._claim_durable_document_job(
        postgres_database,
        job_id,
    )
    assert recovered and recovered["attempt_count"] == 2
    document_worker._process_claimed_document_job(
        postgres_database,
        recovered,
    )
    assert document_worker._consume_durable_document_result(
        job_id,
        database=postgres_database,
        timeout_seconds=5,
    ) is True
    with postgres_database.get_connection() as connection:
        assert connection.execute(
            "SELECT 1 FROM document_jobs WHERE id = ?",
            (job_id,),
        ).fetchone() is None


def test_failed_document_job_retains_private_files_and_metadata_after_error_is_consumed(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DOCUMENT_WORKER_TEMP_DIR",
        str(tmp_path / "failed-document-jobs"),
    )
    monkeypatch.setenv("DOCUMENT_JOB_MAX_ATTEMPTS", "1")
    job_id = document_worker._enqueue_durable_document_job(
        "validate_ooxml",
        {"content": b"not-an-ooxml-archive", "kind": "xlsx"},
        database=postgres_database,
    )
    job_dir = document_worker._document_job_dir(job_id)
    if os.name == "posix":
        assert job_dir.stat().st_mode & 0o777 == 0o700
        assert all(
            path.stat().st_mode & 0o777 == 0o600
            for path in job_dir.iterdir()
        )

    claimed = document_worker._claim_durable_document_job(
        postgres_database,
        job_id,
    )
    assert claimed is not None
    document_worker._process_claimed_document_job(
        postgres_database,
        claimed,
    )
    assert job_dir.is_dir()
    assert (job_dir / "input.json").is_file()
    with postgres_database.get_connection() as connection:
        assert connection.execute(
            "SELECT status FROM document_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()["status"] == "failed"

    with pytest.raises(document_worker.DocumentWorkerInputError):
        document_worker._consume_durable_document_result(
            job_id,
            database=postgres_database,
            timeout_seconds=5,
        )
    with postgres_database.get_connection() as connection:
        failed = connection.execute(
            """SELECT status, last_error_code, last_error_message
               FROM document_jobs WHERE id = ?""",
            (job_id,),
        ).fetchone()
    assert failed["status"] == "failed"
    assert failed["last_error_code"] == "DocumentWorkerInputError"
    assert failed["last_error_message"]
    assert job_dir.is_dir()


def test_failed_document_job_can_be_retried_once_by_an_operator(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DOCUMENT_WORKER_TEMP_DIR",
        str(tmp_path / "retry-document-jobs"),
    )
    monkeypatch.setenv("DOCUMENT_JOB_MAX_ATTEMPTS", "1")
    job_id = document_worker._enqueue_durable_document_job(
        "test_delay",
        {"seconds": 0},
        database=postgres_database,
    )

    def fail_once(*_args, **_kwargs):
        raise document_worker.DocumentWorkerError("temporary conversion failure")

    monkeypatch.setattr(document_worker, "run_document_job", fail_once)
    claimed = document_worker._claim_durable_document_job(postgres_database, job_id)
    assert claimed is not None
    document_worker._process_claimed_document_job(postgres_database, claimed)

    assert document_worker.retry_failed_durable_document_job(
        postgres_database,
        job_id,
    ) is True
    assert document_worker.retry_failed_durable_document_job(
        postgres_database,
        job_id,
    ) is False
    with postgres_database.get_connection() as connection:
        retrying = connection.execute(
            """SELECT status, attempt_count, last_error_message
               FROM document_jobs WHERE id = ?""",
            (job_id,),
        ).fetchone()
    assert retrying["status"] == "retry"
    assert retrying["attempt_count"] == 0
    assert retrying["last_error_message"] == "temporary conversion failure"

    monkeypatch.setattr(document_worker, "run_document_job", lambda *_args, **_kwargs: True)
    retried = document_worker._claim_durable_document_job(postgres_database, job_id)
    assert retried is not None
    document_worker._process_claimed_document_job(postgres_database, retried)
    assert document_worker._consume_durable_document_result(
        job_id,
        database=postgres_database,
        timeout_seconds=5,
    ) is True


def test_tampered_completed_document_result_is_rejected_and_cleaned(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DOCUMENT_WORKER_TEMP_DIR",
        str(tmp_path / "tampered-document-jobs"),
    )
    job_id = document_worker._enqueue_durable_document_job(
        "test_delay",
        {"seconds": 0},
        database=postgres_database,
    )
    claimed = document_worker._claim_durable_document_job(
        postgres_database,
        job_id,
    )
    assert claimed is not None
    document_worker._process_claimed_document_job(
        postgres_database,
        claimed,
    )
    job_dir = document_worker._document_job_dir(job_id)
    result_path = job_dir / "result.json"
    result_path.write_text(
        '{"format":"biddingflow-document-result","version":1,'
        '"ok":true,"result":true,"unexpected":true}',
        encoding="utf-8",
    )

    with pytest.raises(document_worker.DocumentWorkerError):
        document_worker._consume_durable_document_result(
            job_id,
            database=postgres_database,
            timeout_seconds=5,
        )
    assert not job_dir.exists()
    with postgres_database.get_connection() as connection:
        assert connection.execute(
            "SELECT 1 FROM document_jobs WHERE id = ?",
            (job_id,),
        ).fetchone() is None


def test_audit_checkpoint_export_has_one_cluster_leader(
    postgres_database: PostgresDatabase,
    tmp_path,
) -> None:
    destination = tmp_path / "audit-checkpoints"
    destination.mkdir()

    def export_once():
        return _inspect_database(
            postgres_database,
            str(destination),
            "test-audit-hmac-key-" + ("x" * 32),
            True,
            3_600,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _index: export_once(), range(4)))

    assert sum(path is not None for _verification, path in results) == 1
    checkpoints = list(destination.rglob("audit-checkpoint-*.json"))
    assert len(checkpoints) == 1
    assert checkpoints[0].parent.parent == destination


def test_standalone_audit_returns_each_connection_to_a_single_slot_pool(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_POOL_MIN_SIZE", "1")
    monkeypatch.setenv("DATABASE_POOL_MAX_SIZE", "1")
    isolated_database = PostgresDatabase(postgres_database.database_url)
    isolated_database.open()
    monkeypatch.setattr(db_helper, "database", isolated_database)
    try:
        for index in range(5):
            assert logging_utils.log_audit(
                f"test.audit.pool_release.{index}",
                organization_id="org-audit-pool-release",
            )
            stats = isolated_database.pool_stats()
            assert stats["pool_available"] == 1
            assert stats["requests_waiting"] == 0
    finally:
        isolated_database.close()


def test_incremental_audit_verification_scans_only_checkpoint_anchors_and_tail(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        cursor = connection.cursor()
        insert_audit_row(
            cursor,
            organization_id="org-incremental-existing-anchor",
            action="anchor.before_checkpoint",
        )
        full_before = inspect_audit_chain(cursor)
        checkpoint = build_audit_checkpoint(
            cursor,
            hmac_key="test-incremental-audit-key-" + ("x" * 32),
            verification=full_before,
        )
        chain_id = "org-incremental-audit-verification"
        insert_audit_row(
            cursor,
            organization_id=chain_id,
            action="incremental.first",
            target_type="test",
            target_id="first",
        )
        insert_audit_row(
            cursor,
            organization_id=chain_id,
            action="incremental.second",
            target_type="test",
            target_id="second",
        )

        class TracingCursor:
            def __init__(self, wrapped):
                self.wrapped = wrapped
                self.statements = []

            def execute(self, statement, parameters=()):
                self.statements.append(" ".join(str(statement).split()))
                return self.wrapped.execute(statement, parameters)

        tracing = TracingCursor(cursor)
        incremental = inspect_audit_chain_incremental(
            tracing,
            checkpoint,
            hmac_key="test-incremental-audit-key-" + ("x" * 32),
        )
        full_after = inspect_audit_chain(cursor)

        assert incremental.valid
        assert incremental.row_count == full_after.row_count
        assert incremental.last_hash == full_after.last_hash
        assert incremental.heads == full_after.heads
        assert any("FROM audit_log WHERE id = ANY" in sql for sql in tracing.statements)
        assert any("FROM audit_log WHERE id >" in sql for sql in tracing.statements)
        assert not any("SELECT count(*) FROM audit_log" in sql for sql in tracing.statements)
        assert not any(
            "FROM audit_log ORDER BY chain_id, sequence" in sql
            for sql in tracing.statements
        )
    finally:
        connection.rollback()
        connection.close()


def test_incremental_audit_checkpoint_cannot_hide_anchor_rollback(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        cursor = connection.cursor()
        insert_audit_row(
            cursor,
            organization_id="org-incremental-anchor-rollback",
            action="anchor.created",
        )
        checkpoint = build_audit_checkpoint(
            cursor,
            hmac_key="test-incremental-audit-key-" + ("x" * 32),
        )
        anchor = next(
            head
            for head in checkpoint["heads"]
            if head["chainId"] == "org-incremental-anchor-rollback"
        )
        cursor.execute(
            "ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable"
        )
        cursor.execute("DELETE FROM audit_log WHERE id = ?", (anchor["id"],))

        incremental = inspect_audit_chain_incremental(
            cursor,
            checkpoint,
            hmac_key="test-incremental-audit-key-" + ("x" * 32),
        )
        full = inspect_audit_chain_against_checkpoint(
            cursor,
            checkpoint,
            hmac_key="test-incremental-audit-key-" + ("x" * 32),
        )

        assert not incremental.valid
        assert incremental.failure == "checkpoint_head_missing"
        assert not full.valid
    finally:
        connection.rollback()
        connection.close()


def test_async_document_submission_uses_durable_queue(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv(
        "DOCUMENT_WORKER_TEMP_DIR",
        str(tmp_path / "async-document-jobs"),
    )
    monkeypatch.setattr(
        document_worker,
        "_document_queue_database",
        lambda: postgres_database,
    )
    assert asyncio.run(
        document_worker.run_document_job_async(
            "test_delay",
            {"seconds": 0},
            timeout_seconds=5,
        )
    ) is True


def test_all_tenant_entity_keys_and_organization_columns_are_database_enforced(
    postgres_database: PostgresDatabase,
) -> None:
    expected_composite_tables = {
        table_name
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items()
        if table_spec.get("primary_keys") == ["organization_id", "id"]
    }
    assert expected_composite_tables
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        primary_key_rows = cursor.execute(
            """
            SELECT tables.table_name, columns.column_name
            FROM information_schema.table_constraints AS tables
            JOIN information_schema.key_column_usage AS columns
              ON columns.constraint_schema = tables.constraint_schema
             AND columns.constraint_name = tables.constraint_name
            WHERE tables.table_schema = current_schema()
              AND tables.constraint_type = 'PRIMARY KEY'
            ORDER BY tables.table_name, columns.ordinal_position
            """
        ).fetchall()
        primary_keys = {}
        for table_name, column_name in primary_key_rows:
            primary_keys.setdefault(table_name, []).append(column_name)
        for table_name in expected_composite_tables:
            assert primary_keys[table_name] == ["organization_id", "id"]

        nullable_tenant_columns = cursor.execute(
            """
            SELECT table_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND column_name = 'organization_id'
              AND table_name = ANY(?)
              AND is_nullable <> 'NO'
            """,
            (sorted(expected_composite_tables),),
        ).fetchall()
        assert nullable_tenant_columns == []

        with pytest.raises(psycopg.IntegrityError):
            cursor.execute(
                """INSERT INTO chu_dau_tu (id, owner_type, ten_chu_dau_tu)
                   VALUES (?, 'personal', ?)""",
                ("tenant-missing-org", "Must be rejected"),
            )
        connection.rollback()

        shared_id = "tenant-collision-core"
        cursor.executemany(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            [
                ("tenant-core-a", "Tenant Core A"),
                ("tenant-core-b", "Tenant Core B"),
            ],
        )
        cursor.executemany(
            """INSERT INTO chu_dau_tu
               (organization_id, id, owner_type, ten_chu_dau_tu)
               VALUES (?, ?, 'organization', ?)""",
            [
                ("tenant-core-a", shared_id, "Tenant A"),
                ("tenant-core-b", shared_id, "Tenant B"),
            ],
        )
        rows = cursor.execute(
            """SELECT organization_id, ten_chu_dau_tu
               FROM chu_dau_tu
               WHERE id = ?
               ORDER BY organization_id""",
            (shared_id,),
        ).fetchall()
        assert [tuple(row) for row in rows] == [
            ("tenant-core-a", "Tenant A"),
            ("tenant-core-b", "Tenant B"),
        ]
        cursor.execute("DELETE FROM chu_dau_tu WHERE id = ?", (shared_id,))
        cursor.execute(
            "DELETE FROM to_chuc WHERE id IN (?, ?)",
            ("tenant-core-a", "tenant-core-b"),
        )
        connection.commit()


def test_sql_and_api_timestamps_use_vietnam_timezone(
    postgres_database: PostgresDatabase,
) -> None:
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        assert cursor.execute("SHOW TIME ZONE").fetchone()[0] == VIETNAM_TIMEZONE_NAME
        row = cursor.execute(
            "SELECT CAST(? AS TIMESTAMPTZ), EXTRACT(EPOCH FROM CAST(? AS TIMESTAMPTZ))",
            ("2026-07-20 09:00:00", "2026-07-20 09:00:00"),
        ).fetchone()
        assert row[0] == "2026-07-20 09:00:00"
        expected_epoch = int(
            datetime(2026, 7, 20, 9, 0, tzinfo=ZoneInfo(VIETNAM_TIMEZONE_NAME)).timestamp()
        )
        assert int(row[1]) == expected_epoch

    with psycopg.connect(postgres_database.database_url) as raw_connection:
        assert raw_connection.execute("SHOW TIME ZONE").fetchone()[0] == VIETNAM_TIMEZONE_NAME

    assert vietnam_now().utcoffset().total_seconds() == 7 * 60 * 60


def test_recalculate_is_latest_never_updates_same_id_in_another_tenant(
    postgres_database: PostgresDatabase,
) -> None:
    shared_id = "tenant-recalculate-shared"
    with postgres_database.get_connection() as connection:
        cursor = connection.cursor()
        cursor.executemany(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            [
                ("tenant-recalculate-a", "Tenant Recalculate A"),
                ("tenant-recalculate-b", "Tenant Recalculate B"),
            ],
        )
        cursor.executemany(
            """INSERT INTO chu_dau_tu
               (organization_id, id, owner_type, ten_chu_dau_tu, is_latest)
               VALUES (?, ?, 'organization', ?, ?)""",
            [
                ("tenant-recalculate-a", shared_id, "Tenant A", 0),
                ("tenant-recalculate-b", shared_id, "Tenant B", 0),
            ],
        )

        recalculate_is_latest(
            cursor,
            "chu_dau_tu",
            "tenant-recalculate-a",
            affected_families=[shared_id],
        )

        rows = cursor.execute(
            """SELECT organization_id, is_latest
               FROM chu_dau_tu
               WHERE id = ?
               ORDER BY organization_id""",
            (shared_id,),
        ).fetchall()
        assert [tuple(row) for row in rows] == [
            ("tenant-recalculate-a", 1),
            ("tenant-recalculate-b", 0),
        ]
        cursor.execute(
            "DELETE FROM chu_dau_tu WHERE id = ?",
            (shared_id,),
        )
        cursor.execute(
            "DELETE FROM to_chuc WHERE id IN (?, ?)",
            ("tenant-recalculate-a", "tenant-recalculate-b"),
        )


def test_initialization_is_idempotent(postgres_database: PostgresDatabase) -> None:
    assert initialize_postgres_database(postgres_database) == DB_SCHEMA_VERSION


def test_transaction_rollback(postgres_database: PostgresDatabase) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        connection.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            ("org-rollback-test", "Rollback test"),
        )
        connection.rollback()
    finally:
        connection.close()
    with postgres_database.get_connection() as verification:
        assert verification.execute(
            "SELECT 1 FROM to_chuc WHERE id = ?", ("org-rollback-test",)
        ).fetchone() is None


def test_workspace_trigger_rejects_invalid_personal_owner(
    postgres_database: PostgresDatabase,
) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, ten_chu_dau_tu, ngay_ap_dung)
                   VALUES (?, ?, 'personal', ?, ?)""",
                ("cdt-invalid-owner", "personal:missing-user", "Invalid", "2026-07-19"),
            )
        connection.rollback()
    finally:
        connection.close()


def test_sync_versions_are_unique_under_concurrency(
    postgres_database: PostgresDatabase,
) -> None:
    organization_id = "org-concurrency-sync"
    with postgres_database.get_connection() as connection:
        connection.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (organization_id, "Concurrency sync"),
        )
        connection.execute(
            """INSERT INTO sync_metadata (organization_id, current_version)
               VALUES (?, 0) ON CONFLICT DO NOTHING""",
            (organization_id,),
        )

    def allocate(_: int) -> int:
        connection = postgres_database.get_connection()
        try:
            connection.execute("BEGIN")
            value = next_sync_version(connection.cursor(), organization_id)
            connection.commit()
            return value
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=16) as executor:
        values = list(executor.map(allocate, range(64)))
    assert len(set(values)) == 64
    assert sorted(values) == list(range(min(values), max(values) + 1))


def test_rate_limit_reservation_is_atomic_under_concurrency(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_service,
        "_get_rate_limit_database",
        lambda: postgres_database,
    )
    bucket = "test-atomic-rate-limit"

    def reserve(_: int) -> bool:
        return auth_service.get_rate_limit_decision(
            bucket,
            consume_attempt=True,
            max_attempts=5,
            window_seconds=60,
        ).allowed

    with ThreadPoolExecutor(max_workers=32) as executor:
        results = list(executor.map(reserve, range(100)))

    assert sum(results) == 5
    with postgres_database.get_connection() as connection:
        row = connection.execute(
            "SELECT attempt_count FROM rate_limit_buckets WHERE bucket_key = ?",
            (auth_service.rate_limit_bucket_hash(bucket),),
        ).fetchone()
        assert row is not None
        assert row[0] == 6


def test_partner_lookup_caches_positive_and_negative_results(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(partner_lookup_service, "database", postgres_database)
    with postgres_database.get_connection() as connection:
        connection.execute("DELETE FROM partner_lookup_cache")
        connection.execute("DELETE FROM partner_upstream_health")

    calls = {"muasamcong": 0, "vietqr": 0, "escodata": 0}

    def no_muasamcong(*_args, **_kwargs):
        calls["muasamcong"] += 1
        return None

    def vietqr_result(_tax_code):
        calls["vietqr"] += 1
        return {"name": "Cached business", "source": "VietQR"}

    def no_escodata(_tax_code):
        calls["escodata"] += 1
        return None

    monkeypatch.setattr(partner_lookup_service, "fetch_muasamcong_info", no_muasamcong)
    monkeypatch.setattr(partner_lookup_service, "fetch_vietqr_info", vietqr_result)
    monkeypatch.setattr(partner_lookup_service, "fetch_escodata_info", no_escodata)

    first = partner_lookup_service.lookup_partner_info("0100109106")
    second = partner_lookup_service.lookup_partner_info("0100109106")
    assert first == second
    assert first["name"] == "Cached business"
    assert calls == {"muasamcong": 1, "vietqr": 1, "escodata": 0}

    with postgres_database.get_connection() as connection:
        connection.execute("DELETE FROM partner_lookup_cache")
    calls.update({"muasamcong": 0, "vietqr": 0, "escodata": 0})

    def no_vietqr(_tax_code):
        calls["vietqr"] += 1
        return None

    monkeypatch.setattr(partner_lookup_service, "fetch_vietqr_info", no_vietqr)

    assert partner_lookup_service.lookup_partner_info("0100109107") is None
    assert partner_lookup_service.lookup_partner_info("0100109107") is None
    assert calls == {"muasamcong": 1, "vietqr": 1, "escodata": 1}

    with postgres_database.get_connection() as connection:
        rows = connection.execute(
            "SELECT found, result_json FROM partner_lookup_cache ORDER BY cache_key"
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["found"] == 0
    assert rows[0]["result_json"] is None


def test_muasamcong_tls_context_prefers_secure_ecdhe_without_weak_dhe() -> None:
    context = partner_lookup_service._create_muasamcong_ssl_context()
    cipher_names = {cipher["name"] for cipher in context.get_ciphers()}

    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert any(name.startswith("ECDHE-") for name in cipher_names)
    assert not any(name.startswith("DHE-") for name in cipher_names)


def test_partner_lookup_falls_back_to_tax_provider_when_muasamcong_is_unavailable(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(partner_lookup_service, "database", postgres_database)
    monkeypatch.setenv("PARTNER_UPSTREAM_MAX_ATTEMPTS", "1")
    with postgres_database.get_connection() as connection:
        connection.execute("DELETE FROM partner_lookup_cache")
        connection.execute("DELETE FROM partner_upstream_health")

    def unavailable_muasamcong(*_args, **_kwargs):
        try:
            raise TimeoutError("simulated TLS failure")
        except TimeoutError as error:
            raise partner_lookup_service.PartnerUpstreamError(
                "MuaSamCong unavailable"
            ) from error

    monkeypatch.setattr(
        partner_lookup_service,
        "fetch_muasamcong_info",
        unavailable_muasamcong,
    )
    monkeypatch.setattr(
        partner_lookup_service,
        "fetch_vietqr_info",
        lambda _tax_code: {
            "name": "Fallback business",
            "address": "Ha Noi",
            "source": "VietQR",
        },
    )
    monkeypatch.setattr(
        partner_lookup_service,
        "fetch_escodata_info",
        lambda _tax_code: None,
    )

    result = partner_lookup_service.lookup_partner_info(
        "0109965278",
        org_code="vn0109965278",
        role_name="NT",
    )

    assert result == {
        "name": "Fallback business",
        "address": "Ha Noi",
        "source": "VietQR",
        "tax_code": "0109965278",
        "org_code": "vn0109965278",
    }


def test_partner_lookup_circuit_breaker_opens_after_failures(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(partner_lookup_service, "database", postgres_database)
    monkeypatch.setenv("PARTNER_UPSTREAM_MAX_ATTEMPTS", "1")
    with postgres_database.get_connection() as connection:
        connection.execute("DELETE FROM partner_upstream_health")

    calls = 0

    def unavailable():
        nonlocal calls
        calls += 1
        try:
            raise TimeoutError("simulated timeout")
        except TimeoutError as error:
            raise partner_lookup_service.PartnerUpstreamError(
                "upstream unavailable"
            ) from error

    for _ in range(3):
        assert partner_lookup_service._call_upstream(
            "vietqr", unavailable
        ) == (False, None)
    assert partner_lookup_service._call_upstream(
        "vietqr", unavailable
    ) == (False, None)
    assert calls == 3

    with postgres_database.get_connection() as connection:
        health = connection.execute(
            """SELECT failure_count, opened_until
               FROM partner_upstream_health WHERE upstream = 'vietqr'"""
        ).fetchone()
    assert health["failure_count"] == 3
    assert health["opened_until"] > int(datetime.now().timestamp())


def test_partner_lookup_metrics_have_bounded_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metrics._reset_metrics_for_tests()
    metrics.record_partner_lookup("found")
    metrics.record_partner_upstream("vietqr", "timeout")
    monkeypatch.setattr(
        metrics,
        "_filesystem_metrics",
        lambda: {
            "postgres_database_bytes": 0,
            "postgres_pool": {},
            "websocket_outbox_rows": 0,
            "websocket_outbox_oldest_seconds": 0,
            "disk": {},
            "backup_timestamp": None,
            "backup_age": None,
            "restore_timestamp": None,
            "restore_age": None,
            "artifact_checked_at": 0,
        },
    )
    rendered = metrics.render_prometheus()
    assert (
        'biddingflow_partner_lookup_requests_total{outcome="found"} 1'
        in rendered
    )
    assert (
        'biddingflow_partner_upstream_requests_total{outcome="timeout",upstream="vietqr"} 1'
        in rendered
    )


def test_partner_lookup_bounds_concurrent_outbound_requests(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(partner_lookup_service, "database", postgres_database)
    monkeypatch.setattr(
        partner_lookup_service, "_outbound_slots", threading.BoundedSemaphore(2)
    )
    monkeypatch.setenv("PARTNER_LOOKUP_SLOT_TIMEOUT_SECONDS", "3")
    monkeypatch.setenv("PARTNER_UPSTREAM_MAX_ATTEMPTS", "1")
    with postgres_database.get_connection() as connection:
        connection.execute("DELETE FROM partner_lookup_cache")
        connection.execute("DELETE FROM partner_upstream_health")

    counter_lock = threading.Lock()
    active = 0
    max_active = 0

    def delayed_result(tax_code, org_code, role_name):
        nonlocal active, max_active
        with counter_lock:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.05)
            return {
                "name": f"Business {tax_code}",
                "source": "MuaSamCong",
                "org_code": org_code,
                "role": role_name,
            }
        finally:
            with counter_lock:
                active -= 1

    monkeypatch.setattr(
        partner_lookup_service, "fetch_muasamcong_info", delayed_result
    )
    tax_codes = [f"01001091{index:02d}" for index in range(8)]
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(partner_lookup_service.lookup_partner_info, tax_codes)
        )

    assert all(result and result["source"] == "MuaSamCong" for result in results)
    assert max_active == 2


def test_email_delivery_retries_and_marks_provider_acceptance(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "EMAIL_OUTBOX_ENCRYPTION_KEY",
        Fernet.generate_key().decode("ascii"),
    )
    user_id = "user-email-delivery-test"
    with postgres_database.get_connection() as connection:
        connection.execute(
            """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
                email, email_norm, da_xac_minh)
               VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1)
               ON CONFLICT (id) DO NOTHING""",
            (user_id, "emaildelivery", "emaildelivery", "test-hash", "Email Delivery", "delivery@example.test", "delivery@example.test"),
        )
        delivery_id = email_delivery_service.create_email_delivery(
            connection.cursor(),
            user_id=user_id,
            purpose="google_temporary_password",
            recipient="delivery@example.test",
            subject="Subject",
            html_body="sensitive temporary password",
        )

    results = iter([
        EmailDeliveryResult(False, "smtp", "SMTP_TEMPORARY_FAILURE"),
        EmailDeliveryResult(True, "smtp"),
    ])
    monkeypatch.setattr(email_delivery_service, "gui_email", lambda *_args, **_kwargs: next(results))
    monkeypatch.setattr(email_delivery_service.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(email_delivery_service.random, "uniform", lambda _left, _right: 0.0)

    assert not email_delivery_service.deliver_email_once(
        postgres_database,
        delivery_id,
    )
    assert email_delivery_service.retry_email_delivery(
        postgres_database,
        delivery_id,
    )

    with postgres_database.get_connection() as connection:
        row = connection.execute(
            """SELECT status, attempt_count, accepted_at,
                      recipient_ciphertext, subject_ciphertext, body_ciphertext
               FROM email_delivery_status WHERE id = ?""",
            (delivery_id,),
        ).fetchone()
        columns = {
            item[0]
            for item in connection.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'email_delivery_status'"""
            ).fetchall()
        }
    assert row["status"] == "sent"
    assert row["attempt_count"] == 2
    assert row["accepted_at"] is not None
    assert "delivery@example.test" not in row["recipient_ciphertext"]
    assert "Subject" not in row["subject_ciphertext"]
    assert "sensitive temporary password" not in row["body_ciphertext"]
    assert not {"recipient", "subject", "body", "password", "token"}.intersection(columns)


def test_rate_limit_resets_expired_window_and_clears_success(
    postgres_database: PostgresDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_service,
        "_get_rate_limit_database",
        lambda: postgres_database,
    )
    bucket = "test-expired-rate-limit"
    bucket_hash = auth_service.rate_limit_bucket_hash(bucket)
    with postgres_database.get_connection() as connection:
        connection.execute(
            """INSERT INTO rate_limit_buckets
               (bucket_key, window_started_at, attempt_count, expires_at)
               VALUES (?, 1, 5, 1)
               ON CONFLICT(bucket_key) DO UPDATE SET
                   window_started_at = 1, attempt_count = 5, expires_at = 1""",
            (bucket_hash,),
        )

    decision = auth_service.get_rate_limit_decision(
        bucket,
        consume_attempt=True,
        max_attempts=5,
        window_seconds=60,
    )
    assert decision.allowed
    assert decision.remaining == 4

    with postgres_database.get_connection() as connection:
        connection.execute("BEGIN")
        auth_service.clear_rate_limit_buckets(connection.cursor(), bucket)
        connection.commit()
        assert connection.execute(
            "SELECT 1 FROM rate_limit_buckets WHERE bucket_key = ?",
            (bucket_hash,),
        ).fetchone() is None


def test_rate_limit_storage_failure_is_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingDatabase:
        @staticmethod
        def get_connection():
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        auth_service,
        "_get_rate_limit_database",
        lambda: FailingDatabase(),
    )
    decision = auth_service.get_rate_limit_decision("test-storage-failure")
    assert not decision.allowed
    assert decision.storage_failed


def test_audit_chain_has_no_forks_under_concurrency(
    postgres_database: PostgresDatabase,
) -> None:
    chain_id = "org-concurrency-audit"

    def append(index: int) -> None:
        connection = postgres_database.get_connection()
        try:
            connection.execute("BEGIN")
            insert_audit_row(
                connection.cursor(),
                organization_id=chain_id,
                action="test.concurrent",
                target_type="test",
                target_id=str(index),
            )
            connection.commit()
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=16) as executor:
        list(executor.map(append, range(64)))

    with postgres_database.get_connection() as connection:
        verification = inspect_audit_chain(connection.cursor())
        assert verification.valid, verification.failure
        rows = connection.execute(
            "SELECT sequence FROM audit_log WHERE chain_id = ? ORDER BY sequence",
            (chain_id,),
        ).fetchall()
        assert [row[0] for row in rows] == list(range(1, 65))


def test_audit_rows_are_immutable(postgres_database: PostgresDatabase) -> None:
    connection = postgres_database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute("SELECT id FROM audit_log LIMIT 1").fetchone()
        assert row is not None
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("DELETE FROM audit_log WHERE id = ?", (row[0],))
        connection.rollback()
    finally:
        connection.close()


def test_configured_runtime_role_has_no_ddl_privilege() -> None:
    runtime_url = os.environ.get("RUNTIME_DATABASE_URL", "").strip()
    if not runtime_url:
        pytest.skip("RUNTIME_DATABASE_URL is not configured")
    with psycopg.connect(runtime_url) as connection:
        assert connection.execute("SELECT 1").fetchone()[0] == 1
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TABLE runtime_role_must_not_create(id int)")
        connection.rollback()
