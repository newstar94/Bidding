import os
import re
import json
from io import BytesIO
import pandas as pd
from openpyxl import Workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from helpers import (
    database,
    clean_id,
    VietnameseFloat,
    SCHEMA_DINH_NGHIA,
    to_camel_case,
    load_base64_image
)
from helpers_py.excel_handler import (
    parse_excel,
    _schema_to_headers,
    _schema_to_options,
    _schema_to_map_cols
)
from helpers_py.sync_mapper import fetch_package_lot_codes

def create_excel_template(import_type):
    """Tạo file mẫu Excel nhập liệu cơ bản cho chudautu, kehoach, goithau, nhathau, chuyengia, hopdong..."""
    cols = _schema_to_headers(import_type)
    if not cols:
        raise ValueError(f"Invalid type: {import_type}")

    options_map = _schema_to_options(import_type)

    wb = Workbook()
    ws = wb.active
    ws.title = "Nhap Lieu"

    options_ranges = {}
    if options_map:
        ws_options = wb.create_sheet(title="Dropdowns")
        ws_options.sheet_state = 'hidden'
        for opt_idx, (opt_col_name, opt_values) in enumerate(options_map.items(), start=1):
            opt_col_letter = get_column_letter(opt_idx)
            for val_idx, val in enumerate(opt_values, start=1):
                ws_options.cell(row=val_idx, column=opt_idx, value=val)
            options_ranges[opt_col_name] = f"Dropdowns!${opt_col_letter}$1:${opt_col_letter}${len(opt_values)}"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    ws.append(cols)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(cols) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for r in range(2, 52):
        ws.row_dimensions[r].height = 22
        for col_idx in range(1, len(cols) + 1):
            cell = ws.cell(row=r, column=col_idx)
            cell.border = thin_border

    # Data validations
    for col_idx, col_name in enumerate(cols, start=1):
        if col_name in options_ranges:
            col_letter = get_column_letter(col_idx)
            formula = options_ranges[col_name]
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            dv.error = 'Giá trị nhập không hợp lệ, vui lòng chọn từ danh sách'
            dv.errorTitle = 'Lỗi nhập dữ liệu'
            dv.prompt = 'Vui lòng chọn giá trị từ danh sách'
            dv.promptTitle = col_name
            ws.add_data_validation(dv)
            dv.add(f"{col_letter}2:{col_letter}50")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)

    return wb

def create_mothau_template(case_type, lot_codes):
    """Tạo template Excel mẫu mở thầu."""
    headers = []
    options_map = {
        'Loại nhà thầu': ['Độc lập', 'Liên danh']
    }
    
    if case_type == 'TU_VAN':
        headers = ['Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Hiệu lực E-HSĐXKT (ngày)', 'Thời gian thực hiện (ngày)']
    elif case_type == '1G2T_NO_LOT':
        headers = ['Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Đảm bảo dự thầu (VND)', 'Hiệu lực đảm bảo (ngày)', 'Hiệu lực E-HSĐXKT (ngày)']
    elif case_type == '1G2T_WITH_LOT':
        headers = ['Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Đảm bảo dự thầu (VND)', 'Hiệu lực đảm bảo (ngày)', 'Hiệu lực E-HSĐXKT (ngày)']
        if lot_codes:
            options_map['Mã phần lô'] = lot_codes
    elif case_type == '1G1T_NO_LOT':
        headers = ['Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Giá dự thầu (VND)', 'Tỷ lệ giảm giá (%)', 'Giá sau giảm giá (nếu có)', 'Hiệu lực E-HSDT (ngày)', 'Giá trị ĐB DT (VND)', 'Hiệu lực ĐB (ngày)', 'Thời gian thực hiện (ngày)']
    elif case_type == '1G1T_WITH_LOT':
        headers = ['Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Giá dự thầu (VND)', 'Tỷ lệ giảm (%)', 'Giá sau giảm giá (nếu có)', 'Hiệu lực E-HSDT (ngày)', 'Giá trị ĐB (VND)', 'Hiệu lực ĐB', 'Thời gian thực hiện (ngày)']
        if lot_codes:
            options_map['Mã phần lô'] = lot_codes

    wb = Workbook()
    ws = wb.active
    ws.title = "Mo Thau"

    options_ranges = {}
    if options_map:
        ws_options = wb.create_sheet(title="Dropdowns")
        ws_options.sheet_state = 'hidden'
        for opt_idx, (opt_col_name, opt_values) in enumerate(options_map.items(), start=1):
            opt_col_letter = get_column_letter(opt_idx)
            for val_idx, val in enumerate(opt_values, start=1):
                ws_options.cell(row=val_idx, column=opt_idx, value=val)
            options_ranges[opt_col_name] = f"Dropdowns!${opt_col_letter}$1:${opt_col_letter}${len(opt_values)}"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for r in range(2, 52):
        ws.row_dimensions[r].height = 22
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=r, column=col_idx)
            cell.border = thin_border

    # Data validations
    for col_idx, col_name in enumerate(headers, start=1):
        if col_name in options_ranges:
            col_letter = get_column_letter(col_idx)
            formula = options_ranges[col_name]
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            dv.error = 'Giá trị nhập không hợp lệ, vui lòng chọn từ danh sách'
            dv.errorTitle = 'Lỗi nhập dữ liệu'
            dv.prompt = 'Vui lòng chọn giá trị từ danh sách'
            dv.promptTitle = col_name
            ws.add_data_validation(dv)
            dv.add(f"{col_letter}2:{col_letter}50")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)

    return wb

def create_opening_fin_template(pkg_id_clean, org_name):
    """Tạo template Excel mở đề xuất tài chính."""
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT ma_dinh_danh, ten_nha_thau, gia_du_thau, ty_le_giam_gia, gia_sau_giam_gia,
               hieu_luc_hsdt, thoi_gian_thuc_hien,
               danh_gia_hop_le, danh_gia_nang_luc, danh_gia_ky_thuat, danh_gia_ket_luan
        FROM thong_tin_mo_thau
        WHERE goi_thau_id = ? AND owner_id = ?
    """, (pkg_id_clean, org_name))
    bids = cursor.fetchall()
    conn.close()
    
    qualified_bids = []
    for b in bids:
        danh_gia_hop_le = b[7]
        danh_gia_nang_luc = b[8]
        danh_gia_ky_thuat = b[9]
        danh_gia_ket_luan = b[10]
        
        is_qualified = False
        if danh_gia_ket_luan:
            is_qualified = (danh_gia_ket_luan == 'Đạt')
        else:
            is_qualified = (danh_gia_hop_le == 'Đạt' and danh_gia_nang_luc == 'Đạt' and danh_gia_ky_thuat != 'Không đạt' and danh_gia_ky_thuat != '')
            
        if is_qualified:
            qualified_bids.append(b)

    headers = [
        'Mã định danh', 
        'Tên nhà thầu (Nhập chính xác)', 
        'Mã phần lô', 
        'Tên phần lô (Tự động điền)',
        'Giá dự thầu (VND)', 
        'Tỷ lệ giảm giá (%)', 
        'Giá sau giảm giá (nếu có)', 
        'Hiệu lực E-HSDT (ngày)', 
        'Giá trị ĐB DT (VND)', 
        'Hiệu lực ĐB (ngày)', 
        'Thời gian thực hiện (ngày)'
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = "Mo De Xuat Tai Chinh"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for idx, bid in enumerate(qualified_bids, start=2):
        ws.row_dimensions[idx].height = 22
        ws.cell(row=idx, column=1, value=bid[0])
        ws.cell(row=idx, column=2, value=bid[1])
        # Columns 3 and 4 (Lot code and Lot name) are empty by default for manual entry if needed
        ws.cell(row=idx, column=5, value=bid[2] or "")
        ws.cell(row=idx, column=6, value=bid[3] or "")
        ws.cell(row=idx, column=7, value=bid[4] or "")
        ws.cell(row=idx, column=8, value=bid[5] or "")
        ws.cell(row=idx, column=11, value=bid[6] or "")
        for col_idx in range(1, len(headers) + 1):
            ws.cell(row=idx, column=col_idx).border = thin_border

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)

    return wb

def create_danhgiahsdt_template(pkg_id_clean, org_name, eval_type):
    """Tạo file mẫu nhập liệu đánh giá HSDT (kỹ thuật hoặc tài chính)."""
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT linh_vuc, phuong_thuc_lua_chon, phan_lo FROM goi_thau WHERE id = ? AND owner_id = ?", (pkg_id_clean, org_name))
    gt_row = cursor.fetchone()
    if not gt_row:
        conn.close()
        raise ValueError("Package not found")
        
    linh_vuc, phuong_thuc_lua_chon, phan_lo = gt_row
    lot_codes = fetch_package_lot_codes(cursor, pkg_id_clean, org_name)
    
    cursor.execute("""
        SELECT loai_nha_thau, ma_phan_lo, ten_phan_lo, ma_dinh_danh, ten_nha_thau,
               gia_du_thau, ty_le_giam_gia, gia_sau_giam_gia, hieu_luc_hsdt,
               gia_tri_dam_bao, hieu_luc_bao_dam_ngay, thoi_gian_thuc_hien,
               dam_bao_du_thau, hieu_luc_dam_bao, hieu_luc_hsdxt,
               danh_gia_hop_le, danh_gia_nang_luc, danh_gia_ky_thuat,
               lam_ro_hop_le, lam_ro_nang_luc, lam_ro_ky_thuat, lam_ro_tai_chinh,
               danh_gia_tai_chinh,
               nguyen_nhan_khong_dat_hop_le, nguyen_nhan_khong_dat_nang_luc, nguyen_nhan_khong_dat_ky_thuat
        FROM thong_tin_mo_thau
        WHERE goi_thau_id = ? AND owner_id = ?
    """, (pkg_id_clean, org_name))
    bids = cursor.fetchall()
    conn.close()
    
    is_tu_van = linh_vuc == 'Tư vấn'
    is_1g2t = phuong_thuc_lua_chon == 'Một giai đoạn hai túi hồ sơ'
    is_1g1t = phuong_thuc_lua_chon == 'Một giai đoạn một túi hồ sơ'
    has_phan_lo = phan_lo == 'Có'

    headers = []
    options_map = {}
    
    if eval_type == 'technical':
        # Đánh giá kỹ thuật
        if has_phan_lo:
            headers = [
                'Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)',
                'Đánh giá tính hợp lệ', 'Làm rõ tính hợp lệ (nếu có)', 'Nguyên nhân không đạt hợp lệ (nếu có)',
                'Đánh giá năng lực kinh nghiệm', 'Làm rõ năng lực kinh nghiệm (nếu có)', 'Nguyên nhân không đạt năng lực (nếu có)',
                'Đánh giá kỹ thuật', 'Làm rõ kỹ thuật (nếu có)', 'Nguyên nhân không đạt kỹ thuật (nếu có)'
            ]
        else:
            headers = [
                'Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)',
                'Đánh giá tính hợp lệ', 'Làm rõ tính hợp lệ (nếu có)', 'Nguyên nhân không đạt hợp lệ (nếu có)',
                'Đánh giá năng lực kinh nghiệm', 'Làm rõ năng lực kinh nghiệm (nếu có)', 'Nguyên nhân không đạt năng lực (nếu có)',
                'Đánh giá kỹ thuật', 'Làm rõ kỹ thuật (nếu có)', 'Nguyên nhân không đạt kỹ thuật (nếu có)'
            ]
        
        options_map = {
            'Đánh giá tính hợp lệ': ['Đạt', 'Không đạt'],
            'Đánh giá năng lực kinh nghiệm': ['Đạt', 'Không đạt'],
            'Đánh giá kỹ thuật': ['Đạt', 'Không đạt']
        }
        
    else:
        # Đánh giá tài chính
        if has_phan_lo:
            headers = [
                'Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)',
                'Giá dự thầu (VND)', 'Tỷ lệ giảm giá (%)', 'Giá sau giảm giá (nếu có)',
                'Đánh giá tài chính (Điểm hoặc Xếp hạng)', 'Làm rõ tài chính (nếu có)'
            ]
        else:
            headers = [
                'Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)',
                'Giá dự thầu (VND)', 'Tỷ lệ giảm giá (%)', 'Giá sau giảm giá (nếu có)',
                'Đánh giá tài chính (Điểm hoặc Xếp hạng)', 'Làm rõ tài chính (nếu có)'
            ]

    if has_phan_lo and lot_codes:
        options_map['Mã phần lô'] = lot_codes

    wb = Workbook()
    ws = wb.active
    ws.title = "Danh gia HSDT"

    options_ranges = {}
    if options_map:
        ws_options = wb.create_sheet(title="Dropdowns")
        ws_options.sheet_state = 'hidden'
        for opt_idx, (opt_col_name, opt_values) in enumerate(options_map.items(), start=1):
            opt_col_letter = get_column_letter(opt_idx)
            for val_idx, val in enumerate(opt_values, start=1):
                ws_options.cell(row=val_idx, column=opt_idx, value=val)
            options_ranges[opt_col_name] = f"Dropdowns!${opt_col_letter}$1:${opt_col_letter}${len(opt_values)}"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for idx, bid in enumerate(bids, start=2):
        ws.row_dimensions[idx].height = 22
        
        # Mapped fields
        # bids fields:
        # 0: loai_nha_thau, 1: ma_phan_lo, 2: ten_phan_lo, 3: ma_dinh_danh, 4: ten_nha_thau,
        # 5: gia_du_thau, 6: ty_le_giam_gia, 7: gia_sau_giam_gia, 8: hieu_luc_hsdt...
        
        if eval_type == 'technical':
            if has_phan_lo:
                row_vals = [
                    bid[0], bid[1], bid[2], bid[3], bid[4],
                    bid[15] or "", bid[18] or "", bid[23] or "",
                    bid[16] or "", bid[19] or "", bid[24] or "",
                    bid[17] or "", bid[20] or "", bid[25] or ""
                ]
            else:
                row_vals = [
                    bid[0], bid[3], bid[4],
                    bid[15] or "", bid[18] or "", bid[23] or "",
                    bid[16] or "", bid[19] or "", bid[24] or "",
                    bid[17] or "", bid[20] or "", bid[25] or ""
                ]
        else:
            if has_phan_lo:
                row_vals = [
                    bid[0], bid[1], bid[2], bid[3], bid[4],
                    bid[5] or "", bid[6] or "", bid[7] or "",
                    bid[22] or "", bid[21] or ""
                ]
            else:
                row_vals = [
                    bid[0], bid[3], bid[4],
                    bid[5] or "", bid[6] or "", bid[7] or "",
                    bid[22] or "", bid[21] or ""
                ]
                
        for col_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=idx, column=col_idx, value=val)
            ws.cell(row=idx, column=col_idx).border = thin_border

    # Data validations
    for col_idx, col_name in enumerate(headers, start=1):
        if col_name in options_ranges:
            col_letter = get_column_letter(col_idx)
            formula = options_ranges[col_name]
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            dv.error = 'Giá trị nhập không hợp lệ, vui lòng chọn từ danh sách'
            dv.errorTitle = 'Lỗi nhập dữ liệu'
            dv.prompt = 'Vui lòng chọn giá trị từ danh sách'
            dv.promptTitle = col_name
            ws.add_data_validation(dv)
            dv.add(f"{col_letter}2:{col_letter}{len(bids) + 10}")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)

    return wb

def create_ketquaqd_template(pkg_id_clean, org_name):
    """Tạo file mẫu nhập kết quả lựa chọn nhà thầu phê duyệt."""
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau, thoi_gian_hop_dong FROM goi_thau WHERE id = ? AND owner_id = ?", (pkg_id_clean, org_name))
    gt_row = cursor.fetchone()
    if not gt_row:
        conn.close()
        raise ValueError("Package not found")
        
    nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau, thoi_gian_hop_dong = gt_row
    
    cursor.execute("""
        SELECT loai_nha_thau, ma_phan_lo, ten_phan_lo, ma_dinh_danh, ten_nha_thau,
               gia_du_thau, ty_le_giam_gia, gia_sau_giam_gia,
               danh_gia_tai_chinh
        FROM thong_tin_mo_thau
        WHERE goi_thau_id = ? AND owner_id = ?
    """, (pkg_id_clean, org_name))
    bids = cursor.fetchall()
    conn.close()

    headers = [
        'Loại nhà thầu', 
        'Mã nhà thầu', 
        'Tên nhà thầu (Nhập chính xác)', 
        'Kết quả', 
        'Lý do trượt thầu (nếu có)', 
        'Giá trúng thầu (VND)', 
        'Thời gian thực hiện gói thầu (ngày)', 
        'Thời gian thực hiện hợp đồng (ngày)'
    ]
    
    options_map = {
        'Kết quả': ['Trúng thầu', 'Trượt thầu']
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "Ket Qua LCNT"

    options_ranges = {}
    if options_map:
        ws_options = wb.create_sheet(title="Dropdowns")
        ws_options.sheet_state = 'hidden'
        for opt_idx, (opt_col_name, opt_values) in enumerate(options_map.items(), start=1):
            opt_col_letter = get_column_letter(opt_idx)
            for val_idx, val in enumerate(opt_values, start=1):
                ws_options.cell(row=val_idx, column=opt_idx, value=val)
            options_ranges[opt_col_name] = f"Dropdowns!${opt_col_letter}$1:${opt_col_letter}${len(opt_values)}"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for idx, bid in enumerate(bids, start=2):
        ws.row_dimensions[idx].height = 22
        
        is_winner = False
        if nha_thau_trung_thau_id:
            is_winner = (bid[3] == nha_thau_trung_thau_id)
            
        status = 'Trúng thầu' if is_winner else 'Trượt thầu'
        val_gia = gia_trung_thau if is_winner else ""
        val_time_gt = thoi_gian_goi_thau if is_winner else ""
        val_time_hd = thoi_gian_hop_dong if is_winner else ""
        
        row_vals = [
            bid[0], bid[3], bid[4], status, "", val_gia, val_time_gt, val_time_hd
        ]
        
        for col_idx, val in enumerate(row_vals, start=1):
            ws.cell(row=idx, column=col_idx, value=val)
            ws.cell(row=idx, column=col_idx).border = thin_border

    for col_idx, col_name in enumerate(headers, start=1):
        if col_name in options_ranges:
            col_letter = get_column_letter(col_idx)
            formula = options_ranges[col_name]
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            dv.add(f"{col_letter}2:{col_letter}{len(bids) + 10}")
            ws.add_data_validation(dv)

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)

    return wb

def create_phanlo_excel(phan_lo_list):
    """Xuất danh sách phân lô ra Excel."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Phan Lo"
    
    headers = ['Mã phần lô', 'Tên phần lô', 'Giá trị phần lô (VND)', 'Bảo đảm dự thầu (VND)', 'Thời gian thực hiện (ngày)']
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)
    
    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for idx, item in enumerate(phan_lo_list, start=2):
        ws.row_dimensions[idx].height = 22
        ws.cell(row=idx, column=1, value=item.get('maPhanLo', ''))
        ws.cell(row=idx, column=2, value=item.get('tenPhanLo', ''))
        ws.cell(row=idx, column=3, value=item.get('giaTriPhanLo', 0))
        ws.cell(row=idx, column=4, value=item.get('baoDamDuThau', 0))
        ws.cell(row=idx, column=5, value=item.get('thoiGianThucHien', 0))
        for col_idx in range(1, len(headers) + 1):
            ws.cell(row=idx, column=col_idx).border = thin_border
            
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)
        
    return wb

def create_tuychonmuathem_excel(tuy_chon_list):
    """Xuất danh sách tùy chọn mua thêm ra Excel."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Tuy Chon Mua Them"
    
    headers = ['Hạng mục', 'Đơn vị', 'Số lượng', 'Tỷ lệ phần trăm (%)', 'Giá trị ước tính']
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    border_side = Side(border_style="thin", color="D9D9D9")
    thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)
    
    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
        
    for idx, item in enumerate(tuy_chon_list, start=2):
        ws.row_dimensions[idx].height = 22
        ws.cell(row=idx, column=1, value=item.get('hangMuc', ''))
        ws.cell(row=idx, column=2, value=item.get('donVi', ''))
        ws.cell(row=idx, column=3, value=item.get('soLuong', 0))
        ws.cell(row=idx, column=4, value=item.get('tyLe', 0))
        ws.cell(row=idx, column=5, value=item.get('giaTriUocTinh', 0))
        for col_idx in range(1, len(headers) + 1):
            ws.cell(row=idx, column=col_idx).border = thin_border
            
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 15)
        
    return wb
