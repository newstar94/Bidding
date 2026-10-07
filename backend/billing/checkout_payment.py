"""Signed checkout display metadata and local QR encoding."""

from __future__ import annotations

from base64 import b64encode
from functools import lru_cache
import json

import qrcode
from qrcode.image.svg import SvgPathFillImage


_DETAIL_FIELDS = ("qrCode", "bin", "accountNumber", "accountName", "description")


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
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return None
    details = checkout_payment_snapshot(metadata)
    return {**details, "qrCodeImage": _qr_image(details["qrCode"])} if details else None
