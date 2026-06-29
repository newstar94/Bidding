import sqlite3
import json
from datetime import datetime

def main():
    conn = sqlite3.connect('models/bidding.db')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Lay tat ca goi thau, tim Xay lap
    c.execute('SELECT id, id_goc, ma_goi_thau, ten_goi_thau, trang_thai, is_latest, ke_hoach_id FROM goi_thau WHERE is_latest=1')
    rows = c.fetchall()
    
    print("=== Goi thau (is_latest=1) ===")
    for r in rows:
        row = dict(r)
        print(json.dumps(row, ensure_ascii=True))
    
    # Lay thong tin mo thau
    c.execute('SELECT id, goi_thau_id, ten_nha_thau, gia_du_thau, trang_thai FROM thong_tin_mo_thau')
    rows2 = c.fetchall()
    print("\n=== Thong tin mo thau ===")
    for r in rows2:
        row = dict(r)
        # trang_thai may not exist - handle gracefully
        row.pop('trang_thai', None)
        print(json.dumps(row, ensure_ascii=True))

if __name__ == '__main__':
    main()
