import json
import re
import unicodedata
import urllib.request


PROVINCES_API_BASE = "https://provinces.open-api.vn/api/v2"
_PROVINCES_CACHE = None
_WARDS_CACHE = {}


def _normalize(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    text = re.sub(r"[.,;:()]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _strip_prefix(value, kind):
    text = _normalize(value)
    if kind == "province":
        return re.sub(r"^(tinh|thanh pho|tp|t p)\s+", "", text).strip()
    return re.sub(r"^(phuong|xa|thi tran|tt)\s+", "", text).strip()


def _fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "BiddingApp/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_provinces():
    global _PROVINCES_CACHE
    if _PROVINCES_CACHE is None:
        data = _fetch_json(f"{PROVINCES_API_BASE}/p/")
        _PROVINCES_CACHE = data if isinstance(data, list) else []
    return _PROVINCES_CACHE


def _get_wards(province_code):
    if not province_code:
        return []
    if province_code not in _WARDS_CACHE:
        data = _fetch_json(f"{PROVINCES_API_BASE}/p/{province_code}?depth=2")
        _WARDS_CACHE[province_code] = data.get("wards", []) if isinstance(data, dict) else []
    return _WARDS_CACHE[province_code]


def _find_match(parts, candidates, kind):
    normalized_parts = [_normalize(part) for part in parts]
    normalized_address = _normalize(", ".join(parts))
    sorted_candidates = sorted(candidates, key=lambda item: len(str(item.get("name") or "")), reverse=True)

    for item in sorted_candidates:
        name = item.get("name") or ""
        aliases = {_normalize(name), _strip_prefix(name, kind)}
        aliases = {alias for alias in aliases if alias}

        for idx in range(len(normalized_parts) - 1, -1, -1):
            part = normalized_parts[idx]
            if any(part == alias or part.endswith(f" {alias}") or alias.endswith(f" {part}") for alias in aliases):
                return item, idx

        if any(normalized_address.endswith(f" {alias}") or f" {alias} " in normalized_address for alias in aliases):
            return item, -1

    return None, -1


def compose_internal_address(detail="", ward_name="", province_name=""):
    return f"{str(detail or '').strip()} | {str(ward_name or '').strip()} | {str(province_name or '').strip()}"


def parse_vietnam_address_to_internal(raw_address):
    raw = str(raw_address or "").strip()
    if not raw:
        return ""

    parts = [part.strip() for part in raw.split(",") if part.strip()]
    if not parts:
        return compose_internal_address(raw, "", "")

    try:
        provinces = _get_provinces()
        province, province_index = _find_match(parts, provinces, "province")
        ward = None
        ward_index = -1

        if province and province.get("code"):
            parts_without_province = [part for idx, part in enumerate(parts) if idx != province_index]
            wards = _get_wards(province.get("code"))
            ward, filtered_ward_index = _find_match(parts_without_province, wards, "ward")
            if filtered_ward_index >= 0:
                ward_index = filtered_ward_index
                if province_index >= 0 and ward_index >= province_index:
                    ward_index += 1

        remove_indexes = {idx for idx in (province_index, ward_index) if idx >= 0}
        detail = ", ".join(part for idx, part in enumerate(parts) if idx not in remove_indexes).strip() or raw
        return compose_internal_address(
            detail,
            ward.get("name") if ward else "",
            province.get("name") if province else "",
        )
    except Exception:
        return compose_internal_address(raw, "", "")
