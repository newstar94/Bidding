"""Validate and activate one expert-approved AI knowledge document."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.ai.knowledge import (  # noqa: E402
    KnowledgeIngestionError,
    ingest_approved_document,
    prepare_document,
)
from backend.db.db_helper import PostgresDatabase  # noqa: E402
from scripts.env_utils import load_env  # noqa: E402


def _metadata(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise KnowledgeIngestionError("Không thể đọc metadata JSON hợp lệ.") from exc
    if not isinstance(value, dict):
        raise KnowledgeIngestionError("Metadata JSON phải là object.")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Đưa một tài liệu đã được chuyên gia duyệt vào kho RAG BiddingFlow."
    )
    parser.add_argument("--file", type=Path, required=True, help="Tệp .md, .txt hoặc .docx")
    parser.add_argument("--metadata", type=Path, required=True, help="Tệp metadata JSON")
    approver = parser.add_mutually_exclusive_group()
    approver.add_argument("--approved-by", help="ID tài khoản người phê duyệt trong BiddingFlow")
    approver.add_argument(
        "--approved-by-username",
        help="Tên đăng nhập của người phê duyệt; script sẽ tra ID trong database",
    )
    approver.add_argument(
        "--approved-by-sole-super-admin",
        action="store_true",
        help="Bootstrap local: chỉ dùng khi database có đúng một Super Admin",
    )
    parser.add_argument("--database-url", help="PostgreSQL URL; mặc định lấy từ .env")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chỉ kiểm tra và chia đoạn, không ghi database",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_env(ROOT)
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        metadata = _metadata(args.metadata.resolve())
        prepared = prepare_document(args.file.resolve(), metadata)
        if args.dry_run:
            print(
                json.dumps(
                    {
                        "valid": True,
                        "contentHash": prepared.content_hash,
                        "chunkCount": len(prepared.chunks),
                        "documentType": prepared.metadata["document_type"],
                        "organizationId": prepared.metadata["organization_id"],
                    },
                    ensure_ascii=False,
                )
            )
            return 0
        approved_by = str(args.approved_by or "").strip()
        approved_by_username = str(args.approved_by_username or "").strip()
        if not approved_by and not approved_by_username and not args.approved_by_sole_super_admin:
            parser.error(
                "phải chỉ định người phê duyệt khi không dùng --dry-run"
            )
        database_url = str(
            args.database_url
            or os.environ.get("MIGRATOR_DATABASE_URL")
            or os.environ.get("DATABASE_URL")
            or ""
        ).strip()
        if not database_url:
            parser.error("DATABASE_URL chưa được cấu hình")
        database = PostgresDatabase(database_url)
        try:
            with database.get_connection() as connection:
                if approved_by_username:
                    approver = connection.execute(
                        """SELECT id FROM tai_khoan
                           WHERE lower(trim(ten_dang_nhap)) = lower(trim(?))
                           LIMIT 1""",
                        (approved_by_username,),
                    ).fetchone()
                    if not approver:
                        raise KnowledgeIngestionError(
                            "Không tìm thấy tài khoản người phê duyệt."
                        )
                    approved_by = str(approver[0])
                elif args.approved_by_sole_super_admin:
                    approvers = connection.execute(
                        """SELECT id FROM tai_khoan
                           WHERE lower(trim(vai_tro)) = 'super_admin'
                           ORDER BY created_at ASC, id ASC
                           LIMIT 2"""
                    ).fetchall()
                    if len(approvers) != 1:
                        raise KnowledgeIngestionError(
                            "Bootstrap yêu cầu database có đúng một Super Admin."
                        )
                    approved_by = str(approvers[0][0])
                result = ingest_approved_document(
                    connection.cursor(),
                    args.file.resolve(),
                    metadata,
                    approved_by=approved_by,
                )
        finally:
            database.close()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except KnowledgeIngestionError as exc:
        print(f"Từ chối ingestion: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
