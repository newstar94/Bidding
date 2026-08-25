"""Starlette adapters for commercial administration, offers and quotes."""

from __future__ import annotations

from hashlib import sha256
import json
import time

from starlette.responses import JSONResponse, Response

from backend.auth.auth_helper import verify_session, verify_session_in_transaction
from backend.db.db_helper import database
from backend.billing.service import public_order_payload
from backend.shared.logging_utils import log_audit, log_error

from .config import commercial_runtime_config
from .document import canonical_json
from .errors import CommercialPolicyError, QUOTE_NOT_AVAILABLE
from .repository import CommercialRepository, new_id
from .service import CommercialPolicy
from .metrics import commercial_health_snapshot


def _error_response(error):
    if isinstance(error, CommercialPolicyError):
        return JSONResponse(
            {
                "error": error.message,
                "code": error.code,
                "details": error.details,
            },
            status_code=error.status_code,
        )
    return JSONResponse(
        {"error": "Không thể xử lý cấu hình thương mại.", "code": "COMMERCIAL_POLICY_INVALID"},
        status_code=500,
    )


async def _json_body(request):
    try:
        value = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID", "JSON không hợp lệ.", status_code=400
        )
    if not isinstance(value, dict):
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID", "Payload phải là object.", status_code=400
        )
    return value


def _expected_revision(request, body):
    value = body.get("expectedRevision")
    if value is None:
        tag = str(request.headers.get("If-Match") or "").strip().strip('"')
        value = tag or None
    if isinstance(value, bool):
        value = None
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID",
            "Thiếu expected revision hợp lệ.",
            status_code=400,
        )
    if value <= 0:
        raise CommercialPolicyError(
            "COMMERCIAL_POLICY_INVALID",
            "Expected revision phải dương.",
            status_code=400,
        )
    return value


def _draft_payload(draft):
    if not draft:
        return None
    return {
        "id": draft["id"],
        "baseReleaseId": draft.get("base_release_id"),
        "status": draft["status"],
        "revision": draft["revision"],
        "checksum": draft["checksum"],
        "validationDigest": draft.get("validation_digest"),
        "validationRevision": draft.get("validation_revision"),
        "readinessExpiresAt": draft.get("readiness_expires_at"),
        "validation": draft.get("validation"),
        "document": draft["document"],
        "createdAt": draft.get("created_at"),
        "updatedAt": draft.get("updated_at"),
    }


def _release_payload(release):
    if not release:
        return None
    return {
        "id": release["id"],
        "versionLabel": release["version_label"],
        "checksum": release["checksum"],
        "mode": release["mode"],
        "scopeKey": release["scope_key"],
        "effectiveFrom": release["effective_from"],
        "nonSellable": bool(release["non_sellable"]),
        "baseReleaseId": release.get("base_release_id"),
        "reason": release["reason"],
        "createdAt": release.get("created_at"),
    }


async def commercial_admin_overview_api(request):
    valid, role_or_error = verify_session(request, required_role="super_admin")
    if not valid:
        return JSONResponse({"error": role_or_error, "code": "FORBIDDEN"}, status_code=403)
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        repository = CommercialRepository(cursor)
        current = repository.effective_release(include_shadow=True)
        scheduled = conn.execute(
            """SELECT id, version_label, checksum, mode, scope_key,
                      effective_from, non_sellable, reason, created_at
                 FROM commercial_releases
                WHERE effective_from > ? AND non_sellable = 0
                ORDER BY effective_from, id LIMIT 1""",
            (int(time.time()),),
        ).fetchone()
        collected = conn.execute(
            """SELECT COALESCE(SUM(verified_paid_amount), 0),
                      COALESCE(SUM(net_settled_amount), 0)
                 FROM payment_transactions
                WHERE transaction_type = 'payment' AND status IN ('verified', 'settled')"""
        ).fetchone()
        state_counts = {
            row[0]: int(row[1]) for row in conn.execute(
                """SELECT activation_state, COUNT(*) FROM billing_orders
                    GROUP BY activation_state"""
            ).fetchall()
        }
        recent_orders = [
            public_order_payload(dict(row))
            for row in conn.execute(
                """SELECT * FROM billing_orders
                    ORDER BY updated_at DESC, id DESC LIMIT 25"""
            ).fetchall()
        ]
        config_error = None
        try:
            config = commercial_runtime_config()
            config_payload = {
                "enabled": config.enabled,
                "mode": config.mode,
                "paymentCheckoutEnabled": config.payment_checkout_enabled,
                "paymentActivationEnabled": config.payment_activation_enabled,
                "procurementCreditEnforcementEnabled": config.procurement_credit_enforcement_enabled,
            }
        except RuntimeError as exc:
            config_error = str(exc)
            config_payload = None
        return JSONResponse({
            "currentRelease": _release_payload(current),
            "scheduledRelease": _release_payload(dict(scheduled) if scheduled else None),
            "drafts": repository.list_drafts(),
            "money": {
                "verifiedCollected": int(collected[0] or 0),
                "settled": int(collected[1] or 0),
                "currency": "VND",
            },
            "orderActivationCounts": state_counts,
            "recentOrders": recent_orders,
            "health": commercial_health_snapshot(cursor),
            "runtime": config_payload,
            "readinessWarnings": [config_error] if config_error else [],
        })
    finally:
        conn.close()


async def create_commercial_draft_api(request):
    conn = None
    try:
        body = await _json_body(request)
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(
            cursor, request, required_role="super_admin"
        )
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        repository = CommercialRepository(cursor)
        base_release_id = str(body.get("baseReleaseId") or "").strip() or None
        if base_release_id:
            draft = repository.clone_release(base_release_id, actor.user_id)
            if not draft:
                conn.rollback()
                return JSONResponse({"error": "Không tìm thấy release.", "code": "NOT_FOUND"}, status_code=404)
        else:
            initial = repository.get_draft("commercial-draft-initial-v1")
            current = repository.effective_release(include_shadow=True)
            source_document = current["snapshot"] if current else initial["document"]
            draft = repository.create_draft(
                source_document,
                actor.user_id,
                base_release_id=current["id"] if current else initial.get("base_release_id"),
            )
        log_audit(
            "commercial.draft_created",
            actor_user_id=actor.user_id,
            target_type="commercial_draft",
            target_id=draft["id"],
            request=request,
            metadata={"revision": draft["revision"], "baseReleaseId": draft.get("base_release_id")},
            cursor=cursor,
            required=True,
        )
        repository.insert_outbox("commercial.draft_created", "commercial_draft", draft["id"], {"revision": draft["revision"]})
        conn.commit()
        return JSONResponse(_draft_payload(draft), status_code=201)
    except Exception as exc:  # noqa: BLE001 - translated at HTTP seam
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "create_commercial_draft_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def get_commercial_draft_api(request):
    valid, role_or_error = verify_session(request, required_role="super_admin")
    if not valid:
        return JSONResponse({"error": role_or_error, "code": "FORBIDDEN"}, status_code=403)
    conn = database.get_connection()
    try:
        draft = CommercialRepository(conn.cursor()).get_draft(request.path_params["draft_id"])
        if not draft:
            return JSONResponse({"error": "Không tìm thấy bản nháp.", "code": "NOT_FOUND"}, status_code=404)
        return JSONResponse(_draft_payload(draft), headers={"ETag": f'"{draft["revision"]}"'})
    finally:
        conn.close()


async def save_commercial_draft_api(request):
    conn = None
    try:
        body = await _json_body(request)
        revision = _expected_revision(request, body)
        document = body.get("document")
        if not isinstance(document, dict):
            raise CommercialPolicyError("COMMERCIAL_POLICY_INVALID", "Thiếu document có kiểu object.")
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        repository = CommercialRepository(cursor)
        draft = repository.save_draft(
            request.path_params["draft_id"], revision, document, actor.user_id
        )
        log_audit(
            "commercial.draft_saved",
            actor_user_id=actor.user_id,
            target_type="commercial_draft",
            target_id=draft["id"],
            request=request,
            metadata={"beforeRevision": revision, "afterRevision": draft["revision"], "checksum": draft["checksum"]},
            cursor=cursor,
            required=True,
        )
        repository.insert_outbox("commercial.draft_saved", "commercial_draft", draft["id"], {"revision": draft["revision"]})
        conn.commit()
        return JSONResponse(_draft_payload(draft), headers={"ETag": f'"{draft["revision"]}"'})
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "save_commercial_draft_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def validate_commercial_draft_api(request):
    conn = None
    try:
        body = await _json_body(request)
        revision = _expected_revision(request, body)
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        policy = CommercialPolicy(cursor)
        result = policy.validate_draft(request.path_params["draft_id"], revision)
        log_audit(
            "commercial.draft_validated",
            actor_user_id=actor.user_id,
            target_type="commercial_draft",
            target_id=request.path_params["draft_id"],
            request=request,
            metadata={"revision": revision, "digest": result["validationDigest"], "errorCount": len(result["errors"])},
            cursor=cursor,
            required=True,
        )
        policy.repository.insert_outbox("commercial.draft_validated", "commercial_draft", request.path_params["draft_id"], {"revision": revision, "digest": result["validationDigest"]})
        conn.commit()
        return JSONResponse(result)
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "validate_commercial_draft_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def publish_commercial_draft_api(request):
    conn = None
    try:
        body = await _json_body(request)
        revision = _expected_revision(request, body)
        digest = str(body.get("validationDigest") or "").strip()
        reason = str(body.get("reason") or "").strip()
        effective_at = body.get("effectiveAt") or int(time.time())
        if len(digest) != 64 or len(reason) < 3:
            raise CommercialPolicyError("COMMERCIAL_POLICY_INVALID", "Thiếu digest hoặc lý do xuất bản hợp lệ.")
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        policy = CommercialPolicy(cursor)
        release = policy.publish_draft(
            request.path_params["draft_id"], revision, digest,
            int(effective_at), reason, actor.user_id,
        )
        log_audit(
            "commercial.release_published",
            actor_user_id=actor.user_id,
            target_type="commercial_release",
            target_id=release["id"],
            request=request,
            metadata={"draftId": request.path_params["draft_id"], "revision": revision, "digest": digest, "checksum": release["checksum"], "effectiveAt": int(effective_at), "reason": reason},
            cursor=cursor,
            required=True,
        )
        policy.repository.insert_outbox("commercial.release_published", "commercial_release", release["id"], {"effectiveAt": int(effective_at), "checksum": release["checksum"]})
        conn.commit()
        return JSONResponse(_release_payload(release), status_code=201)
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "publish_commercial_draft_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def clone_commercial_release_api(request):
    conn = None
    try:
        await _json_body(request)
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(
            cursor, request, required_role="super_admin"
        )
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        repository = CommercialRepository(cursor)
        draft = repository.clone_release(
            request.path_params["release_id"], actor.user_id
        )
        if not draft:
            conn.rollback()
            return JSONResponse(
                {"error": "Không tìm thấy release.", "code": "NOT_FOUND"},
                status_code=404,
            )
        log_audit(
            "commercial.release_cloned",
            actor_user_id=actor.user_id,
            target_type="commercial_draft",
            target_id=draft["id"],
            request=request,
            metadata={"baseReleaseId": request.path_params["release_id"]},
            cursor=cursor,
            required=True,
        )
        repository.insert_outbox(
            "commercial.release_cloned",
            "commercial_draft",
            draft["id"],
            {"baseReleaseId": request.path_params["release_id"]},
        )
        conn.commit()
        return JSONResponse(_draft_payload(draft), status_code=201)
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "clone_commercial_release_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def stop_commercial_release_sales_api(request):
    conn = None
    try:
        body = await _json_body(request)
        reason = str(body.get("reason") or "").strip()
        if len(reason) < 3:
            raise CommercialPolicyError("COMMERCIAL_POLICY_INVALID", "Cần lý do ngừng bán.")
        effective_at = int(body.get("effectiveAt") or time.time())
        scope = body.get("scope") or {}
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, actor = verify_session_in_transaction(cursor, request, required_role="super_admin")
        if not valid:
            conn.rollback()
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        repository = CommercialRepository(cursor)
        release = repository.stop_sales(
            request.path_params["release_id"], actor.user_id,
            effective_at=effective_at, reason=reason, scope=scope,
        )
        if not release:
            conn.rollback()
            return JSONResponse({"error": "Không tìm thấy release.", "code": "NOT_FOUND"}, status_code=404)
        log_audit(
            "commercial.release_stop_sales",
            actor_user_id=actor.user_id,
            target_type="commercial_release",
            target_id=release["id"],
            request=request,
            metadata={"effectiveAt": effective_at, "scope": scope, "reason": reason},
            cursor=cursor,
            required=True,
        )
        repository.insert_outbox("commercial.release_stop_sales", "commercial_release", release["id"], {"effectiveAt": effective_at, "scope": scope})
        conn.commit()
        return JSONResponse({"success": True, "release": _release_payload(release)})
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "stop_commercial_release_sales_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


async def public_commercial_offers_api(request):
    try:
        config = commercial_runtime_config()
        if not config.enabled or config.mode == "off":
            raise CommercialPolicyError(
                "COMMERCIAL_POLICY_DECISION_REQUIRED",
                "Catalog thương mại mới chưa được bật.",
                status_code=503,
            )
        conn = database.get_connection()
        try:
            catalog = CommercialPolicy(
                conn.cursor(), include_shadow=config.mode == "shadow"
            ).resolve_offer()
        finally:
            conn.close()
        etag = f'"{catalog["releaseId"]}:{catalog["releaseChecksum"]}"'
        if request.headers.get("If-None-Match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        now = int(time.time())
        next_at = catalog.get("nextEffectiveAt")
        max_age = max(0, min(60, int(next_at) - now)) if next_at else 60
        return JSONResponse(
            catalog,
            headers={
                "ETag": etag,
                "Cache-Control": f"public, max-age={max_age}, must-revalidate",
            },
        )
    except Exception as exc:  # noqa: BLE001
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "public_commercial_offers_api")
        return _error_response(exc)


async def create_billing_quote_api(request):
    conn = None
    try:
        config = commercial_runtime_config()
        if not config.enabled or config.mode != "enforce":
            raise CommercialPolicyError(
                QUOTE_NOT_AVAILABLE,
                "Báo giá thanh toán chưa được bật.",
                status_code=503,
            )
        valid, actor = verify_session(request)
        if not valid:
            return JSONResponse({"error": actor, "code": "FORBIDDEN"}, status_code=403)
        body = await _json_body(request)
        owner_kind = str(body.get("ownerKind") or "").strip()
        owner_id = str(body.get("ownerId") or "").strip()
        if owner_kind == "account" and owner_id != actor.user_id:
            raise CommercialPolicyError("BUYER_NOT_AUTHORIZED", "Không được mua cho tài khoản khác.", status_code=403)
        if owner_kind == "organization" and owner_id != str(actor.active_role_organization_id or ""):
            raise CommercialPolicyError("BUYER_NOT_AUTHORIZED", "Workspace tổ chức không khớp phiên đang hoạt động.", status_code=403)
        request_shape = {
            "ownerKind": owner_kind,
            "ownerId": owner_id,
            "operation": str(body.get("operation") or "purchase"),
            "skuCode": str(body.get("skuCode") or ""),
        }
        request_hash = sha256(canonical_json(request_shape).encode("utf-8")).hexdigest()
        conn = database.get_connection()
        conn.execute("BEGIN")
        cursor = conn.cursor()
        valid, tx_actor = verify_session_in_transaction(cursor, request)
        if not valid:
            conn.rollback()
            return JSONResponse({"error": tx_actor, "code": "FORBIDDEN"}, status_code=403)
        context = {
            "ownerKind": owner_kind,
            "ownerId": owner_id,
            "actorRole": tx_actor.platform_role if tx_actor.platform_role == "super_admin" else str(tx_actor),
            "subscriptionRevision": body.get("subscriptionRevision"),
        }
        decision = CommercialPolicy(cursor).evaluate_commercial_command(request_shape, context)
        now = int(time.time())
        quote_id = new_id("billing-quote")
        public_id = new_id("quote")
        snapshot = decision["snapshot"]
        price = snapshot["price"]
        cursor.execute(
            """INSERT INTO billing_quotes
                   (id, public_id, actor_user_id, account_user_id,
                    organization_id, owner_kind, operation, request_hash,
                    release_id, release_checksum, decision_json,
                    subtotal_amount, tax_amount, total_amount, currency,
                    expected_subscription_revision, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VND', ?, ?)""",
            (
                quote_id,
                public_id,
                tx_actor.user_id,
                owner_id if owner_kind == "account" else None,
                owner_id if owner_kind == "organization" else None,
                owner_kind,
                request_shape["operation"],
                request_hash,
                snapshot["releaseId"],
                snapshot["releaseChecksum"],
                canonical_json(snapshot),
                price["subtotal"],
                price["tax"],
                price["total"],
                snapshot.get("expectedSubscriptionRevision"),
                now + 15 * 60,
            ),
        )
        log_audit(
            "billing.quote_created",
            actor_user_id=tx_actor.user_id,
            organization_id=owner_id if owner_kind == "organization" else None,
            target_type="billing_quote",
            target_id=quote_id,
            request=request,
            metadata={"publicId": public_id, "ownerKind": owner_kind, "operation": request_shape["operation"], "skuCode": request_shape["skuCode"], "releaseId": snapshot["releaseId"], "totalAmount": price["total"]},
            cursor=cursor,
            required=True,
        )
        CommercialRepository(cursor).insert_outbox("billing.quote_created", "billing_quote", quote_id, {"publicId": public_id, "expiresAt": now + 15 * 60})
        conn.commit()
        return JSONResponse({
            "publicId": public_id,
            "expiresAt": now + 15 * 60,
            "releaseId": snapshot["releaseId"],
            "skuCode": snapshot["skuCode"],
            "price": price,
            "benefits": snapshot["benefits"],
        }, status_code=201)
    except Exception as exc:  # noqa: BLE001
        if conn:
            conn.rollback()
        if not isinstance(exc, CommercialPolicyError):
            log_error(exc, "create_billing_quote_api")
        return _error_response(exc)
    finally:
        if conn:
            conn.close()


def commercial_policy_routes(Route):
    return [
        Route("/api/commercial/admin/overview", commercial_admin_overview_api, methods=["GET"]),
        Route("/api/commercial/drafts", create_commercial_draft_api, methods=["POST"]),
        Route("/api/commercial/drafts/{draft_id}", get_commercial_draft_api, methods=["GET"]),
        Route("/api/commercial/drafts/{draft_id}", save_commercial_draft_api, methods=["PATCH"]),
        Route("/api/commercial/drafts/{draft_id}/validate", validate_commercial_draft_api, methods=["POST"]),
        Route("/api/commercial/drafts/{draft_id}/publish", publish_commercial_draft_api, methods=["POST"]),
        Route("/api/commercial/releases/{release_id}/clone", clone_commercial_release_api, methods=["POST"]),
        Route("/api/commercial/releases/{release_id}/stop-sales", stop_commercial_release_sales_api, methods=["POST"]),
        Route("/api/public/commercial/offers", public_commercial_offers_api, methods=["GET"]),
        Route("/api/billing/quotes", create_billing_quote_api, methods=["POST"]),
    ]
