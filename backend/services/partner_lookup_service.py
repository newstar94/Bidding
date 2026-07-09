import threading
import time
import urllib.request
import urllib.error
import json
import re
from datetime import datetime
from helpers import database

def extract_clean_tax_code(val):
    if not val:
        return None
    # Convert to string and strip whitespace
    val = str(val).strip()
    # Remove prefix "vn" if it exists (case-insensitive)
    if val.lower().startswith("vn"):
        val = val[2:]
    # Keep only digits and dashes
    cleaned = re.sub(r'[^0-9\-]', '', val)
    # Ensure it looks like a valid tax code length (usually 10 or 13 digits)
    digits_only = re.sub(r'[^0-9]', '', cleaned)
    if 9 <= len(digits_only) <= 14:
        return cleaned
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
    # Clean dashes since escodata might expect only digits
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

def lookup_partner_info(tax_code):
    # 1. Try VietQR
    info = fetch_vietqr_info(tax_code)
    if info:
        return info
    # 2. Try Escodata fallback
    info = fetch_escodata_info(tax_code)
    if info:
        return info
    return None

def run_partner_lookup_worker():
    print("[Partner Worker] Started background contractor/investor lookup worker.", flush=True)
    while True:
        try:
            # Run every 30 seconds
            time.sleep(30)
            
            conn = database.get_connection()
            cursor = conn.cursor()
            
            # Fetch contractors with tax code or contractor code but missing details
            cursor.execute("""
                SELECT id, owner_id, ma_nha_thau, ma_so_thue, ten_nha_thau 
                FROM nha_thau 
                WHERE (ten_nha_thau IS NULL OR ten_nha_thau = '' OR ten_nha_thau LIKE 'Nhà thầu%' OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)')
                  AND (
                    (ma_so_thue IS NOT NULL AND ma_so_thue != '') 
                    OR (ma_nha_thau IS NOT NULL AND ma_nha_thau != '')
                  )
                LIMIT 5
            """)
            rows = cursor.fetchall()
            
            if not rows:
                conn.close()
                continue
                
            print(f"[Partner Worker] Found {len(rows)} contractors to lookup.", flush=True)
            
            for row in rows:
                c_id, owner_id, ma_nha_thau, ma_so_thue, ten_nha_thau = row
                
                # Extract clean tax code
                tax_code = extract_clean_tax_code(ma_so_thue)
                if not tax_code:
                    tax_code = extract_clean_tax_code(ma_nha_thau)
                    
                if not tax_code:
                    if ten_nha_thau is None or ten_nha_thau == '' or ten_nha_thau.startswith('Nhà thầu'):
                        cursor.execute("""
                            UPDATE nha_thau 
                            SET ten_nha_thau = 'Nhà thầu (Mã số thuế không hợp lệ)'
                            WHERE id = ?
                        """, (c_id,))
                        conn.commit()
                    continue
                    
                print(f"[Partner Worker] Querying info for tax code: {tax_code}...", flush=True)
                info = lookup_partner_info(tax_code)
                
                if info and info.get("name"):
                    new_name = info["name"].strip()
                    new_address = (info.get("address") or "").strip()
                    new_short_name = (info.get("short_name") or "").strip()
                    
                    print(f"[Partner Worker] Found company info via {info['source']}: {new_name}", flush=True)
                    
                    # Update sync metadata and get new sync version
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
                    
                    # Update contractor table
                    cursor.execute("""
                        UPDATE nha_thau
                        SET ten_nha_thau = ?,
                            dia_chi = CASE WHEN dia_chi IS NULL OR dia_chi = '' THEN ? ELSE dia_chi END,
                            ten_viet_tat = CASE WHEN ten_viet_tat IS NULL OR ten_viet_tat = '' THEN ? ELSE ten_viet_tat END,
                            ma_so_thue = CASE WHEN ma_so_thue IS NULL OR ma_so_thue = '' THEN ? ELSE ma_so_thue END,
                            sync_version = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE id = ?
                    """, (new_name, new_address, new_short_name, tax_code, new_sync_ver, c_id))
                    
                    # Update thong_tin_mo_thau snapshot if name is empty/generic/placeholder
                    cursor.execute("""
                        UPDATE thong_tin_mo_thau
                        SET ten_nha_thau = ?,
                            sync_version = ?,
                            updated_at = datetime('now', 'localtime')
                        WHERE nha_thau_id = ?
                          AND (ten_nha_thau IS NULL OR ten_nha_thau = '' OR ten_nha_thau LIKE 'Nhà thầu%' OR ten_nha_thau = 'Nhà thầu (Chưa cập nhật thông tin)')
                    """, (new_name, new_sync_ver, c_id))
                    
                    conn.commit()
                    
                    # Broadcast sync event to websockets
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
                    print(f"[Partner Worker] No info found for tax code: {tax_code}.", flush=True)
                    # Set a temporary placeholder so we don't query it continuously
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
    worker = threading.Thread(target=run_partner_lookup_worker, daemon=True)
    worker.start()
