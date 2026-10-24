"""Evidence that a new account accepted the published legal documents (ADR 0095).

Consent is written to the hash-chained audit log inside the same transaction
that creates the account, so an account never exists without its evidence and
the evidence inherits the audit retention and tamper detection.
"""

from __future__ import annotations

from backend.shared.logging_utils import log_audit


# Bump together with the "Cập nhật gần nhất" date on views/components/legal_page.html.
LEGAL_POLICY_VERSION = "2026-10-24"
LEGAL_DOCUMENTS = ("terms", "privacy", "security", "cookies", "refund")

CONSENT_METHOD_REGISTRATION_CHECKBOX = "registration_checkbox"
CONSENT_METHOD_GOOGLE_SIGN_IN_NOTICE = "google_sign_in_notice"

LEGAL_CONSENT_REQUIRED_MESSAGE = (
    "Vui lòng đánh dấu đồng ý với Điều khoản sử dụng và các chính sách trước khi đăng ký."
)


def record_legal_consent(cursor, *, user_id, method, request=None):
    """Append the consent event to the caller's open transaction."""

    return log_audit(
        "legal.consent_accepted",
        actor_user_id=user_id,
        target_type="tai_khoan",
        target_id=user_id,
        request=request,
        metadata={
            "policyVersion": LEGAL_POLICY_VERSION,
            "documents": list(LEGAL_DOCUMENTS),
            "method": method,
        },
        cursor=cursor,
        required=True,
    )
