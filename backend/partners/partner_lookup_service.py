import os
import hashlib
import threading
import time
import urllib.request
import urllib.error
import json
import re
import ssl
import random
import uuid
from backend.shared.helpers import database
from backend.partners.address_parser import compose_external_address, parse_vietnam_address_to_internal
from backend.shared.text_utils import normalize_organization_name, normalize_person_name
from backend.shared.logging_utils import log_error, log_structured_event
from backend.observability.metrics import record_partner_upstream
from backend.shared.safe_http import open_allowlisted_https


PARTNER_LOOKUP_RETRY_SECONDS = 6 * 60 * 60
_partner_lookup_attempts = {}
_partner_worker_started = False
_partner_worker_lock = threading.Lock()
_partner_work_event = threading.Event()
_lookup_locks = tuple(threading.Lock() for _ in range(64))
PARTNER_LOOKUP_CACHE_VERSION = "2"


class PartnerLookupBusyError(RuntimeError):
    """The bounded outbound lookup capacity is exhausted."""


class PartnerUpstreamError(RuntimeError):
    """An upstream failed before returning a valid not-found/success response."""


def _bounded_env_int(name, default, minimum, maximum):
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _bounded_env_float(name, default, minimum, maximum):
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


_outbound_slots = threading.BoundedSemaphore(
    _bounded_env_int("PARTNER_LOOKUP_MAX_CONCURRENCY", 4, 1, 16)
)


def _lookup_cache_key(tax_code, org_code, role_name):
    material = (
        f"{PARTNER_LOOKUP_CACHE_VERSION}\0{tax_code or ''}\0"
        f"{org_code or ''}\0{role_name or ''}"
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _cache_get(cache_key):
    now = int(time.time())
    conn = database.get_connection()
    try:
        row = conn.execute(
            """SELECT found, result_json FROM partner_lookup_cache
               WHERE cache_key = ? AND expires_at > ?""",
            (cache_key, now),
        ).fetchone()
        if row is None:
            return False, None
        if not row["found"]:
            return True, None
        try:
            value = json.loads(row["result_json"] or "")
        except (TypeError, json.JSONDecodeError):
            return False, None
        return (True, value) if isinstance(value, dict) else (False, None)
    finally:
        conn.close()


def _cache_put(cache_key, result):
    now = int(time.time())
    found = isinstance(result, dict)
    ttl = _bounded_env_int(
        "PARTNER_LOOKUP_POSITIVE_CACHE_SECONDS" if found else "PARTNER_LOOKUP_NEGATIVE_CACHE_SECONDS",
        6 * 3600 if found else 300,
        30,
        7 * 86400,
    )
    result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":")) if found else None
    if result_json and len(result_json.encode("utf-8")) > 512 * 1024:
        compact = {key: value for key, value in result.items() if key not in {"procurement_data", "businesses"}}
        result_json = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
        result = compact
    if result_json and len(result_json.encode("utf-8")) > 512 * 1024:
        # The provider response remains usable for this request, but oversized
        # material is never persisted in the shared cache.
        return result
    conn = database.get_connection()
    try:
        conn.execute(
            """INSERT INTO partner_lookup_cache
               (cache_key, result_json, found, expires_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (cache_key) DO UPDATE SET
                   result_json = excluded.result_json,
                   found = excluded.found,
                   expires_at = excluded.expires_at,
                   updated_at = excluded.updated_at""",
            (cache_key, result_json, 1 if found else 0, now + ttl, now),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return result


def _circuit_allows(upstream):
    now = int(time.time())
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        conn.execute(
            """INSERT INTO partner_upstream_health
               (upstream, failure_count, opened_until, probe_locked_until, updated_at)
               VALUES (?, 0, 0, 0, ?) ON CONFLICT (upstream) DO NOTHING""",
            (upstream, now),
        )
        row = conn.execute(
            """SELECT failure_count, opened_until, probe_locked_until
               FROM partner_upstream_health WHERE upstream = ? FOR UPDATE""",
            (upstream,),
        ).fetchone()
        allowed = True
        if int(row["opened_until"]) > now:
            allowed = False
        elif int(row["failure_count"]) >= 3:
            if int(row["probe_locked_until"]) > now:
                allowed = False
            else:
                conn.execute(
                    "UPDATE partner_upstream_health SET probe_locked_until = ?, updated_at = ? WHERE upstream = ?",
                    (now + 15, now, upstream),
                )
        conn.commit()
        return allowed
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _circuit_success(upstream):
    now = int(time.time())
    conn = database.get_connection()
    try:
        conn.execute(
            """UPDATE partner_upstream_health
               SET failure_count = 0, opened_until = 0, probe_locked_until = 0, updated_at = ?
               WHERE upstream = ?""",
            (now, upstream),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _circuit_failure(upstream):
    now = int(time.time())
    conn = database.get_connection()
    try:
        conn.execute("BEGIN")
        row = conn.execute(
            "SELECT failure_count FROM partner_upstream_health WHERE upstream = ? FOR UPDATE",
            (upstream,),
        ).fetchone()
        failures = int(row["failure_count"] if row else 0) + 1
        open_seconds = min(600, 30 * (2 ** max(0, failures - 3))) if failures >= 3 else 0
        conn.execute(
            """INSERT INTO partner_upstream_health
               (upstream, failure_count, opened_until, probe_locked_until, updated_at)
               VALUES (?, ?, ?, 0, ?)
               ON CONFLICT (upstream) DO UPDATE SET
                   failure_count = excluded.failure_count,
                   opened_until = excluded.opened_until,
                   probe_locked_until = 0,
                   updated_at = excluded.updated_at""",
            (upstream, failures, now + open_seconds, now),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _call_upstream(upstream, function, *args, **kwargs):
    if not _circuit_allows(upstream):
        log_structured_event("partner.upstream_circuit_open", level="WARN", fields={"upstream": upstream})
        record_partner_upstream(upstream, "circuit_open")
        return False, None
    attempts = _bounded_env_int("PARTNER_UPSTREAM_MAX_ATTEMPTS", 2, 1, 3)
    for attempt in range(attempts):
        try:
            result = function(*args, **kwargs)
            _circuit_success(upstream)
            record_partner_upstream(upstream, "found" if result else "not_found")
            log_structured_event("partner.upstream_completed", fields={"upstream": upstream, "found": bool(result)})
            return True, result
        except PartnerUpstreamError as exc:
            if attempt + 1 < attempts:
                time.sleep(min(2.0, 0.2 * (2 ** attempt) + random.uniform(0.0, 0.25)))
                continue
            _circuit_failure(upstream)
            root_error = exc.__cause__ or exc
            outcome = "timeout" if isinstance(root_error, (TimeoutError,)) else "error"
            record_partner_upstream(upstream, outcome)
            log_structured_event(
                "partner.upstream_failed",
                level="WARN",
                fields={"upstream": upstream, "errorType": type(root_error).__name__},
            )
            return False, None

PLACEHOLDER_CONTRACTOR_NAMES = {
    "Nhà thầu (Chưa cập nhật thông tin)",
    "Nhà thầu (Mã số thuế không hợp lệ)",
}


def _is_placeholder_contractor_name(value):
    return not str(value or "").strip() or str(value).strip() in PLACEHOLDER_CONTRACTOR_NAMES


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
    # Keep certificate and hostname verification while avoiding the upstream's
    # obsolete finite-field DHE parameters. MuaSamCong also supports modern
    # ECDHE suites, so preferring those resolves DH_KEY_TOO_SMALL without
    # lowering OpenSSL's security level or weakening the application process.
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.set_ciphers(
        "ECDHE+AESGCM:ECDHE+CHACHA20:!DHE:!aNULL:!eNULL:!MD5:!DSS"
    )
    return context


MUASAMCONG_SSL_CONTEXT = _create_muasamcong_ssl_context()


def normalize_procurement_org_code(value):
    raw_value = re.sub(r"[\s._-]+", "", str(value or "").strip().lower())
    match = re.fullmatch(r"(vnp|vnz|vn)(\d{9,14})", raw_value)
    return f"{match.group(1)}{match.group(2)}" if match else None


def _post_muasamcong_json(
    endpoint,
    payload,
    timeout=None,
    service_base=MUASAMCONG_CONTRACTOR_SERVICE_BASE,
):
    if timeout is None:
        timeout = _bounded_env_float(
            "PARTNER_MUASAMCONG_TIMEOUT_SECONDS", 6.0, 1.0, 15.0
        )
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
    try:
        with open_allowlisted_https(
            request,
            allowed_hosts={"muasamcong.mpi.gov.vn"},
            timeout=timeout,
            context=MUASAMCONG_SSL_CONTEXT,
        ) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > 1024 * 1024:
                raise PartnerUpstreamError("MuaSamCong response is too large")
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise PartnerUpstreamError("MuaSamCong response is too large")
            value = json.loads(raw.decode("utf-8-sig"))
            if not isinstance(value, (dict, list)):
                raise PartnerUpstreamError("MuaSamCong response schema is invalid")
            return value
    except PartnerUpstreamError:
        raise
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise PartnerUpstreamError("MuaSamCong request failed") from exc


def _fetch_muasamcong_area_name(code, service_base=MUASAMCONG_CONTRACTOR_SERVICE_BASE):
    if not code:
        return ""
    try:
        result = _post_muasamcong_json(
            "get-area-by-code",
            {"queryParams": {"code": {"equals": code}}},
            timeout=_bounded_env_float(
                "PARTNER_MUASAMCONG_AREA_TIMEOUT_SECONDS", 2.0, 0.5, 5.0
            ),
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
        # These auxiliary calls remain inside the single bounded lookup slot.
        # Avoid spawning an unbounded/nested thread pool per incoming request.
        area_names = {
            code: _fetch_muasamcong_area_name(code, service_base)
            for code in area_codes
        }
        return _build_muasamcong_partner_info(
            data,
            normalized_org_code,
            area_names,
        )
    except PartnerUpstreamError:
        raise
    except Exception as error:
        raise PartnerUpstreamError("MuaSamCong response processing failed") from error

def fetch_vietqr_info(tax_code):
    url = f"https://api.vietqr.io/v2/business/{tax_code}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with open_allowlisted_https(
            req,
            allowed_hosts={"api.vietqr.io"},
            timeout=_bounded_env_float(
                "PARTNER_VIETQR_TIMEOUT_SECONDS", 4.0, 1.0, 10.0
            ),
        ) as response:
            if response.status == 200:
                raw = response.read(512 * 1024 + 1)
                if len(raw) > 512 * 1024:
                    raise PartnerUpstreamError("VietQR response is too large")
                res_data = json.loads(raw.decode('utf-8'))
                if not isinstance(res_data, dict):
                    raise PartnerUpstreamError("VietQR response schema is invalid")
                if res_data.get("code") == "00" and "data" in res_data:
                    data = res_data["data"]
                    if not isinstance(data, dict):
                        raise PartnerUpstreamError("VietQR response schema is invalid")
                    return {
                        "name": data.get("name"),
                        "address": data.get("address"),
                        "short_name": data.get("shortName"),
                        "source": "VietQR"
                    }
    except urllib.error.HTTPError as exc:
        if exc.code in {400, 404}:
            return None
        raise PartnerUpstreamError("VietQR request failed") from exc
    except PartnerUpstreamError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise PartnerUpstreamError("VietQR request failed") from exc
    return None

def fetch_escodata_info(tax_code):

    digits_only = re.sub(r'[^0-9]', '', tax_code)
    url = f"https://escodata.net/api-mst/{digits_only}.htm"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with open_allowlisted_https(
            req,
            allowed_hosts={"escodata.net"},
            timeout=_bounded_env_float(
                "PARTNER_ESCODATA_TIMEOUT_SECONDS", 4.0, 1.0, 10.0
            ),
        ) as response:
            if response.status == 200:
                raw = response.read(512 * 1024 + 1)
                if len(raw) > 512 * 1024:
                    raise PartnerUpstreamError("Escodata response is too large")
                content = raw.decode('utf-8')
                res_data = json.loads(content)
                if not isinstance(res_data, dict):
                    raise PartnerUpstreamError("Escodata response schema is invalid")
                name = res_data.get("name") or res_data.get("ten_cong_ty") or res_data.get("title")
                address = res_data.get("address") or res_data.get("dia_chi")
                if name:
                    return {
                        "name": name,
                        "address": address,
                        "short_name": res_data.get("short_name") or res_data.get("ten_viet_tat"),
                        "source": "Escodata"
                    }
    except urllib.error.HTTPError as exc:
        if exc.code in {400, 404}:
            return None
        raise PartnerUpstreamError("Escodata request failed") from exc
    except PartnerUpstreamError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise PartnerUpstreamError("Escodata request failed") from exc
    return None

def lookup_partner_info(tax_code="", org_code=None, role_name="NT"):
    cleaned_tax_code = extract_clean_tax_code(tax_code)
    procurement_org_code = normalize_procurement_org_code(org_code)
    has_explicit_procurement_org_code = bool(procurement_org_code)
    normalized_role = str(role_name or "NT").strip().upper()
    if normalized_role not in {"NT", "CDT"}:
        normalized_role = "NT"
    if not procurement_org_code:
        digits_only = re.sub(r"[^0-9]", "", str(cleaned_tax_code or ""))
        procurement_org_code = f"vn{digits_only}" if digits_only else None

    cache_key = _lookup_cache_key(
        cleaned_tax_code or "", procurement_org_code or "", normalized_role
    )
    cached, cached_value = _cache_get(cache_key)
    if cached:
        return cached_value

    lookup_lock = _lookup_locks[int(cache_key[:8], 16) % len(_lookup_locks)]
    lock_timeout = _bounded_env_float(
        "PARTNER_LOOKUP_LOCK_TIMEOUT_SECONDS", 1.0, 0.05, 5.0
    )
    if not lookup_lock.acquire(timeout=lock_timeout):
        raise PartnerLookupBusyError("A lookup for this identifier is already running")
    try:
        # Collapse a cache miss stampede for the same identifier.
        cached, cached_value = _cache_get(cache_key)
        if cached:
            return cached_value

        slot_timeout = _bounded_env_float(
            "PARTNER_LOOKUP_SLOT_TIMEOUT_SECONDS", 0.25, 0.05, 3.0
        )
        if not _outbound_slots.acquire(timeout=slot_timeout):
            raise PartnerLookupBusyError("Outbound lookup capacity is exhausted")
        try:
            msc_available, info = _call_upstream(
                "muasamcong",
                fetch_muasamcong_info,
                cleaned_tax_code or "",
                procurement_org_code,
                role_name=normalized_role,
            )
            if info:
                return _cache_put(cache_key, info)

            if not cleaned_tax_code:
                if not msc_available:
                    raise PartnerUpstreamError("MuaSamCong is unavailable")
                _cache_put(cache_key, None)
                return None

            vietqr_available, info = _call_upstream(
                "vietqr", fetch_vietqr_info, cleaned_tax_code
            )
            if info:
                info["tax_code"] = cleaned_tax_code
                if has_explicit_procurement_org_code:
                    info["org_code"] = procurement_org_code
                return _cache_put(cache_key, info)

            escodata_available, info = _call_upstream(
                "escodata", fetch_escodata_info, cleaned_tax_code
            )
            if info:
                info["tax_code"] = cleaned_tax_code
                if has_explicit_procurement_org_code:
                    info["org_code"] = procurement_org_code
                return _cache_put(cache_key, info)

            # Once a valid tax code is available, the tax-code providers are
            # sufficient fallback sources. MuaSamCong may be unavailable (for
            # example because its TLS endpoint is temporarily incompatible)
            # without turning a completed tax-code lookup into a 502.
            # A negative result is still cached only when both fallback
            # providers completed successfully.
            if not (vietqr_available and escodata_available):
                raise PartnerUpstreamError("One or more partner upstreams are unavailable")
            _cache_put(cache_key, None)
            return None
        finally:
            _outbound_slots.release()
    finally:
        lookup_lock.release()

def _legacy_run_partner_lookup_worker():
    _worker_debug("[Partner Worker] Started on-demand contractor/investor lookup worker.")
    while True:
        try:
            _partner_work_event.wait()
            _partner_work_event.clear()

            conn = database.get_connection()
            cursor = conn.cursor()



            cursor.execute("""
                SELECT id, organization_id, ma_nha_thau, ma_so_thue, ten_nha_thau,
                       dia_chi, dia_chi_goc, ten_viet_tat
                FROM nha_thau
                WHERE (
                    ten_nha_thau IS NULL OR ten_nha_thau = ''
                    OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                    OR ten_nha_thau = 'Nhà thầu (Mã số thuế không hợp lệ)'
                    OR dia_chi IS NULL OR dia_chi = ''
                    OR lower(ma_so_thue) LIKE 'vn%'
                )
                  AND (
                    (ma_so_thue IS NOT NULL AND ma_so_thue != '')
                    OR (ma_nha_thau IS NOT NULL AND ma_nha_thau != '')
                  )
                LIMIT 100
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

            has_more_work = len(rows) > 5
            rows = rows[:5]

            if not rows:
                conn.close()
                continue

            _worker_debug(f"[Partner Worker] Found {len(rows)} contractors to lookup.")

            for row in rows:
                c_id, organization_id, ma_nha_thau, ma_so_thue, ten_nha_thau = row[:5]


                tax_code = extract_clean_tax_code(ma_so_thue)
                org_code = normalize_procurement_org_code(ma_nha_thau)

                if not tax_code and not org_code:
                    if _is_placeholder_contractor_name(ten_nha_thau):
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
                        "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, 0) ON CONFLICT (organization_id) DO NOTHING",
                        (organization_id,)
                    )
                    cursor.execute(
                        "UPDATE sync_metadata SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?",
                        (organization_id,)
                    )
                    cursor.execute("SELECT current_version FROM sync_metadata WHERE organization_id = ?", (organization_id,))
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
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (new_name, new_address, new_address_raw, new_short_name, returned_tax_code, returned_tax_code, new_sync_ver, c_id))


                    cursor.execute("""
                        UPDATE thong_tin_mo_thau
                        SET ten_nha_thau = ?,
                            sync_version = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE nha_thau_id = ?
                          AND (ten_nha_thau IS NULL OR ten_nha_thau = ''
                               OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                               OR ten_nha_thau = 'Nhà thầu (Mã số thuế không hợp lệ)')
                    """, (new_name, new_sync_ver, c_id))

                    conn.commit()


                    try:
                        from backend.sync.api import broadcast_websocket_event
                        broadcast_websocket_event(organization_id, {
                            "type": "sync_update",
                            "table": "nhathau",
                            "id": c_id,
                            "syncVersion": new_sync_ver
                        })
                    except Exception:
                        pass
                else:
                    _worker_debug(f"[Partner Worker] No info found for org={org_code or '-'}, tax={tax_code or '-' }.")

                    if _is_placeholder_contractor_name(ten_nha_thau):
                        cursor.execute("""
                            UPDATE nha_thau
                            SET ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                            WHERE id = ?
                        """, (c_id,))
                        conn.commit()

            if has_more_work:
                _partner_work_event.set()

            conn.close()
        except Exception as e:
            log_error(e, "PartnerLookup.Worker")
            try:
                conn.close()
            except Exception:
                pass

_PARTNER_WORKER_ID = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"


def _enqueue_partner_enrichment_jobs(organization_id, contractor_ids):
    normalized_ids = sorted({
        str(contractor_id or "").strip()
        for contractor_id in contractor_ids or ()
        if str(contractor_id or "").strip()
    })
    if not organization_id or not normalized_ids:
        return 0
    now = int(time.time())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        queued = 0
        for contractor_id in normalized_ids:
            job_id = "partner-job-" + hashlib.sha256(
                f"{organization_id}\0{contractor_id}".encode("utf-8")
            ).hexdigest()
            cursor = connection.execute(
                """
                INSERT INTO partner_enrichment_jobs (
                    id, organization_id, contractor_id, status,
                    attempt_count, available_at, locked_at, locked_by,
                    last_error_code, created_at, updated_at
                ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
                ON CONFLICT (organization_id, contractor_id) DO UPDATE SET
                    status = 'pending',
                    attempt_count = 0,
                    available_at = excluded.available_at,
                    locked_at = NULL,
                    locked_by = NULL,
                    last_error_code = NULL,
                    updated_at = excluded.updated_at
                WHERE partner_enrichment_jobs.status <> 'processing'
                """,
                (
                    job_id,
                    organization_id,
                    contractor_id,
                    now,
                    now,
                    now,
                ),
            )
            if cursor.rowcount:
                queued += 1
        connection.commit()
        return queued
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _claim_partner_enrichment_job():
    now = int(time.time())
    stale_before = now - _bounded_env_int(
        "PARTNER_JOB_STALE_SECONDS",
        300,
        60,
        3_600,
    )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            """
            SELECT id, organization_id, contractor_id, attempt_count
            FROM partner_enrichment_jobs
            WHERE (
                    status IN ('pending', 'retry')
                    AND available_at <= ?
                  )
               OR (
                    status = 'processing'
                    AND locked_at <= ?
                  )
            ORDER BY available_at, created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """,
            (now, stale_before),
        ).fetchone()
        if not row:
            connection.commit()
            return None
        attempt_count = int(row["attempt_count"] or 0) + 1
        connection.execute(
            """
            UPDATE partner_enrichment_jobs
            SET status = 'processing', attempt_count = ?,
                locked_at = ?, locked_by = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                attempt_count,
                now,
                _PARTNER_WORKER_ID,
                now,
                row["id"],
            ),
        )
        connection.commit()
        job = dict(row)
        job["attempt_count"] = attempt_count
        return job
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _finish_partner_enrichment_job(job, *, error=None):
    now = int(time.time())
    max_attempts = _bounded_env_int(
        "PARTNER_ENRICHMENT_MAX_ATTEMPTS",
        5,
        1,
        20,
    )
    attempts = int(job.get("attempt_count") or 1)
    if error is None:
        status = "completed"
        available_at = now
        error_code = None
    elif attempts >= max_attempts:
        status = "failed"
        available_at = now
        error_code = error.__class__.__name__[:96]
    else:
        status = "retry"
        available_at = now + min(3_600, 30 * (2 ** (attempts - 1)))
        error_code = error.__class__.__name__[:96]
    connection = database.get_connection()
    try:
        connection.execute(
            """
            UPDATE partner_enrichment_jobs
            SET status = ?, available_at = ?, locked_at = NULL,
                locked_by = NULL, last_error_code = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                available_at,
                error_code,
                now,
                job["id"],
            ),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _load_partner_job_contractor(job):
    connection = database.get_connection()
    try:
        row = connection.execute(
            """
            SELECT id, organization_id, ma_nha_thau, ma_so_thue,
                   ten_nha_thau, dia_chi, dia_chi_goc, ten_viet_tat
            FROM nha_thau
            WHERE organization_id = ? AND id = ?
            LIMIT 1
            """,
            (job["organization_id"], job["contractor_id"]),
        ).fetchone()
        return dict(row) if row else None
    finally:
        connection.close()


def _apply_partner_enrichment(job, contractor, info):
    organization_id = str(job["organization_id"])
    contractor_id = str(job["contractor_id"])
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        current = connection.execute(
            """
            SELECT ten_nha_thau
            FROM nha_thau
            WHERE organization_id = ? AND id = ?
            FOR UPDATE
            """,
            (organization_id, contractor_id),
        ).fetchone()
        if not current:
            connection.rollback()
            return
        if info and info.get("name"):
            new_name = str(info["name"]).strip()
            new_address_raw = str(info.get("address") or "").strip()
            new_address = (
                parse_vietnam_address_to_internal(new_address_raw)
                if new_address_raw
                else ""
            )
            new_short_name = str(info.get("short_name") or "").strip()
            returned_tax_code = str(info.get("tax_code") or "").strip()
            connection.execute(
                """
                INSERT INTO sync_metadata (organization_id, current_version)
                VALUES (?, 0) ON CONFLICT (organization_id) DO NOTHING
                """,
                (organization_id,),
            )
            new_sync_version = connection.execute(
                """
                UPDATE sync_metadata
                SET current_version = current_version + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ?
                RETURNING current_version
                """,
                (organization_id,),
            ).fetchone()[0]
            connection.execute(
                """
                UPDATE nha_thau
                SET ten_nha_thau = ?,
                    dia_chi = CASE
                        WHEN dia_chi IS NULL OR dia_chi = '' THEN ?
                        ELSE dia_chi END,
                    dia_chi_goc = CASE
                        WHEN dia_chi_goc IS NULL OR dia_chi_goc = '' THEN ?
                        ELSE dia_chi_goc END,
                    ten_viet_tat = CASE
                        WHEN ten_viet_tat IS NULL OR ten_viet_tat = '' THEN ?
                        ELSE ten_viet_tat END,
                    ma_so_thue = CASE WHEN ? <> '' THEN ? ELSE ma_so_thue END,
                    sync_version = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ?
                """,
                (
                    new_name,
                    new_address,
                    new_address_raw,
                    new_short_name,
                    returned_tax_code,
                    returned_tax_code,
                    new_sync_version,
                    organization_id,
                    contractor_id,
                ),
            )
            connection.execute(
                """
                UPDATE thong_tin_mo_thau
                SET ten_nha_thau = ?, sync_version = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND nha_thau_id = ?
                  AND (
                    ten_nha_thau IS NULL OR ten_nha_thau = ''
                    OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                    OR ten_nha_thau = 'Nhà thầu (Mã số thuế không hợp lệ)'
                  )
                """,
                (
                    new_name,
                    new_sync_version,
                    organization_id,
                    contractor_id,
                ),
            )
        elif _is_placeholder_contractor_name(current["ten_nha_thau"]):
            connection.execute(
                """
                UPDATE nha_thau
                SET ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)'
                WHERE organization_id = ? AND id = ?
                """,
                (organization_id, contractor_id),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    if info and info.get("name"):
        try:
            from backend.sync.api import broadcast_websocket_event

            broadcast_websocket_event(
                organization_id,
                {
                    "type": "sync_update",
                    "table": "nhathau",
                    "id": contractor_id,
                    "syncVersion": new_sync_version,
                },
            )
        except Exception:
            pass


def _process_partner_enrichment_job(job):
    contractor = _load_partner_job_contractor(job)
    if contractor is None:
        _finish_partner_enrichment_job(job)
        return
    tax_code = extract_clean_tax_code(contractor.get("ma_so_thue"))
    org_code = normalize_procurement_org_code(contractor.get("ma_nha_thau"))
    needs_enrichment = (
        _is_placeholder_contractor_name(contractor.get("ten_nha_thau"))
        or not str(contractor.get("dia_chi") or "").strip()
        or str(contractor.get("ma_so_thue") or "").lower().startswith("vn")
    )
    if not needs_enrichment:
        _finish_partner_enrichment_job(job)
        return
    try:
        info = (
            lookup_partner_info(
                tax_code or "",
                org_code=org_code,
                role_name="NT",
            )
            if tax_code or org_code
            else None
        )
        _apply_partner_enrichment(job, contractor, info)
        _finish_partner_enrichment_job(job)
    except Exception as error:
        _finish_partner_enrichment_job(job, error=error)
        raise


def run_partner_lookup_worker():
    """Claim durable jobs with SKIP LOCKED; never hold DB state over network I/O."""

    _worker_debug("[Partner Worker] Durable enrichment worker started.")
    while True:
        _partner_work_event.wait(timeout=5)
        _partner_work_event.clear()
        while True:
            try:
                job = _claim_partner_enrichment_job()
                if job is None:
                    break
                _process_partner_enrichment_job(job)
            except Exception as error:
                log_error(error, "PartnerLookup.DurableWorker")


def start_partner_background_service():
    global _partner_worker_started
    with _partner_worker_lock:
        if _partner_worker_started:
            return
        _partner_worker_started = True
        worker = threading.Thread(target=run_partner_lookup_worker, daemon=True)
        worker.start()


def request_partner_enrichment(organization_id=None, contractor_ids=None):
    """Persist work before waking a process-local poller."""

    if organization_id and contractor_ids:
        _enqueue_partner_enrichment_jobs(organization_id, contractor_ids)
    start_partner_background_service()
    _partner_work_event.set()
