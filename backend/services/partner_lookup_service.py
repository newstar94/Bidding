import os
import threading
import time
import urllib.request
import urllib.error
import json
import re
import ssl
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from helpers import database
from helpers_py.address_parser import compose_external_address, parse_vietnam_address_to_internal
from helpers_py.text_utils import normalize_organization_name, normalize_person_name


PARTNER_LOOKUP_RETRY_SECONDS = 6 * 60 * 60
_partner_lookup_attempts = {}
_partner_worker_started = False
_partner_worker_lock = threading.Lock()


def _worker_debug(message):
    if os.environ.get("APP_DEBUG", "False").lower() == "true":
        print(message, flush=True)

def extract_clean_tax_code(val):
    if not val:
        return None

    val = str(val).strip()

    if val.lower().startswith("vn"):
        val = val[2:]

    cleaned = re.sub(r'[^0-9\-]', '', val)

    digits_only = re.sub(r'[^0-9]', '', cleaned)
    if 9 <= len(digits_only) <= 14:
        return cleaned
    return None


MUASAMCONG_CONTRACTOR_SERVICE_BASE = (
    "https://muasamcong.mpi.gov.vn/o/egp-portal-contractors-approved/services"
)
MUASAMCONG_INVESTOR_SERVICE_BASE = (
    "https://muasamcong.mpi.gov.vn/o/egp-portal-investor-approved-v2/services"
)


def _create_muasamcong_ssl_context():
    context = ssl.create_default_context()
    try:
        context.set_ciphers("DEFAULT:@SECLEVEL=1")
    except ssl.SSLError:
        pass
    return context


MUASAMCONG_SSL_CONTEXT = _create_muasamcong_ssl_context()


def normalize_procurement_org_code(value):
    raw_value = re.sub(r"[\s._-]+", "", str(value or "").strip().lower())
    match = re.fullmatch(r"(vnp|vnz|vn)(\d{9,14})", raw_value)
    return f"{match.group(1)}{match.group(2)}" if match else None


def _post_muasamcong_json(
    endpoint,
    payload,
    timeout=8,
    service_base=MUASAMCONG_CONTRACTOR_SERVICE_BASE,
):
    request = urllib.request.Request(
        f"{service_base}/{endpoint}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://muasamcong.mpi.gov.vn",
            "Referer": "https://muasamcong.mpi.gov.vn/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        },
        method="POST",
    )
    with urllib.request.urlopen(
        request,
        timeout=timeout,
        context=MUASAMCONG_SSL_CONTEXT,
    ) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def _fetch_muasamcong_area_name(code, service_base=MUASAMCONG_CONTRACTOR_SERVICE_BASE):
    if not code:
        return ""
    try:
        result = _post_muasamcong_json(
            "get-area-by-code",
            {"queryParams": {"code": {"equals": code}}},
            service_base=service_base,
        )
        if isinstance(result, list):
            values = result
        elif isinstance(result, dict):
            values = result.get("value", [])
        else:
            values = []
        return values[0].get("name", "") if values else ""
    except Exception:
        return ""


def _build_muasamcong_partner_info(data, org_code, area_names=None):
    if not isinstance(data, dict) or not data.get("orgFullName"):
        return None

    def clean_text(value):
        return str(value or "").strip()

    area_names = area_names or {}
    administrative_names = [
        area_names.get(data.get("officeWar")),
        area_names.get(data.get("officeDis")),
        area_names.get(data.get("officePro")),
    ]
    address = compose_external_address(data.get("officeAdd"), *administrative_names)

    return {
        "name": normalize_organization_name(data.get("orgFullName")),
        "address": address,
        "short_name": clean_text(data.get("orgShortName")),
        "source": "MuaSamCong",
        "org_code": clean_text(data.get("orgCode") or org_code),
        "tax_code": clean_text(data.get("taxCode")),
        "english_name": clean_text(data.get("orgEnName")),
        "representative_name": normalize_person_name(data.get("repName")),
        "representative_position": clean_text(data.get("repPosition")),
        "phone": clean_text(data.get("officePhone")),
        "website": clean_text(data.get("officeWeb")),
        "business_type": clean_text(data.get("businessType")),
        "businesses": data.get("businesses") or [],
        "procurement_data": data,
    }


def fetch_muasamcong_info(tax_code="", org_code="", role_name="NT"):
    normalized_org_code = normalize_procurement_org_code(org_code)
    if not normalized_org_code:
        return None

    normalized_role = str(role_name or "NT").strip().upper()
    if normalized_role not in {"NT", "CDT"}:
        normalized_role = "NT"

    try:
        if normalized_role == "CDT":
            service_base = MUASAMCONG_INVESTOR_SERVICE_BASE
            response_data = _post_muasamcong_json(
                "um/org/get-detail-info",
                {"orgCode": normalized_org_code},
                service_base=service_base,
            )
            data = response_data.get("orgInfo") if isinstance(response_data, dict) else None
            returned_org_code = normalize_procurement_org_code(data.get("orgCode")) if isinstance(data, dict) else None
            if returned_org_code != normalized_org_code:
                return None
        else:
            service_base = MUASAMCONG_CONTRACTOR_SERVICE_BASE
            data = _post_muasamcong_json(
                "get-detail-approve-bidder",
                {"orgCode": normalized_org_code, "roleName": normalized_role},
                service_base=service_base,
            )

        returned_tax_code = extract_clean_tax_code(data.get("taxCode")) if isinstance(data, dict) else None
        requested_tax_code = extract_clean_tax_code(tax_code)
        if returned_tax_code and requested_tax_code and returned_tax_code != requested_tax_code:
            return None

        area_codes = list(dict.fromkeys(
            code for code in (data.get("officePro"), data.get("officeDis"), data.get("officeWar"))
            if code
        ))
        with ThreadPoolExecutor(max_workers=max(1, len(area_codes))) as executor:
            area_values = executor.map(
                lambda code: _fetch_muasamcong_area_name(code, service_base),
                area_codes,
            )
            area_names = dict(zip(area_codes, area_values))
        return _build_muasamcong_partner_info(
            data,
            normalized_org_code,
            area_names,
        )
    except Exception as error:
        print(f"[Partner Lookup] MuaSamCong error for {normalized_org_code}: {error}", flush=True)
        return None

def fetch_vietqr_info(tax_code):
    url = f"https://api.vietqr.io/v2/business/{tax_code}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                res_data = json.loads(response.read().decode('utf-8'))
                if res_data.get("code") == "00" and "data" in res_data:
                    data = res_data["data"]
                    return {
                        "name": data.get("name"),
                        "address": data.get("address"),
                        "short_name": data.get("shortName"),
                        "source": "VietQR"
                    }
    except Exception as e:
        print(f"[Partner Lookup] VietQR error for {tax_code}: {e}", flush=True)
    return None

def fetch_escodata_info(tax_code):

    digits_only = re.sub(r'[^0-9]', '', tax_code)
    url = f"https://escodata.net/api-mst/{digits_only}.htm"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                content = response.read().decode('utf-8')
                res_data = json.loads(content)
                name = res_data.get("name") or res_data.get("ten_cong_ty") or res_data.get("title")
                address = res_data.get("address") or res_data.get("dia_chi")
                if name:
                    return {
                        "name": name,
                        "address": address,
                        "short_name": res_data.get("short_name") or res_data.get("ten_viet_tat"),
                        "source": "Escodata"
                    }
    except Exception as e:
        print(f"[Partner Lookup] Escodata error for {tax_code}: {e}", flush=True)
    return None

def lookup_partner_info(tax_code="", org_code=None, role_name="NT"):


    cleaned_tax_code = extract_clean_tax_code(tax_code)
    procurement_org_code = normalize_procurement_org_code(org_code)
    has_explicit_procurement_org_code = bool(procurement_org_code)
    if not procurement_org_code:
        digits_only = re.sub(r"[^0-9]", "", str(cleaned_tax_code or ""))
        procurement_org_code = f"vn{digits_only}" if digits_only else None

    info = fetch_muasamcong_info(cleaned_tax_code or "", procurement_org_code, role_name=role_name)
    if info:
        return info


    if has_explicit_procurement_org_code:
        return None
    if not cleaned_tax_code:
        return None

    info = fetch_vietqr_info(cleaned_tax_code)
    if info:
        info["tax_code"] = cleaned_tax_code
        return info

    info = fetch_escodata_info(cleaned_tax_code)
    if info:
        info["tax_code"] = cleaned_tax_code
        return info
    return None

def run_partner_lookup_worker():
    _worker_debug("[Partner Worker] Started background contractor/investor lookup worker.")
    while True:
        try:

            time.sleep(30)

            conn = database.get_connection()
            cursor = conn.cursor()



            cursor.execute("""
                SELECT id, owner_id, ma_nha_thau, ma_so_thue, ten_nha_thau,
                       dia_chi, dia_chi_goc, ten_viet_tat
                FROM nha_thau
                WHERE (
                    ten_nha_thau IS NULL OR ten_nha_thau = ''
                    OR ten_nha_thau LIKE 'Nhà thầu%'
                    OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                    OR dia_chi IS NULL OR dia_chi = ''
                    OR lower(ma_so_thue) LIKE 'vn%'
                )
                  AND (
                    (ma_so_thue IS NOT NULL AND ma_so_thue != '')
                    OR (ma_nha_thau IS NOT NULL AND ma_nha_thau != '')
                  )
                LIMIT 5
            """)
            candidate_rows = cursor.fetchall()
            now = time.monotonic()
            rows = []
            for row in candidate_rows:
                signature = tuple(str(value or "").strip() for value in row[2:])
                attempt_key = (str(row[1]), str(row[0]), signature)
                last_attempt = _partner_lookup_attempts.get(attempt_key, 0)
                if now - last_attempt < PARTNER_LOOKUP_RETRY_SECONDS:
                    continue
                _partner_lookup_attempts[attempt_key] = now
                rows.append(row)

            if not rows:
                conn.close()
                continue

            _worker_debug(f"[Partner Worker] Found {len(rows)} contractors to lookup.")

            for row in rows:
                c_id, owner_id, ma_nha_thau, ma_so_thue, ten_nha_thau = row[:5]


                tax_code = extract_clean_tax_code(ma_so_thue)
                org_code = normalize_procurement_org_code(ma_nha_thau)

                if not tax_code and not org_code:
                    if ten_nha_thau is None or ten_nha_thau == '' or ten_nha_thau.startswith('Nhà thầu'):
                        cursor.execute("""
                            UPDATE nha_thau
                            SET ten_nha_thau = 'Nhà thầu (Mã số thuế không hợp lệ)'
                            WHERE id = ?
                        """, (c_id,))
                        conn.commit()
                    continue

                _worker_debug(f"[Partner Worker] Querying info for org={org_code or '-'}, tax={tax_code or '-'}...")
                info = lookup_partner_info(
                    tax_code or "",
                    org_code=org_code,
                    role_name="NT",
                )

                if info and info.get("name"):
                    new_name = info["name"].strip()
                    new_address_raw = (info.get("address") or "").strip()
                    new_address = parse_vietnam_address_to_internal(new_address_raw) if new_address_raw else ""
                    new_short_name = (info.get("short_name") or "").strip()
                    returned_tax_code = (info.get("tax_code") or "").strip()

                    _worker_debug(f"[Partner Worker] Found company info via {info['source']}: {new_name}")


                    cursor.execute(
                        "INSERT OR IGNORE INTO sync_metadata (owner_id, current_version) VALUES (?, 0)",
                        (owner_id,)
                    )
                    cursor.execute(
                        "UPDATE sync_metadata SET current_version = current_version + 1, updated_at = datetime('now', 'localtime') WHERE owner_id = ?",
                        (owner_id,)
                    )
                    cursor.execute("SELECT current_version FROM sync_metadata WHERE owner_id = ?", (owner_id,))
                    meta_row = cursor.fetchone()
                    new_sync_ver = int(meta_row[0]) if meta_row else 1


                    cursor.execute("""
                        UPDATE nha_thau
                        SET ten_nha_thau = ?,
                            dia_chi = CASE WHEN dia_chi IS NULL OR dia_chi = '' THEN ? ELSE dia_chi END,
                            dia_chi_goc = CASE WHEN dia_chi_goc IS NULL OR dia_chi_goc = '' THEN ? ELSE dia_chi_goc END,
                            ten_viet_tat = CASE WHEN ten_viet_tat IS NULL OR ten_viet_tat = '' THEN ? ELSE ten_viet_tat END,
                            ma_so_thue = CASE WHEN ? != '' THEN ? ELSE ma_so_thue END,
                            sync_version = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    """, (new_name, new_address, new_address_raw, new_short_name, returned_tax_code, returned_tax_code, new_sync_ver, c_id))


                    cursor.execute("""
                        UPDATE thong_tin_mo_thau
                        SET ten_nha_thau = ?,
                            sync_version = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE nha_thau_id = ?
                          AND (ten_nha_thau IS NULL OR ten_nha_thau = '' OR ten_nha_thau LIKE 'Nhà thầu%' OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)')
                    """, (new_name, new_sync_ver, c_id))

                    conn.commit()


                    try:
                        from routes.sync_routes import broadcast_websocket_event
                        broadcast_websocket_event(owner_id, {
                            "type": "sync_update",
                            "table": "nhathau",
                            "id": c_id,
                            "syncVersion": new_sync_ver
                        })
                    except Exception:
                        pass
                else:
                    _worker_debug(f"[Partner Worker] No info found for org={org_code or '-'}, tax={tax_code or '-' }.")

                    if ten_nha_thau is None or ten_nha_thau == '' or ten_nha_thau.startswith('Nhà thầu'):
                        cursor.execute("""
                            UPDATE nha_thau
                            SET ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                            WHERE id = ?
                        """, (c_id,))
                        conn.commit()

            conn.close()
        except Exception as e:
            print(f"[Partner Worker] Error in worker loop: {e}", flush=True)
            try:
                conn.close()
            except Exception:
                pass

def start_partner_background_service():
    global _partner_worker_started
    with _partner_worker_lock:
        if _partner_worker_started:
            return
        _partner_worker_started = True
        worker = threading.Thread(target=run_partner_lookup_worker, daemon=True)
        worker.start()
