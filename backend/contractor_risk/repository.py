"""PostgreSQL persistence for normalized provider cache and risk snapshots."""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from backend.contractor_risk.types import (
    DurationUnit,
    IdentityMatchType,
    NormalizedViolationRecord,
    ViolationCategory,
    ViolationProviderResult,
    ViolationStatus,
)
from backend.contractor_risk.violation_rules import (
    normalize_identity_code,
    normalize_tax_code,
)
from backend.shared.date_utils import (
    VIETNAM_TIMEZONE,
    parse_datetime_value,
    vietnam_now_sql,
)
from backend.shared.logging_utils import log_audit


@dataclass(frozen=True, slots=True)
class ResolutionContext:
    organization_id: str
    package_id: str
    lot_id: str | None
    opening_id: str | None
    member_id: str | None
    contractor_id: str | None
    bid_closing_at: datetime | None
    contractor_identifier: str
    tax_code: str
    contractor_name: str


def _record_from_json(value: dict[str, Any]) -> NormalizedViolationRecord:
    def parsed_date(key):
        raw = value.get(key)
        parsed = parse_datetime_value(raw)
        if parsed is None:
            return None
        return parsed if "T" in str(raw) or ":" in str(raw) else parsed.date()

    duration_unit = value.get("duration_unit")
    return NormalizedViolationRecord(
        category=ViolationCategory(value["category"]),
        contractor_identifier=str(value.get("contractor_identifier") or ""),
        tax_code=str(value.get("tax_code") or ""),
        decision_number=str(value.get("decision_number") or ""),
        issued_date=parsed_date("issued_date"),
        effective_from=parsed_date("effective_from"),
        effective_to=parsed_date("effective_to"),
        behavior_date=parsed_date("behavior_date"),
        duration=(
            int(value["duration"])
            if value.get("duration") not in (None, "")
            else None
        ),
        duration_unit=DurationUnit(duration_unit) if duration_unit else None,
        source_status=str(value.get("source_status") or ""),
        is_revoked=bool(value.get("is_revoked")),
        is_applicable=value.get("is_applicable", True) is not False,
        requires_review=bool(value.get("requires_review")),
    )


def _serialize_records(records) -> str:
    return json.dumps(
        [record.to_json_value() for record in records],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _deserialize_records(raw: object) -> tuple[NormalizedViolationRecord, ...]:
    try:
        values = json.loads(str(raw or "[]"))
        if not isinstance(values, list):
            return ()
        return tuple(
            _record_from_json(value) for value in values if isinstance(value, dict)
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return ()


def _cache_key(provider, contractor_identifier, tax_code, schema_version):
    material = "\0".join(
        (
            str(provider or ""),
            normalize_identity_code(contractor_identifier),
            normalize_tax_code(tax_code),
            str(schema_version or ""),
        )
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _as_aware(value) -> datetime | None:
    parsed = value if isinstance(value, datetime) else parse_datetime_value(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=VIETNAM_TIMEZONE)
    return parsed.astimezone(VIETNAM_TIMEZONE)


class ContractorRiskRepository:
    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.cursor()

    def load_resolution_context(
        self,
        *,
        organization_id: str,
        package_id: str,
        opening_id: str | None,
        member_id: str | None,
        requested_identifier: str,
        lot_id: str | None = None,
    ) -> ResolutionContext:
        package = self.cursor.execute(
            """SELECT id, thoi_gian_dong_thau
               FROM goi_thau
               WHERE organization_id = ? AND id = ? AND archived_at IS NULL""",
            (organization_id, package_id),
        ).fetchone()
        if not package:
            raise LookupError("PACKAGE_NOT_FOUND")
        closing_values = [package["thoi_gian_dong_thau"]]
        closing_values.extend(
            row[0]
            for row in self.cursor.execute(
                """SELECT thoi_gian_dong_thau FROM goi_thau_gia_han
                   WHERE organization_id = ? AND goi_thau_id = ?""",
                (organization_id, package_id),
            ).fetchall()
        )
        parsed_closings = [
            parsed for value in closing_values if (parsed := _as_aware(value))
        ]
        bid_closing_at = max(parsed_closings, default=None)

        opening = None
        if opening_id:
            opening = self.cursor.execute(
                """SELECT opening.id, opening.nha_thau_id, opening.ma_phan_lo,
                          opening.ma_dinh_danh, opening.ten_nha_thau,
                          contractor.ma_nha_thau, contractor.ma_so_thue,
                          contractor.ten_nha_thau AS contractor_name
                   FROM thong_tin_mo_thau AS opening
                   LEFT JOIN nha_thau AS contractor
                     ON contractor.organization_id = opening.organization_id
                    AND contractor.id = opening.nha_thau_id
                   WHERE opening.organization_id = ? AND opening.goi_thau_id = ?
                     AND opening.id = ? AND opening.archived_at IS NULL""",
                (organization_id, package_id, opening_id),
            ).fetchone()
        if member_id:
            if not opening:
                raise LookupError("BID_OPENING_NOT_FOUND")
            member = self.cursor.execute(
                """SELECT member.id, member.thanh_vien_nha_thau_id,
                          member.ma_nha_thau, member.ma_so_thue,
                          member.ten_nha_thau,
                          contractor.ma_nha_thau AS contractor_identifier,
                          contractor.ma_so_thue AS contractor_tax_code,
                          contractor.ten_nha_thau AS contractor_name
                   FROM thong_tin_mo_thau_lien_danh_thanh_vien AS member
                   LEFT JOIN nha_thau AS contractor
                     ON contractor.organization_id = member.organization_id
                    AND contractor.id = member.thanh_vien_nha_thau_id
                   WHERE member.organization_id = ?
                     AND member.thong_tin_mo_thau_id = ? AND member.id = ?""",
                (organization_id, opening_id, member_id),
            ).fetchone()
            if not member:
                raise LookupError("JOINT_VENTURE_MEMBER_NOT_FOUND")
            contractor_id = member["thanh_vien_nha_thau_id"]
            identifier = (
                member["contractor_identifier"]
                or member["ma_nha_thau"]
                or requested_identifier
            )
            tax_code = member["contractor_tax_code"] or member["ma_so_thue"] or ""
            name = member["contractor_name"] or member["ten_nha_thau"] or ""
        elif opening:
            contractor_id = opening["nha_thau_id"]
            identifier = (
                opening["ma_nha_thau"]
                or opening["ma_dinh_danh"]
                or requested_identifier
            )
            tax_code = opening["ma_so_thue"] or ""
            name = opening["contractor_name"] or opening["ten_nha_thau"] or ""
        else:
            contractor = self.find_contractor(
                organization_id=organization_id,
                identifier=requested_identifier,
            )
            contractor_id = contractor["id"] if contractor else None
            identifier = (
                contractor["ma_nha_thau"] if contractor else requested_identifier
            )
            tax_code = contractor["ma_so_thue"] if contractor else ""
            name = contractor["ten_nha_thau"] if contractor else ""

        resolved_lot_id = lot_id
        if lot_id:
            valid_lot = self.cursor.execute(
                """SELECT id FROM goi_thau_phan_lo
                   WHERE organization_id = ? AND goi_thau_id = ? AND id = ?
                     AND archived_at IS NULL""",
                (organization_id, package_id, lot_id),
            ).fetchone()
            if not valid_lot:
                raise LookupError("LOT_NOT_FOUND")
        elif opening and opening["ma_phan_lo"]:
            lot = self.cursor.execute(
                """SELECT id FROM goi_thau_phan_lo
                   WHERE organization_id = ? AND goi_thau_id = ?
                     AND ma_phan_lo_normalized = lower(trim(?))
                     AND archived_at IS NULL LIMIT 1""",
                (organization_id, package_id, opening["ma_phan_lo"]),
            ).fetchone()
            resolved_lot_id = lot[0] if lot else None

        return ResolutionContext(
            organization_id=organization_id,
            package_id=package_id,
            lot_id=resolved_lot_id,
            opening_id=opening["id"] if opening else None,
            member_id=member_id,
            contractor_id=contractor_id,
            bid_closing_at=bid_closing_at,
            contractor_identifier=str(identifier or requested_identifier).strip(),
            tax_code=str(tax_code or "").strip(),
            contractor_name=str(name or "").strip(),
        )

    def find_contractor(self, *, organization_id: str, identifier: str):
        normalized = normalize_identity_code(identifier)
        if not normalized:
            return None
        rows = self.cursor.execute(
            """SELECT id, ma_nha_thau, ma_so_thue, ten_nha_thau
               FROM nha_thau
               WHERE organization_id = ? AND archived_at IS NULL
                 AND is_latest = 1""",
            (organization_id,),
        ).fetchall()
        return next(
            (
                row
                for row in rows
                if normalize_identity_code(row["ma_nha_thau"]) == normalized
                or normalize_tax_code(row["ma_so_thue"]) == normalized
            ),
            None,
        )

    def get_cached_provider_result(
        self,
        *,
        provider: str,
        contractor_identifier: str,
        tax_code: str,
        schema_version: str,
    ) -> ViolationProviderResult | None:
        key = _cache_key(provider, contractor_identifier, tax_code, schema_version)
        row = self.cursor.execute(
            """SELECT records_json, payload_hash FROM contractor_violation_cache
               WHERE cache_key = ? AND expires_at > ?""",
            (key, int(time.time())),
        ).fetchone()
        if not row:
            return None
        return ViolationProviderResult(
            records=_deserialize_records(row["records_json"]),
            provider=provider,
            schema_version=schema_version,
            payload_hash=str(row["payload_hash"] or ""),
        )

    def put_cached_provider_result(
        self,
        result: ViolationProviderResult,
        *,
        contractor_identifier: str,
        tax_code: str,
    ) -> None:
        ttl = max(
            60,
            min(
                7 * 86400,
                int(os.environ.get("VNEPS_VIOLATION_CACHE_SECONDS", "21600")),
            ),
        )
        key = _cache_key(
            result.provider,
            contractor_identifier,
            tax_code,
            result.schema_version,
        )
        self.cursor.execute(
            """INSERT INTO contractor_violation_cache (
                   cache_key, provider, contractor_identifier, tax_code,
                   response_schema_version, records_json, payload_hash,
                   expires_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(cache_key) DO UPDATE SET
                   records_json = excluded.records_json,
                   payload_hash = excluded.payload_hash,
                   expires_at = excluded.expires_at,
                   updated_at = CURRENT_TIMESTAMP""",
            (
                key,
                result.provider,
                contractor_identifier,
                tax_code or None,
                result.schema_version,
                _serialize_records(result.records),
                result.payload_hash,
                int(time.time()) + ttl,
            ),
        )

    def latest_snapshot_result(
        self,
        context: ResolutionContext,
        *,
        contractor_identifier: str,
        tax_code: str,
    ) -> ViolationProviderResult | None:
        if not context.opening_id:
            return None
        row = self.cursor.execute(
            """SELECT contractor_identifier, tax_code, source_provider,
                      source_payload_hash, source_records_json
               FROM contractor_violation_checks
               WHERE organization_id = ? AND bid_opening_record_id = ?
                 AND COALESCE(joint_venture_member_id, '') = COALESCE(?, '')
               ORDER BY checked_at DESC, created_at DESC LIMIT 1""",
            (context.organization_id, context.opening_id, context.member_id),
        ).fetchone()
        if not row:
            return None
        if (
            normalize_identity_code(row["contractor_identifier"])
            != normalize_identity_code(contractor_identifier)
            or (
                tax_code
                and row["tax_code"]
                and normalize_tax_code(row["tax_code"]) != normalize_tax_code(tax_code)
            )
        ):
            return None
        records = _deserialize_records(row["source_records_json"])
        if not records and str(row["source_records_json"] or "").strip() not in {"", "[]"}:
            return None
        return ViolationProviderResult(
            records=records,
            provider=str(row["source_provider"] or "MuaSamCong"),
            schema_version="1",
            payload_hash=str(row["source_payload_hash"] or ""),
        )

    def save_snapshot(
        self,
        context: ResolutionContext,
        *,
        actor_user_id: str,
        status: ViolationStatus,
        match_type: IdentityMatchType,
        rule_version: str,
        result: ViolationProviderResult | None,
        contractor_identifier: str,
        tax_code: str,
        request=None,
    ) -> None:
        if not context.opening_id:
            return
        now = vietnam_now_sql()
        if context.member_id:
            # Serialize member snapshots so two concurrent lookups cannot let a
            # later non-violating member overwrite a confirmed JV aggregate.
            locked = self.cursor.execute(
                """SELECT 1 FROM thong_tin_mo_thau
                   WHERE organization_id = ? AND id = ? FOR UPDATE""",
                (context.organization_id, context.opening_id),
            ).fetchone()
            if not locked:
                raise LookupError("BID_OPENING_NOT_FOUND")
        check_id = f"contractor-risk-{uuid.uuid4()}"
        self.cursor.execute(
            """INSERT INTO contractor_violation_checks (
                   id, organization_id, package_id, lot_id,
                   bid_opening_record_id, contractor_id,
                   joint_venture_member_id, contractor_identifier, tax_code,
                   bid_closing_at, checked_at, status, matched_identity_type,
                   rule_version, source_provider, source_payload_hash,
                   source_records_json, is_stale, created_by, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)""",
            (
                check_id,
                context.organization_id,
                context.package_id,
                context.lot_id,
                context.opening_id,
                context.contractor_id,
                context.member_id,
                contractor_identifier,
                tax_code or None,
                context.bid_closing_at,
                now,
                status.value,
                match_type.value,
                rule_version,
                result.provider if result else "MuaSamCong",
                result.payload_hash if result else "",
                _serialize_records(result.records) if result else "[]",
                actor_user_id,
                now,
                now,
            ),
        )
        if context.member_id:
            self.cursor.execute(
                """UPDATE thong_tin_mo_thau_lien_danh_thanh_vien
                   SET violation_status = ?, violation_bid_closing_at = ?,
                       violation_checked_at = ?
                   WHERE organization_id = ? AND thong_tin_mo_thau_id = ? AND id = ?""",
                (
                    status.value,
                    context.bid_closing_at,
                    now,
                    context.organization_id,
                    context.opening_id,
                    context.member_id,
                ),
            )
            self._refresh_joint_venture_status(context, now)
        else:
            self.cursor.execute(
                """UPDATE thong_tin_mo_thau
                   SET violation_status = ?, violation_bid_closing_at = ?,
                       violation_checked_at = ?
                   WHERE organization_id = ? AND id = ?""",
                (
                    status.value,
                    context.bid_closing_at,
                    now,
                    context.organization_id,
                    context.opening_id,
                ),
            )
        log_audit(
            "contractor.violation_checked",
            actor_user_id=actor_user_id,
            organization_id=context.organization_id,
            target_type="thong_tin_mo_thau",
            target_id=context.opening_id,
            request=request,
            metadata={
                "packageId": context.package_id,
                "lotId": context.lot_id,
                "memberId": context.member_id,
                "contractorId": context.contractor_id,
                "checkedAt": now,
                "bidClosingAt": context.bid_closing_at.isoformat()
                if context.bid_closing_at
                else None,
                "status": status.value,
                "provider": result.provider if result else "MuaSamCong",
                "ruleVersion": rule_version,
                "sourcePayloadHash": result.payload_hash if result else "",
                "lookupSuccess": status != ViolationStatus.LOOKUP_FAILED,
            },
            cursor=self.cursor,
            required=True,
        )

    def _refresh_joint_venture_status(self, context: ResolutionContext, now: str):
        statuses = [
            str(row[0] or ViolationStatus.NOT_CHECKED.value)
            for row in self.cursor.execute(
                """SELECT violation_status
                   FROM thong_tin_mo_thau_lien_danh_thanh_vien
                   WHERE organization_id = ? AND thong_tin_mo_thau_id = ?""",
                (context.organization_id, context.opening_id),
            ).fetchall()
        ]
        precedence = (
            ViolationStatus.VIOLATION_CONFIRMED,
            ViolationStatus.IDENTITY_CONFLICT,
            ViolationStatus.REVIEW_REQUIRED,
            ViolationStatus.LOOKUP_FAILED,
            ViolationStatus.NOT_CHECKED,
            ViolationStatus.NO_ACTIVE_VIOLATION,
        )
        aggregate = next(
            (status for status in precedence if status.value in statuses),
            ViolationStatus.NOT_CHECKED,
        )
        self.cursor.execute(
            """UPDATE thong_tin_mo_thau
               SET violation_status = ?, violation_bid_closing_at = ?,
                   violation_checked_at = ?
               WHERE organization_id = ? AND id = ?""",
            (
                aggregate.value,
                context.bid_closing_at,
                now,
                context.organization_id,
                context.opening_id,
            ),
        )
