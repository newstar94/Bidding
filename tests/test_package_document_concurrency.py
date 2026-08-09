from uuid import uuid4

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor
from backend.documents import package_document_service
from backend.documents.package_document_policy import allowed_upload_types
from tests.test_member_quota_concurrency import _connect, _test_database_url
from tests.test_sync_conflict_authorization import _seed_denied_package


@pytest.mark.parametrize("document_action", ["upload", "delete"])
def test_package_lifecycle_transition_cannot_overtake_document_mutation(
    document_action,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        setup_connection = _connect(database_url)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")
    try:
        setup_cursor = PostgresCursor(setup_connection.cursor())
        organization_id, _employee_id, package_id = _seed_denied_package(
            setup_cursor
        )
        member_ids = [
            str(row[0])
            for row in setup_cursor.execute(
                """SELECT user_id FROM thanh_vien_to_chuc
                   WHERE organization_id = ?""",
                (organization_id,),
            ).fetchall()
        ]
        package = package_document_service.load_package(
            setup_cursor, organization_id, package_id
        )
        if document_action == "delete":
            package_document_service.upsert_package_document(
                setup_cursor,
                organization_id=organization_id,
                package=package,
                document_type="HSMT",
                original_filename="before.pdf",
                storage_key=f"race/{uuid4().hex}.pdf",
                content_type="application/pdf",
                size_bytes=100,
                sha256="a" * 64,
                uploaded_by_id=None,
            )
        setup_connection.commit()
    finally:
        setup_connection.close()

    document_connection = _connect(database_url)
    lifecycle_connection = _connect(database_url)
    try:
        document_cursor = PostgresCursor(document_connection.cursor())
        lifecycle_cursor = PostgresCursor(lifecycle_connection.cursor())
        mutation_loader = getattr(
            package_document_service,
            "load_package_for_document_mutation",
            package_document_service.load_package,
        )
        package = mutation_loader(
            document_cursor,
            organization_id,
            package_id,
        )
        assert "HSMT" in allowed_upload_types(package)

        lifecycle_cursor.execute("SET LOCAL lock_timeout = '250ms'")
        transition_blocked = False
        try:
            lifecycle_cursor.execute(
                """UPDATE goi_thau
                   SET trang_thai = 'CANCELLED', row_version = row_version + 1
                   WHERE organization_id = ? AND id = ?""",
                (organization_id, package_id),
            )
            lifecycle_connection.commit()
        except psycopg.errors.LockNotAvailable:
            lifecycle_connection.rollback()
            transition_blocked = True

        if document_action == "upload":
            package_document_service.upsert_package_document(
                document_cursor,
                organization_id=organization_id,
                package=package,
                document_type="HSMT",
                original_filename="after.pdf",
                storage_key=f"race/{uuid4().hex}.pdf",
                content_type="application/pdf",
                size_bytes=200,
                sha256="b" * 64,
                uploaded_by_id=None,
            )
        else:
            package_document_service.delete_package_document(
                document_cursor,
                organization_id,
                package_id,
                "HSMT",
            )
        document_connection.commit()

        if transition_blocked:
            lifecycle_cursor.execute(
                """UPDATE goi_thau
                   SET trang_thai = 'CANCELLED', row_version = row_version + 1
                   WHERE organization_id = ? AND id = ?""",
                (organization_id, package_id),
            )
            lifecycle_connection.commit()

        verification_connection = _connect(database_url)
        try:
            status = verification_connection.execute(
                """SELECT trang_thai FROM goi_thau
                   WHERE organization_id = %s AND id = %s""",
                (organization_id, package_id),
            ).fetchone()[0]
            document_count = verification_connection.execute(
                """SELECT count(*) FROM tai_lieu_goi_thau
                   WHERE organization_id = %s AND goi_thau_id = %s
                     AND document_type = 'HSMT'""",
                (organization_id, package_id),
            ).fetchone()[0]
        finally:
            verification_connection.close()
        assert transition_blocked
        assert status == "CANCELLED"
        assert document_count == (1 if document_action == "upload" else 0)
    finally:
        document_connection.rollback()
        document_connection.close()
        lifecycle_connection.rollback()
        lifecycle_connection.close()
        cleanup_connection = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup_connection.cursor())
            cursor.execute(
                "DELETE FROM tai_lieu_goi_thau WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM phan_cong_nhan_su WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM goi_thau WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM ke_hoach_lcnt WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM chu_dau_tu WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            for user_id in member_ids:
                cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (user_id,))
            cleanup_connection.commit()
        finally:
            cleanup_connection.close()
