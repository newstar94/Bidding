from backend.shared.helpers import (
    database,
)
from backend.documents.excel_handler import (
    _schema_to_headers,
    _schema_to_options,
    _schema_to_formats,
)
from backend.sync.mapper import fetch_package_lot_codes
from backend.documents.excel_workbook_builder import (
    _build_configured_workbook,
    create_excel_from_spec,
)


def _fetch_joint_venture_member_descriptions(cursor, package_id, organization_id):
    cursor.execute(
        """SELECT member.thong_tin_mo_thau_id, member.vai_tro,
                  member.ten_nha_thau,
                  COALESCE(NULLIF(member.ma_so_thue, ''), member.ma_nha_thau, '')
             FROM thong_tin_mo_thau_lien_danh_thanh_vien AS member
             JOIN thong_tin_mo_thau AS opening
               ON opening.organization_id = member.organization_id
              AND opening.id = member.thong_tin_mo_thau_id
            WHERE opening.goi_thau_id = ?
              AND member.organization_id = ?
            ORDER BY member.thong_tin_mo_thau_id,
                     CASE WHEN member.vai_tro = 'Đứng đầu liên danh' THEN 0 ELSE 1 END,
                     member.sort_order,
                     member.id""",
        (package_id, organization_id),
    )
    descriptions = {}
    for opening_id, role, name, code in cursor.fetchall():
        identity = str(name or code or "").strip()
        if not identity:
            continue
        code_text = str(code or "").strip()
        label = f"{role}: {identity}"
        if code_text and code_text != identity:
            label += f" ({code_text})"
        descriptions.setdefault(str(opening_id), []).append(label)
    return {
        opening_id: "; ".join(values)
        for opening_id, values in descriptions.items()
    }


def create_excel_template(import_type):
    """Tạo file mẫu Excel nhập liệu cơ bản theo schema thực thể."""
    headers = _schema_to_headers(import_type)
    if not headers:
        raise ValueError(f"Invalid type: {import_type}")
    return _build_configured_workbook(
        "Nhap Lieu",
        headers,
        options_map=_schema_to_options(import_type),
        formats_map=_schema_to_formats(import_type),
        empty_rows=50,
    )

def prepare_opening_fin_template_spec(pkg_id_clean, org_name):
    """Load qualified bids and return a data-only workbook contract."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT m.ma_dinh_danh, m.ten_nha_thau, m.gia_du_thau, m.ty_le_giam_gia,
               m.gia_sau_giam_gia, m.hieu_luc_hsdt, m.thoi_gian_thuc_hien,
               k.danh_gia_hop_le, k.danh_gia_nang_luc, k.danh_gia_ky_thuat,
               k.danh_gia_ket_luan
        FROM thong_tin_mo_thau m
        LEFT JOIN ket_qua_danh_gia_nha_thau k
          ON k.organization_id = m.organization_id
         AND k.thong_tin_mo_thau_id = m.id
        WHERE m.goi_thau_id = ? AND m.organization_id = ?
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

    rows = [
        [
            bid[0], bid[1], "", "", bid[2] or "", bid[3] or "",
            bid[4] or "", bid[5] or "", "", "", bid[6] or "",
        ]
        for bid in qualified_bids
    ]
    return {
        "title": "Mo De Xuat Tai Chinh",
        "headers": headers,
        "rows": rows,
        "formats_map": {
            "Giá dự thầu (VND)": "currency",
            "Giá sau giảm giá (nếu có)": "currency",
            "Giá trị ĐB DT (VND)": "currency",
        },
    }


def create_opening_fin_template(pkg_id_clean, org_name):
    """Create a financial-opening workbook for non-worker callers."""
    return create_excel_from_spec(
        prepare_opening_fin_template_spec(pkg_id_clean, org_name)
    )

def prepare_danhgiahsdt_template_spec(
    pkg_id_clean, org_name, eval_type, selected_lot_codes=None
):
    """Load evaluation data and return a data-only workbook contract."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT linh_vuc, phuong_thuc_lua_chon, phan_lo FROM goi_thau WHERE id = ? AND organization_id = ?", (pkg_id_clean, org_name))
    gt_row = cursor.fetchone()
    if not gt_row:
        conn.close()
        raise ValueError("Package not found")

    _linh_vuc, _phuong_thuc_lua_chon, phan_lo = gt_row
    lot_codes = fetch_package_lot_codes(cursor, pkg_id_clean, org_name)
    known_lot_codes = {str(code).strip().casefold(): code for code in lot_codes}
    requested_lot_codes = [
        str(code).strip() for code in (selected_lot_codes or []) if str(code).strip()
    ]
    unknown_lot_codes = [
        code for code in requested_lot_codes if code.casefold() not in known_lot_codes
    ]
    if unknown_lot_codes:
        conn.close()
        raise ValueError("Selected evaluation lot code does not belong to the package")
    scoped_lot_codes = [
        known_lot_codes[code.casefold()] for code in requested_lot_codes
    ] if requested_lot_codes else lot_codes
    scoped_lot_code_keys = {str(code).strip().casefold() for code in scoped_lot_codes}

    cursor.execute("""
        SELECT loai_nha_thau, ma_phan_lo, ten_phan_lo, ma_dinh_danh, ten_nha_thau,
               gia_du_thau, ty_le_giam_gia, gia_sau_giam_gia, hieu_luc_hsdt,
               gia_tri_dam_bao, hieu_luc_bao_dam_ngay, thoi_gian_thuc_hien,
               k.danh_gia_hop_le, k.danh_gia_nang_luc, k.danh_gia_ky_thuat,
               k.lam_ro_hop_le, k.lam_ro_nang_luc, k.lam_ro_ky_thuat, k.lam_ro_tai_chinh,
               k.danh_gia_tai_chinh,
               k.nguyen_nhan_khong_dat_hop_le, k.nguyen_nhan_khong_dat_nang_luc, k.nguyen_nhan_khong_dat_ky_thuat,
               k.gia_xep_hang, k.gia_de_nghi_trung_thau,
               k.chap_thuan_gia_de_nghi_trung_thau_duoi_50,
               m.id
        FROM thong_tin_mo_thau m
        LEFT JOIN ket_qua_danh_gia_nha_thau k
          ON k.organization_id = m.organization_id AND k.thong_tin_mo_thau_id = m.id
        WHERE m.goi_thau_id = ? AND m.organization_id = ?
    """, (pkg_id_clean, org_name))
    bids = cursor.fetchall()
    if requested_lot_codes:
        bids = [
            bid for bid in bids
            if str(bid[1] or "").strip().casefold() in scoped_lot_code_keys
        ]
    joint_venture_members = _fetch_joint_venture_member_descriptions(
        cursor, pkg_id_clean, org_name
    )
    conn.close()

    has_phan_lo = phan_lo == 'Có'

    headers = []
    options_map = {}

    if eval_type == 'technical':

        if has_phan_lo:
            headers = [
                'Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Thành viên liên danh',
                'Đánh giá tính hợp lệ', 'Làm rõ tính hợp lệ (nếu có)', 'Nguyên nhân không đạt hợp lệ (nếu có)',
                'Đánh giá năng lực kinh nghiệm', 'Làm rõ năng lực kinh nghiệm (nếu có)', 'Nguyên nhân không đạt năng lực (nếu có)',
                'Đánh giá kỹ thuật', 'Làm rõ kỹ thuật (nếu có)', 'Nguyên nhân không đạt kỹ thuật (nếu có)'
            ]
        else:
            headers = [
                'Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Thành viên liên danh',
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

        if has_phan_lo:
            headers = [
                'Loại nhà thầu', 'Mã phần lô', 'Tên phần lô (Tự động điền)', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Thành viên liên danh',
                'Giá dự thầu (VND)', 'Tỷ lệ giảm giá (%)',
                'Giá xếp hạng (VND)', 'Giá đề nghị trúng thầu (VND)',
                'Xử lý giá đề nghị trúng thầu dưới 50%',
                'Đánh giá tính hợp lệ', 'Làm rõ tính hợp lệ (nếu có)', 'Nguyên nhân không đạt hợp lệ (nếu có)',
                'Đánh giá năng lực kinh nghiệm', 'Làm rõ năng lực kinh nghiệm (nếu có)', 'Nguyên nhân không đạt năng lực (nếu có)',
                'Đánh giá kỹ thuật', 'Làm rõ kỹ thuật (nếu có)', 'Nguyên nhân không đạt kỹ thuật (nếu có)',
                'Làm rõ tài chính (nếu có)'
            ]
        else:
            headers = [
                'Loại nhà thầu', 'Mã nhà thầu', 'Tên nhà thầu (Nhập chính xác)', 'Thành viên liên danh',
                'Giá dự thầu (VND)', 'Tỷ lệ giảm giá (%)',
                'Giá xếp hạng (VND)', 'Giá đề nghị trúng thầu (VND)',
                'Xử lý giá đề nghị trúng thầu dưới 50%',
                'Đánh giá tính hợp lệ', 'Làm rõ tính hợp lệ (nếu có)', 'Nguyên nhân không đạt hợp lệ (nếu có)',
                'Đánh giá năng lực kinh nghiệm', 'Làm rõ năng lực kinh nghiệm (nếu có)', 'Nguyên nhân không đạt năng lực (nếu có)',
                'Đánh giá kỹ thuật', 'Làm rõ kỹ thuật (nếu có)', 'Nguyên nhân không đạt kỹ thuật (nếu có)',
                'Làm rõ tài chính (nếu có)'
            ]
        options_map['Xử lý giá đề nghị trúng thầu dưới 50%'] = [
            'Chấp thuận', 'Không chấp thuận'
        ]
        options_map.update({
            'Đánh giá tính hợp lệ': ['Đạt', 'Không đạt'],
            'Đánh giá năng lực kinh nghiệm': ['Đạt', 'Không đạt'],
            'Đánh giá kỹ thuật': ['Đạt', 'Không đạt'],
        })

    if has_phan_lo and scoped_lot_codes:
        options_map['Mã phần lô'] = scoped_lot_codes

    rows = []
    for bid in bids:
        member_description = joint_venture_members.get(str(bid[26]), "")
        if eval_type == "technical":
            if has_phan_lo:
                row_values = [
                    bid[0], bid[1], bid[2], bid[3], bid[4], member_description,
                    bid[12] or "", bid[15] or "", bid[20] or "",
                    bid[13] or "", bid[16] or "", bid[21] or "",
                    bid[14] or "", bid[17] or "", bid[22] or "",
                ]
            else:
                row_values = [
                    bid[0], bid[3], bid[4], member_description,
                    bid[12] or "", bid[15] or "", bid[20] or "",
                    bid[13] or "", bid[16] or "", bid[21] or "",
                    bid[14] or "", bid[17] or "", bid[22] or "",
                ]
        elif has_phan_lo:
            row_values = [
                bid[0], bid[1], bid[2], bid[3], bid[4], member_description,
                bid[5] or "", bid[6] or "",
                bid[23] or "", bid[24] or "",
                "" if bid[25] is None else ("Chấp thuận" if bid[25] else "Không chấp thuận"),
                bid[12] or "", bid[15] or "", bid[20] or "",
                bid[13] or "", bid[16] or "", bid[21] or "",
                bid[14] or "", bid[17] or "", bid[22] or "",
                bid[18] or "",
            ]
        else:
            row_values = [
                bid[0], bid[3], bid[4], member_description,
                bid[5] or "", bid[6] or "",
                bid[23] or "", bid[24] or "",
                "" if bid[25] is None else ("Chấp thuận" if bid[25] else "Không chấp thuận"),
                bid[12] or "", bid[15] or "", bid[20] or "",
                bid[13] or "", bid[16] or "", bid[21] or "",
                bid[14] or "", bid[17] or "", bid[22] or "",
                bid[18] or "",
            ]
        rows.append(row_values)

    financial_formats = {
        header: "currency"
        for header in headers
        if "(VND)" in header or header.startswith("Giá sau giảm")
    }
    return {
        "title": "Danh gia HSDT",
        "headers": headers,
        "rows": rows,
        "options_map": options_map,
        "formats_map": financial_formats,
    }


def create_danhgiahsdt_template(
    pkg_id_clean, org_name, eval_type, selected_lot_codes=None
):
    """Create an evaluation workbook for non-worker callers."""
    return create_excel_from_spec(
        prepare_danhgiahsdt_template_spec(
            pkg_id_clean, org_name, eval_type, selected_lot_codes
        )
    )

def prepare_ketquaqd_template_spec(pkg_id_clean, org_name):
    """Load award-result data and return a data-only workbook contract."""
    conn = database.get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau, thoi_gian_hop_dong FROM goi_thau WHERE id = ? AND organization_id = ?", (pkg_id_clean, org_name))
    gt_row = cursor.fetchone()
    if not gt_row:
        conn.close()
        raise ValueError("Package not found")

    nha_thau_trung_thau_id, gia_trung_thau, thoi_gian_goi_thau, thoi_gian_hop_dong = gt_row

    cursor.execute("""
        SELECT m.loai_nha_thau, m.ma_phan_lo, m.ten_phan_lo, m.ma_dinh_danh, m.ten_nha_thau,
               m.gia_du_thau, m.ty_le_giam_gia, m.gia_sau_giam_gia,
               k.ly_do_loai,
               k.chap_thuan_gia_de_nghi_trung_thau_duoi_50,
               m.id
        FROM thong_tin_mo_thau m
        LEFT JOIN ket_qua_danh_gia_nha_thau k
          ON k.organization_id = m.organization_id
         AND k.thong_tin_mo_thau_id = m.id
        WHERE m.goi_thau_id = ? AND m.organization_id = ?
    """, (pkg_id_clean, org_name))
    bids = cursor.fetchall()
    joint_venture_members = _fetch_joint_venture_member_descriptions(
        cursor, pkg_id_clean, org_name
    )
    conn.close()

    headers = [
        'Loại nhà thầu',
        'Mã nhà thầu',
        'Tên nhà thầu (Nhập chính xác)',
        'Thành viên liên danh',
        'Kết quả',
        'Xử lý giá đề nghị trúng thầu dưới 50%',
        'Lý do trượt thầu (nếu có)',
        'Giá trúng thầu (VND)',
        'Thời gian thực hiện gói thầu (ngày)',
        'Thời gian thực hiện hợp đồng (ngày)'
    ]

    options_map = {
        'Kết quả': ['Trúng thầu', 'Trượt thầu']
    }

    rows = []
    for bid in bids:
        is_winner = bool(nha_thau_trung_thau_id and bid[3] == nha_thau_trung_thau_id)
        rows.append([
            bid[0],
            bid[3],
            bid[4],
            joint_venture_members.get(str(bid[10]), ""),
            "Trúng thầu" if is_winner else "Trượt thầu",
            "" if bid[9] is None else ("Chấp thuận" if bid[9] else "Không chấp thuận"),
            "" if is_winner else (bid[8] or ""),
            gia_trung_thau if is_winner else "",
            thoi_gian_goi_thau if is_winner else "",
            thoi_gian_hop_dong if is_winner else "",
        ])

    return {
        "title": "Ket Qua LCNT",
        "headers": headers,
        "rows": rows,
        "options_map": options_map,
        "formats_map": {"Giá trúng thầu (VND)": "currency"},
    }


def create_ketquaqd_template(pkg_id_clean, org_name):
    """Create an award-result workbook for non-worker callers."""
    return create_excel_from_spec(
        prepare_ketquaqd_template_spec(pkg_id_clean, org_name)
    )
