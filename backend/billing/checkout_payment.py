"""Signed checkout display metadata and local QR encoding."""

from __future__ import annotations

from base64 import b64encode
from functools import lru_cache
import json

import qrcode
from qrcode.image.svg import SvgPathFillImage


_DETAIL_FIELDS = ("qrCode", "bin", "accountNumber", "accountName", "description")


def _metadata_dict(metadata):
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return None
    return metadata if isinstance(metadata, dict) else None


def checkout_payment_snapshot(result):
    """Project display fields from a provider result already verified by its adapter."""
    if not isinstance(result, dict):
        return None
    qr_code = result.get("qrCode")
    if not isinstance(qr_code, str) or not qr_code or len(qr_code.encode("utf-8")) > 2048:
        return None
    details = {
        field: result[field] for field in _DETAIL_FIELDS
        if isinstance(result.get(field), str)
    }
    if len(json.dumps(details, ensure_ascii=False).encode("utf-8")) > 8192:
        return None
    return details


@lru_cache(maxsize=128)
def _qr_image(qr_code):
    image = qrcode.make(qr_code, image_factory=SvgPathFillImage, border=4)
    return "data:image/svg+xml;base64," + b64encode(image.to_string()).decode("ascii")


def public_checkout_payment_details(metadata):
    metadata = _metadata_dict(metadata)
    details = checkout_payment_snapshot(metadata)
    return {**details, "qrCodeImage": _qr_image(details["qrCode"])} if details else None


def merge_payment_progress(metadata, result, expected_amount):
    """Keep a bounded, monotonic provider payment observation beside the QR."""
    current = dict(_metadata_dict(metadata) or {})
    if not isinstance(result, dict):
        return current or None
    expected = int(expected_amount or 0)
    paid = result.get("amountPaid")
    if type(paid) is not int or expected <= 0 or paid < 0 or paid > expected:
        return current or None
    previous_paid = current.get("amountPaid")
    paid = max(paid, previous_paid if type(previous_paid) is int else 0)
    current.update({
        "paymentStatus": "UNDERPAID" if 0 < paid < expected else str(result.get("status") or "PENDING").upper(),
        "amountPaid": paid,
        "amountRemaining": expected - paid,
    })
    return current


def public_payment_progress(metadata, expected_amount):
    metadata = _metadata_dict(metadata)
    if not metadata:
        return None
    expected = int(expected_amount or 0)
    paid = metadata.get("amountPaid")
    remaining = metadata.get("amountRemaining")
    status = str(metadata.get("paymentStatus") or "").upper()
    if (status != "UNDERPAID" or type(paid) is not int or type(remaining) is not int
            or expected <= 0 or not 0 < paid < expected or remaining != expected - paid):
        return None
    return {"status": "underpaid", "amountPaid": paid, "amountRemaining": remaining}
