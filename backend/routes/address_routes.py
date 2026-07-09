"""
address_routes.py - Proxy endpoint lấy danh sách tỉnh thành / xã phường từ provinces.open-api.vn
Server gọi API thay cho browser để tránh bị chặn bởi CSP.
"""
import urllib.request
import json
from starlette.responses import JSONResponse

# Cache server-side để không gọi API bên ngoài liên tục
_provinces_cache = None
_wards_cache = {}

PROVINCES_API_BASE = "https://provinces.open-api.vn/api/v2"


async def get_provinces_api(request):
    """
    [GET] /api/address/provinces
    Trả về danh sách tỉnh thành Việt Nam (v2 - sau sáp nhập 2025).
    """
    global _provinces_cache
    if _provinces_cache is not None:
        return JSONResponse(_provinces_cache)

    try:
        url = f"{PROVINCES_API_BASE}/p/"
        req = urllib.request.Request(url, headers={"User-Agent": "BiddingApp/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, list) and len(data) > 0:
            _provinces_cache = data
            return JSONResponse(data)
        else:
            return JSONResponse({"error": "Dữ liệu tỉnh thành trống"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": f"Không thể tải danh sách tỉnh thành: {str(e)}"}, status_code=502)


async def get_wards_api(request):
    """
    [GET] /api/address/wards/{province_code}
    Trả về danh sách xã/phường của một tỉnh (v2 - depth=2).
    """
    province_code = request.path_params.get("province_code", "")
    if not province_code:
        return JSONResponse({"error": "Thiếu mã tỉnh"}, status_code=400)

    if province_code in _wards_cache:
        return JSONResponse(_wards_cache[province_code])

    try:
        url = f"{PROVINCES_API_BASE}/p/{province_code}?depth=2"
        req = urllib.request.Request(url, headers={"User-Agent": "BiddingApp/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        wards = data.get("wards", []) if isinstance(data, dict) else []
        _wards_cache[province_code] = wards
        return JSONResponse(wards)
    except Exception as e:
        return JSONResponse({"error": f"Không thể tải danh sách xã phường: {str(e)}"}, status_code=502)


async def lookup_tax_code_api(request):
    """
    [GET] /api/lookup-tax-code
    Tra cứu thông tin doanh nghiệp (nhà thầu/chủ đầu tư) từ mã số thuế trực tuyến.
    """
    tax_code = request.query_params.get("code", "")
    if not tax_code:
        return JSONResponse({"error": "Thiếu mã số thuế"}, status_code=400)

    try:
        from services.partner_lookup_service import lookup_partner_info, extract_clean_tax_code
        cleaned_code = extract_clean_tax_code(tax_code)
        if not cleaned_code:
            return JSONResponse({"error": "Mã số thuế không hợp lệ về mặt định dạng"}, status_code=400)

        info = lookup_partner_info(cleaned_code)
        if info:
            return JSONResponse(info)
        else:
            return JSONResponse({"error": "Không tìm thấy thông tin doanh nghiệp cho mã số thuế này"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": f"Lỗi hệ thống khi tra cứu: {str(e)}"}, status_code=500)

