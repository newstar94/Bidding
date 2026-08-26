"""Deep commercial policy module exercised through a compact interface."""

from __future__ import annotations

from hashlib import sha256
import time

from .document import canonical_json, validate_document
from .errors import (
    BUYER_NOT_AUTHORIZED,
    CommercialPolicyError,
    DECISION_REQUIRED,
    OFFER_NOT_SELLABLE,
    VALIDATION_FAILED,
    VALIDATION_OBSOLETE,
)
from .repository import CommercialRepository


class CommercialPolicy:
    """Resolve, evaluate and publish one versioned source of commercial truth."""

    VALIDATION_TTL_SECONDS = 15 * 60

    def __init__(self, cursor, *, clock=None, include_shadow=False):
        self.clock = clock or time.time
        self.repository = CommercialRepository(cursor, clock=self.clock)
        self.include_shadow = bool(include_shadow)

    def resolve_offer(self, context=None, at=None):
        context = context or {}
        release = self.repository.effective_release(
            at, scope_key=str(context.get("scopeKey") or "global"),
            include_shadow=self.include_shadow,
        )
        if not release:
            raise CommercialPolicyError(
                DECISION_REQUIRED,
                "Chưa có bản phát hành thương mại hợp lệ cho giao dịch mới.",
                status_code=503,
            )
        document = release["snapshot"]
        offers = [
            offer for offer in document.get("offers") or []
            if offer.get("salesState") == "sellable"
        ]
        packs = list(document.get("creditPacks") or [])
        return {
            "releaseId": release["id"],
            "releaseChecksum": release["checksum"],
            "effectiveFrom": release["effective_from"],
            "nextEffectiveAt": self.repository.next_effective_at(at),
            "currency": document["currency"],
            "timezone": document["timezone"],
            "offers": offers,
            "creditPacks": packs,
            "quotaWarnings": (document.get("policies") or {}).get(
                "quotaWarningPercentages", []
            ),
        }

    def evaluate_commercial_command(self, command, context, at=None):
        catalog = self.resolve_offer(context, at)
        release = self.repository.get_release(catalog["releaseId"])
        document = release["snapshot"]
        owner_kind = str(context.get("ownerKind") or "")
        actor_role = str(context.get("actorRole") or "")
        operation = str(command.get("operation") or "purchase")
        if operation not in {"purchase", "renew", "upgrade", "downgrade", "credit_pack"}:
            raise CommercialPolicyError(
                "COMMERCIAL_OPERATION_INVALID",
                "Operation thương mại không hợp lệ.",
                status_code=400,
            )
        sku_code = str(command.get("skuCode") or "")
        if owner_kind not in {"account", "organization"}:
            raise CommercialPolicyError(
                BUYER_NOT_AUTHORIZED, "Workspace mua không hợp lệ.", status_code=403
            )
        if owner_kind == "organization":
            allowed = set(
                (document.get("policies") or {}).get(
                    "organizationPurchaseAuthority", []
                )
            )
            if actor_role not in allowed:
                raise CommercialPolicyError(
                    BUYER_NOT_AUTHORIZED,
                    "Vai trò hiện tại không có thẩm quyền mua cho tổ chức.",
                    status_code=403,
                )
        offer = next(
            (item for item in document.get("offers") or [] if item.get("code") == sku_code),
            None,
        )
        pack = next(
            (item for item in document.get("creditPacks") or [] if item.get("code") == sku_code),
            None,
        )
        if not offer and not pack:
            raise CommercialPolicyError(
                OFFER_NOT_SELLABLE, "SKU không tồn tại trong release hiệu lực.", status_code=409
            )
        if offer:
            if offer.get("salesState") != "sellable" or offer.get("ownerKind") != owner_kind:
                raise CommercialPolicyError(
                    OFFER_NOT_SELLABLE,
                    "Offer không bán cho workspace đã chọn.",
                    status_code=409,
                )
            price = offer["price"]
            benefits = {
                "memberQuota": offer["memberQuota"],
                "includedProcurementQuota": offer["includedProcurementQuota"],
                "exportCapabilities": offer["exportCapabilities"],
                "violationCheckEnabled": offer["violationCheckEnabled"],
            }
            item_type = "base_plan"
        else:
            price = {
                "period": "one_time",
                "currency": "VND",
                "subtotal": pack["price"],
                "tax": 0,
                "total": pack["price"],
            }
            benefits = {
                "procurementCredits": pack["quantity"],
                "expiryPolicy": (document.get("policies") or {}).get(
                    "creditPackExpiry"
                ),
            }
            item_type = "procurement_credit_pack"
        snapshot = {
            "releaseId": release["id"],
            "releaseChecksum": release["checksum"],
            "ownerKind": owner_kind,
            "ownerId": str(context.get("ownerId") or ""),
            "operation": operation,
            "skuCode": sku_code,
            "itemType": item_type,
            "price": price,
            "benefits": benefits,
            "expectedSubscriptionRevision": context.get("subscriptionRevision"),
            "provider": next(
                (
                    profile for profile in document.get("providerProfiles") or []
                    if profile.get("mode") in {"live", "shadow"}
                    and profile.get("readiness") == "ready"
                ),
                None,
            ),
            "policySnapshot": document.get("policies") or {},
            "taxInvoiceSnapshot": document.get("taxInvoice") or {},
        }
        return {
            "allowed": True,
            "decisionDigest": sha256(canonical_json(snapshot).encode("utf-8")).hexdigest(),
            "snapshot": snapshot,
        }

    def validate_draft(self, draft_id, expected_revision):
        draft = self.repository.get_draft(draft_id)
        if not draft or int(draft["revision"]) != int(expected_revision):
            raise CommercialPolicyError(
                VALIDATION_OBSOLETE,
                "Revision cần kiểm tra không còn hiện hành.",
                status_code=409,
            )
        result = validate_document(draft["document"])
        digest_payload = {
            "draftId": draft_id,
            "revision": draft["revision"],
            "checksum": draft["checksum"],
            "result": result,
        }
        digest = sha256(canonical_json(digest_payload).encode("utf-8")).hexdigest()
        expires_at = int(self.clock()) + self.VALIDATION_TTL_SECONDS
        stored = self.repository.store_validation(
            draft_id, draft["revision"], result, digest, expires_at
        )
        return {
            "draftId": draft_id,
            "revision": stored["revision"],
            "checksum": stored["checksum"],
            "validationDigest": digest,
            "readinessExpiresAt": expires_at,
            **result,
        }

    def publish_draft(
        self,
        draft_id,
        expected_revision,
        validation_digest,
        effective_at,
        reason,
        actor_user_id,
    ):
        draft = self.repository.get_draft(draft_id, for_update=True)
        now = int(self.clock())
        if (
            not draft
            or int(draft["revision"]) != int(expected_revision)
            or draft.get("validation_revision") != int(expected_revision)
            or draft.get("validation_digest") != validation_digest
            or int(draft.get("readiness_expires_at") or 0) < now
        ):
            raise CommercialPolicyError(
                VALIDATION_OBSOLETE,
                "Kết quả kiểm tra không còn khớp revision hiện tại.",
                status_code=409,
            )
        validation = draft.get("validation") or {}
        if validation.get("errors"):
            raise CommercialPolicyError(
                VALIDATION_FAILED,
                "Bản nháp còn lỗi hoặc quyết định bị chặn.",
                status_code=409,
                details={"errors": validation["errors"]},
            )
        if int(effective_at) < now - 5:
            raise CommercialPolicyError(
                "COMMERCIAL_POLICY_SCHEDULE_CONFLICT",
                "Không được xuất bản hồi tố.",
                status_code=409,
            )
        return self.repository.publish(
            draft,
            actor_user_id,
            effective_at=int(effective_at),
            reason=str(reason).strip(),
        )
