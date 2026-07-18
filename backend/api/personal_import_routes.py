from starlette.responses import JSONResponse

from backend.db.id_utils import generate_record_id
from backend.shared.helpers import database, get_active_org, log_audit, verify_session
from backend.shared.access_policy import is_business_organization, is_organization_manager
from backend.shared.request_validation import read_json_object
from backend.sync.repository import next_sync_version
from backend.shared.workspace_scope import personal_scope_id


EXPERT_FIELDS = (
    "ho_ten", "so_chung_chi", "ngay_cap_chung_chi", "don_vi_cap_chung_chi",
    "so_cccd", "ngay_cap_cccd", "noi_cap_cccd",
)


def _personal_workspace_id(cursor, user_id):
    del cursor
    return personal_scope_id(user_id)


def _expert_payload(row):
    return {key: row[key] for key in ("id", *EXPERT_FIELDS)}


async def preview_personal_experts_api(request):
    valid, session = verify_session(request)
    if not valid:
        return JSONResponse({"error": session}, status_code=403)
    target_org = get_active_org(request, session.user_id)
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        if not is_business_organization(cursor, target_org):
            return JSONResponse({"error": "Chỉ có thể nhập dữ liệu vào tổ chức."}, status_code=409)
        personal_org = _personal_workspace_id(cursor, session.user_id)
        if not personal_org:
            return JSONResponse({"items": []})
        sources = cursor.execute(
            """SELECT * FROM chuyen_gia WHERE organization_id = ?
               AND is_latest = 1 AND archived_at IS NULL ORDER BY lower(ho_ten), id""",
            (personal_org,),
        ).fetchall()
        items = []
        for source in sources:
            conflict = None
            if str(source["so_cccd"] or "").strip():
                conflict = cursor.execute(
                    """SELECT * FROM chuyen_gia WHERE organization_id = ? AND is_latest = 1
                       AND archived_at IS NULL AND trim(so_cccd) = trim(?) LIMIT 1""",
                    (target_org, source["so_cccd"]),
                ).fetchone()
            items.append({
                "source": _expert_payload(source),
                "status": "conflict" if conflict else "new",
                "matchReason": "so_cccd" if conflict else None,
                "organizationExpert": _expert_payload(conflict) if conflict else None,
            })
        return JSONResponse({"items": items})
    finally:
        conn.close()


async def import_personal_experts_api(request):
    valid, session = verify_session(request)
    if not valid:
        return JSONResponse({"error": session}, status_code=403)
    payload, error = await read_json_object(request)
    if error is not None:
        return error
    decisions = payload.get("decisions")
    if not isinstance(decisions, list) or not decisions:
        return JSONResponse({"error": "Thiếu quyết định nhập dữ liệu."}, status_code=400)
    target_org = get_active_org(request, session.user_id)
    conn = database.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.cursor()
        if not is_business_organization(cursor, target_org):
            conn.rollback()
            return JSONResponse({"error": "Chỉ có thể nhập dữ liệu vào tổ chức."}, status_code=409)
        if not is_organization_manager(cursor, str(session), session.user_id, target_org):
            conn.rollback()
            return JSONResponse({"error": "Chỉ quản lý tổ chức được nhập hoặc gộp dữ liệu cá nhân."}, status_code=403)
        personal_org = _personal_workspace_id(cursor, session.user_id)
        sync_version = next_sync_version(cursor, target_org)
        result = {"copied": 0, "filled": 0, "linked": 0, "skipped": 0}
        for decision in decisions:
            source_id = str(decision.get("sourceId") or "").strip()
            action = str(decision.get("action") or "skip").strip()
            source = cursor.execute(
                """SELECT * FROM chuyen_gia WHERE id = ? AND organization_id = ?
                   AND is_latest = 1 AND archived_at IS NULL""",
                (source_id, personal_org),
            ).fetchone()
            if not source or action == "skip":
                result["skipped"] += 1
                continue
            conflict = None
            if str(source["so_cccd"] or "").strip():
                conflict = cursor.execute(
                    """SELECT * FROM chuyen_gia WHERE organization_id = ? AND is_latest = 1
                       AND archived_at IS NULL AND trim(so_cccd) = trim(?) LIMIT 1""",
                    (target_org, source["so_cccd"]),
                ).fetchone()
            if conflict:
                if action == "use_organization":
                    result["linked"] += 1
                    continue
                if action != "fill_missing":
                    conn.rollback()
                    return JSONResponse({"error": f"Chuyên gia {source['ho_ten']} đã trùng CCCD trong tổ chức."}, status_code=409)
                updates = {field: source[field] for field in EXPERT_FIELDS if not conflict[field] and source[field]}
                if updates:
                    assignments = ", ".join(f"{field} = ?" for field in updates)
                    cursor.execute(
                        f"UPDATE chuyen_gia SET {assignments}, sync_version = ?, updated_at = datetime('now') WHERE id = ? AND organization_id = ?",
                        (*updates.values(), sync_version, conflict["id"], target_org),
                    )
                result["filled"] += 1
                continue
            if action != "copy":
                result["skipped"] += 1
                continue
            new_id = generate_record_id("chuyen_gia")
            values = [source[field] for field in EXPERT_FIELDS]
            cursor.execute(
                f"""INSERT INTO chuyen_gia
                    (id, organization_id, owner_type, id_goc, phien_ban, is_latest, {', '.join(EXPERT_FIELDS)}, sync_version)
                    VALUES (?, ?, 'organization', ?, '00', 1, {', '.join('?' for _ in EXPERT_FIELDS)}, ?)""",
                (new_id, target_org, new_id, *values, sync_version),
            )
            result["copied"] += 1
        log_audit(
            "organization.personal_experts_imported", actor_user_id=session.user_id,
            organization_id=target_org, target_type="chuyen_gia", request=request,
            metadata=result, cursor=cursor, required=True,
        )
        conn.commit()
        return JSONResponse({"success": True, **result})
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
