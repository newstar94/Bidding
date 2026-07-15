"""Response redaction for sensitive personal data."""


def mask_identifier(value, visible_suffix=4):
    raw = str(value or "").strip()
    if not raw:
        return ""
    suffix_length = max(0, min(int(visible_suffix), len(raw)))
    suffix = raw[-suffix_length:] if suffix_length else ""
    return "*" * max(4, len(raw) - suffix_length) + suffix


def redact_expert_item(item):
    """Return a copy safe for users who only have view permission."""
    redacted = dict(item or {})
    for key in ("soCCCD", "so_cccd"):
        if key in redacted:
            redacted[key] = mask_identifier(redacted.get(key))
    for key in (
        "anhChungChi",
        "anhChuKy",
        "tenAnhChungChi",
        "tenAnhChuKy",
        "anh_chung_chi",
        "anh_chu_ky",
        "ten_anh_chung_chi",
        "ten_anh_chu_ky",
    ):
        if key in redacted:
            redacted[key] = None
    redacted["sensitiveDataMasked"] = True
    return redacted
