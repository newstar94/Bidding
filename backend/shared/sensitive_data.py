"""Central response policy for sensitive contractor and expert data."""

from dataclasses import dataclass

from backend.shared.access_policy import has_module_permission


SENSITIVE_READ_MODULES = {
    "chuyen_gia": "chuyengia",
    "nha_thau": "nhathau",
}


@dataclass(frozen=True)
class SensitiveReadPolicy:
    """Workspace-scoped access to complete business records."""

    can_view_expert_details: bool
    can_view_contractor_financials: bool
    can_view_signature_images: bool = False

    def can_view(self, table_name):
        if table_name == "chuyen_gia":
            return self.can_view_expert_details
        if table_name == "nha_thau":
            return self.can_view_contractor_financials
        return True


def resolve_sensitive_read_policy(
    cursor,
    role_str,
    user_id,
    organization_id,
    table_names=None,
):
    """Allow complete business fields whenever the module itself is viewable."""
    requested_tables = (
        set(SENSITIVE_READ_MODULES)
        if table_names is None
        else set(table_names) & set(SENSITIVE_READ_MODULES)
    )

    def can_view(table_name):
        if table_name not in requested_tables:
            return False
        return has_module_permission(
            cursor,
            role_str,
            user_id,
            organization_id,
            SENSITIVE_READ_MODULES[table_name],
            "view",
        )

    return SensitiveReadPolicy(
        can_view_expert_details=can_view("chuyen_gia"),
        can_view_contractor_financials=can_view("nha_thau"),
        can_view_signature_images=any(can_view(table) for table in requested_tables),
    )


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


def redact_contractor_financial_item(item):
    """Mask bank details for users who only have view access to contractors."""
    redacted = dict(item or {})
    for key in ("soTaiKhoan", "so_tai_khoan"):
        if key in redacted:
            redacted[key] = mask_identifier(redacted.get(key))
    for key in ("noiMoTaiKhoan", "noi_mo_tai_khoan", "maNganHang", "ma_ngan_hang"):
        if key in redacted:
            redacted[key] = None
    for member_key in ("thanhVienLienDanh", "thanh_vien_lien_danh"):
        if isinstance(redacted.get(member_key), list):
            redacted[member_key] = [
                redact_contractor_financial_item(member) for member in redacted[member_key]
            ]
    redacted["sensitiveFinancialDataMasked"] = True
    return redacted


def redact_signature_media_item(item):
    """Remove private certificate/signature/stamp paths from one response DTO."""
    redacted = dict(item or {})
    for key in (
        "anhDau",
        "tenAnhDau",
        "anhChungChi",
        "anhChuKy",
        "tenAnhChungChi",
        "tenAnhChuKy",
        "anh_dau",
        "ten_anh_dau",
        "anh_chung_chi",
        "anh_chu_ky",
        "ten_anh_chung_chi",
        "ten_anh_chu_ky",
    ):
        if key in redacted:
            redacted[key] = None
    for member_key in ("thanhVienLienDanh", "thanh_vien_lien_danh"):
        if isinstance(redacted.get(member_key), list):
            redacted[member_key] = [
                redact_signature_media_item(member)
                for member in redacted[member_key]
            ]
    redacted["sensitiveMediaMasked"] = True
    return redacted


def serialize_sensitive_read_item(table_name, item, policy):
    """Return a response-safe copy according to the resolved workspace policy."""
    if table_name == "chuyen_gia":
        serialized = (
            dict(item or {})
            if policy.can_view(table_name)
            else redact_expert_item(item)
        )
    elif table_name == "nha_thau":
        serialized = (
            dict(item or {})
            if policy.can_view(table_name)
            else redact_contractor_financial_item(item)
        )
    else:
        return dict(item or {})
    if not policy.can_view_signature_images:
        serialized = redact_signature_media_item(serialized)
    return serialized


def serialize_sensitive_read_items(table_name, items, policy):
    return [serialize_sensitive_read_item(table_name, item, policy) for item in items]
