# -*- coding: utf-8 -*-
"""Render converted templates through a replica of BiddingFlow's DOCX pipeline with mock data."""
import copy, io, json, os, re, sys, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bf
from docxtpl import DocxTemplate, InlineImage
from docx.shared import Inches

ts = bf.template_security
VARS = bf.word_variables()
PLAN_FOLDERS = {'1. KHLCNT Chung', '2. KHLCNT Rieng', '11. KHLCNT CĐT Chung', '12. KHLCNT CĐT Rieng'}

# ---------------------------------------------------------------- mock entities
def cv(name, val, unit=None, vb=None):
    return {'id': name, 'ten_cong_viec': name, 'gia_tri': val, 'don_vi_thuc_hien': unit, 'van_ban_phe_duyet': vb}

KE_HOACH = {
    'id': 'kh1', 'ma_ke_hoach': 'PL2600012345', 'ma_du_an': 'DA01', 'phien_ban': '1',
    'ten_ke_hoach': 'Mua sắm thiết bị dạy học tiếng Anh năm 2026', 'ten_du_an_du_toan': 'Dự toán mua sắm thiết bị dạy học tiếng Anh',
    'loai_hinh_mua_sam': 'Dự toán mua sắm', 'don_vi_trinh_cdt': 'Tổ chuyên môn', 'ten_viet_tat_don_vi_trinh': 'TCM',
    'tong_muc_dau_tu': 288000000, 'ngay_phe_duyet': '2026-03-05', 'quyet_dinh_phe_duyet': '12/QĐ-MNHT3',
    'thoi_gian_dang_tai': '2026-03-06T14:55', 'nguon_von': 'Ngân sách nhà nước', 'thoi_gian_du_an': 'Năm 2026',
    'ngay_trinh_ke_hoach': '2026-03-01', 'ngay_trinh_du_toan': '2026-02-20', 'ngay_phe_duyet_du_toan': '2026-02-25',
    'so_qd_phe_duyet_du_toan': '08/QĐ-MNHT3', 'so_to_trinh_ke_hoach': '05/TTr', 'can_cu_gia_goi_thau': 'Báo giá',
    'cv_da_thuc_hien': [cv('Lập dự toán', 5000000, 'Công ty A', 'HĐ 01')],
    'cv_khong_ap_dung': [cv('Chi phí quản lý', 2000000, 'Chủ đầu tư')],
    'cv_chua_du_dieu_kien': [],
}
CDT = {'ma_chu_dau_tu': 'cdt01', 'ten_chu_dau_tu': 'Trường Mầm non Hợp Thịnh số 3', 'ten_viet_tat': 'MNHT3',
       'ma_so_thue': '2401087869', 'chuc_vu_nguoi_dung_dau': 'Hiệu trưởng', 'dai_dien_cdt': 'Hoàng Thị Tiếp',
       'chuc_vu_dai_dien': 'Hiệu trưởng', 'danh_xung': 'Bà', 'dia_chi': 'Thôn Hòa Tiến, Xã Hợp Thịnh, TP Bắc Ninh',
       'so_dien_thoai': '0912345678', 'so_tai_khoan': '9527.2.1234567', 'noi_mo_tai_khoan': 'KBNN Bắc Ninh',
       'email': 'a@b.vn', 'ma_qhns': '1234567', 'co_quan_chu_quan': 'UBND xã Hợp Thịnh'}
GOI_THAU = {'id': 'gt1', 'ma_goi_thau': 'IB2600054321', 'ten_goi_thau': 'Mua sắm thiết bị tiếng Anh', 'gia_goi_thau': 288000000,
            'loai_hop_dong': 'Trọn gói', 'hinh_thuc_lua_chon': 'Chào hàng cạnh tranh', 'phuong_thuc_lua_chon': 'Một giai đoạn một túi hồ sơ',
            'thoi_gian_thuc_hien': '30 ngày', 'nguon_von': 'Ngân sách nhà nước', 'gia_trung_thau': 280000000,
            'thoi_gian_to_chuc': '30 ngày', 'thoi_gian_bat_dau_to_chuc': 'Quý I năm 2026', 'thoi_gian_dang_tai': '2026-03-10T09:00',
            'thoi_gian_dong_thau': '2026-03-20T09:00', 'thoi_gian_mo_thau': '2026-03-20T09:30', 'so_quyet_dinh': '15/QĐ-MNHT3',
            'ngay_quyet_dinh': '2026-03-09', 'so_quyet_dinh_ket_qua': '20/QĐ-MNHT3', 'ngay_quyet_dinh_ket_qua': '2026-03-30',
            'thoi_gian_goi_thau': '30 ngày', 'thoi_gian_hop_dong': '30 ngày', 'gia_tri_dam_bao_du_thau': 3000000,
            'so_bao_cao_tham_dinh_hsmt': '02/BCTĐ', 'ngay_bao_cao_tham_dinh_hsmt': '2026-03-08', 'so_to_trinh_hsmt': '03/TTr',
            'ngay_trinh_hsmt': '2026-03-07', 'ngay_moi_doi_chieu': '22/03/2026', 'ngay_doi_chieu': '25/03/2026',
            'ty_le_bao_dam_hop_dong': 3, 'phan_lo_list': [], 'awarded_phan_lo_list': []}
def expert(name, role, job):
    return {'id': name, 'ho_ten': name, 'so_chung_chi': 'CC-' + name[:3], 'ngay_cap_chung_chi': '2024-05-10',
            'don_vi_cap_chung_chi': 'Bộ Tài chính', 'so_cccd': '0270' + str(len(name)), 'ngay_cap_cccd': '2021-07-01',
            'noi_cap_cccd': 'Cục CS QLHC', 'anh_chung_chi': 'IMG', 'anh_chu_ky': 'IMG', 'chuc_vu': role, 'cong_viec': job}
TCG = [expert('Nguyễn Văn A', 'Tổ trưởng', 'Phụ trách chung'), expert('Trần Thị B', 'Tổ viên', 'Đánh giá năng lực'),
       expert('Lê Văn C', 'Tổ viên', 'Đánh giá kỹ thuật')]
TTD = [expert('Phạm Văn D', 'Tổ trưởng', 'Thẩm định'), expert('Đỗ Thị E', 'Tổ viên', 'Thẩm định')]
def bid(name, price, rank, ket):
    return {'id': name, 'nha_thau_id': name, 'ten_nha_thau': name, 'ma_nha_thau': 'vn' + name[-1], 'ma_so_thue': '010' + name[-1],
            'gia_du_thau': f'{price:,}'.replace(',', '.'), 'ty_le_giam_gia': 0, 'gia_sau_giam_gia': f'{price:,}'.replace(',', '.'),
            'danh_gia_hop_le': 'Đạt', 'danh_gia_nang_luc': 'Đạt', 'danh_gia_ky_thuat': 'Đạt', 'danh_gia_tai_chinh': rank,
            'gia_xep_hang': price, 'gia_de_nghi_trung_thau': price, 'danh_gia_ket_luan': ket, 'thoi_gian_thuc_hien': '30 ngày',
            'lam_ro_hop_le': '', 'lam_ro_nang_luc': '', 'lam_ro_ky_thuat': '', 'nguyen_nhan_khong_dat_hop_le': '',
            'nguyen_nhan_khong_dat_nang_luc': '', 'nguyen_nhan_khong_dat_ky_thuat': '', 'ma_phan_lo': '', 'ten_phan_lo': '',
            'nguoi_dai_dien': 'Ông X', 'chuc_vu_dai_dien': 'Giám đốc', 'danh_xung': 'Ông', 'dia_chi': 'Hà Nội',
            'so_dien_thoai': '0900', 'so_tai_khoan': '123', 'noi_mo_tai_khoan': 'VCB', 'xep_hang': rank, 'diem_danh_gia': ''}
BIDS = [bid('Công ty TNHH Một', 280000000, 'Xếp hạng 1', 'Đề nghị trúng thầu'), bid('Công ty CP Hai', 285000000, 'Xếp hạng 2', 'Đạt')]
CONTRACTS = [
    {'id': 'hd1', 'ten_hop_dong': 'HĐ tư vấn lập', 'so_hop_dong': '01/2026/HĐTV', 'ngay_ky': '2026-03-02', 'gia_tri': 5000000,
     'loai_hop_dong': 'Trọn gói', 'thoi_gian_thuc_hien': '30 ngày', 'phan_loai': 'Tư vấn', 'so_qd_chi_dinh': '10/QĐ',
     'ngay_qd_chi_dinh': '2026-03-01', 'ngay_thanh_ly': None},
    {'id': 'hd2', 'ten_hop_dong': 'HĐ thẩm định', 'so_hop_dong': '02/2026/HĐTĐ', 'ngay_ky': '2026-03-03', 'gia_tri': 2000000,
     'loai_hop_dong': 'Trọn gói', 'thoi_gian_thuc_hien': '15 ngày', 'phan_loai': 'Thẩm định', 'so_qd_chi_dinh': '11/QĐ',
     'ngay_qd_chi_dinh': '2026-03-02', 'ngay_thanh_ly': None}]
# ADR 0100: đơn vị tư vấn lập / thẩm định (nhà thầu của hợp đồng tư vấn)
TVL = {'ten_nha_thau': 'Công ty CP Tư vấn HCP', 'ten_viet_tat': 'HCP', 'ma_so_thue': '0109876543',
       'nguoi_dai_dien': 'Nguyễn Văn Tư', 'chuc_vu_dai_dien': 'Giám đốc', 'danh_xung': 'Ông',
       'dia_chi': 'Số 10 Láng Hạ, Đống Đa, Hà Nội', 'so_dien_thoai': '0243123456', 'email': 'tv@hcp.vn',
       'so_tai_khoan': '1234567890', 'noi_mo_tai_khoan': 'BIDV Hà Thành', 'ma_ngan_hang': '01202001',
       'anh_dau': 'IMG'}
TVT = {'ten_nha_thau': 'Công ty TNHH Thẩm định Kinh Bắc', 'ten_viet_tat': 'TĐKB', 'ma_so_thue': '2300123456',
       'nguoi_dai_dien': 'Lê Thị Thẩm', 'chuc_vu_dai_dien': 'Giám đốc', 'danh_xung': 'Bà',
       'dia_chi': 'Số 5 Lý Thái Tổ, phường Kinh Bắc, tỉnh Bắc Ninh', 'so_dien_thoai': '0222333444',
       'email': 'td@kb.vn', 'so_tai_khoan': '0987654321', 'noi_mo_tai_khoan': 'Vietinbank Bắc Ninh',
       'ma_ngan_hang': '01201001', 'anh_dau': 'IMG'}
LOT = {'ma_phan_lo': 'L1', 'ten_phan_lo': 'Lô 1', 'gia_tri_phan_lo': 100000000, 'ten_nha_thau_trung': 'Công ty TNHH Một',
       'gia_trung_thau': '99.000.000', 'ds_ten_nha_thau_tham_du': 'Công ty TNHH Một', 'ly_do_khong_trung': ''}
WINLOT = {'nha_thau_id': 'x', 'ma_nha_thau': 'vn1', 'ten_nha_thau': 'Công ty TNHH Một', 'so_phan_lo_trung': 1,
          'tong_gia_tri_trung_thau': '99.000.000', 'ds_phan_lo': [LOT]}

SOURCES = {'chu_dau_tu': 'chu_dau_tu', 'ke_hoach_lcnt': 'ke_hoach', 'goi_thau': 'goi_thau',
           'don_vi_tu_van_lap': 'don_vi_tu_van_lap', 'don_vi_tu_van_tham': 'don_vi_tu_van_tham'}
IMAGE_PREFIXES = ('anh_chu_ky', 'anh_chung_chi', 'anh_dau')
LIST_SOURCES = {'to_chuyen_gia': 'to_chuyen_gia', 'to_tham_dinh': 'to_tham_dinh', 'hop_dong_list': 'hop_dong_list',
                'goi_thau_trong_ke_hoach': 'goi_thau_trong_ke_hoach', 'thong_tin_mo_thau': 'nha_thau',
                'ds_nha_thau_tham_du': 'ds_nha_thau_tham_du', 'ds_nha_thau_trung_thau': 'ds_nha_thau_trung_thau',
                'ds_nha_thau_truot_thau': 'ds_nha_thau_truot_thau', 'ds_nha_thau_khong_dat': 'ds_nha_thau_khong_dat',
                'ds_nha_thau_dat_khong_xep_hang_1': 'ds_nha_thau_dat_khong_xep_hang_1',
                'ds_nha_thau_khong_duoc_danh_gia': 'ds_nha_thau_khong_duoc_danh_gia',
                'ds_nha_thau_trung_theo_phan_lo': 'ds_nha_thau_trung_theo_phan_lo', 'ds_phan_lo': 'ds_phan_lo',
                'ds_phan_lo_co_nha_thau_tham_du': 'ds_phan_lo_co_nha_thau_tham_du',
                'ds_phan_lo_khong_co_nha_thau_tham_du': 'ds_phan_lo_khong_co_nha_thau_tham_du',
                'ds_phan_lo_co_nha_thau_trung': 'ds_phan_lo_co_nha_thau_trung',
                'ds_phan_lo_co_nha_thau_tham_du_khong_trung': 'ds_phan_lo_co_nha_thau_tham_du_khong_trung'}


def build_context(plan):
    if plan:
        ctx = {'ke_hoach': copy.deepcopy(KE_HOACH), 'chu_dau_tu': dict(CDT), 'goi_thau': [dict(GOI_THAU)],
               'goi_thau_trong_ke_hoach': [dict(GOI_THAU), dict(GOI_THAU, ten_goi_thau='Gói 2', gia_goi_thau=50000000)],
               'to_chuc': {'ten_to_chuc': 'Công ty HCP'}, 'user': {}, 'goi_dich_vu': {},
               'investor_name': CDT['ten_chu_dau_tu'], 'investor_address': CDT['dia_chi'],
               'current_time': '2026-11-11T22:33:00+07:00', 'today': '2026-11-11'}
    else:
        ctx = {'goi_thau': dict(GOI_THAU), 'ke_hoach': copy.deepcopy(KE_HOACH), 'chu_dau_tu': dict(CDT),
               'to_chuyen_gia': copy.deepcopy(TCG), 'to_tham_dinh': copy.deepcopy(TTD), 'nha_thau': copy.deepcopy(BIDS),
               'ds_nha_thau_tham_du': copy.deepcopy(BIDS), 'ds_nha_thau_trung_thau': copy.deepcopy(BIDS[:1]),
               'ds_nha_thau_truot_thau': copy.deepcopy(BIDS[1:]), 'ds_nha_thau_khong_dat': [],
               'ds_nha_thau_dat_khong_xep_hang_1': copy.deepcopy(BIDS[1:]), 'ds_nha_thau_khong_duoc_danh_gia': [],
               'ds_nha_thau_trung_theo_phan_lo': [copy.deepcopy(WINLOT)], 'ds_phan_lo': [dict(LOT)],
               'ds_phan_lo_co_nha_thau_tham_du': [dict(LOT)], 'ds_phan_lo_khong_co_nha_thau_tham_du': [],
               'ds_phan_lo_co_nha_thau_trung': [dict(LOT)], 'ds_phan_lo_co_nha_thau_tham_du_khong_trung': [],
               'hop_dong_list': copy.deepcopy(CONTRACTS), 'to_chuc': {'ten_to_chuc': 'Công ty HCP'}, 'user': {}, 'goi_dich_vu': {},
               'investor_name': CDT['ten_chu_dau_tu'], 'investor_address': CDT['dia_chi'],
               'current_time': '2026-11-11T22:33:00+07:00', 'today': '2026-11-11', 'tong_so_nha_thau_tham_du': 2,
               'so_nha_thau_trung_thau': 1,
               'don_vi_tu_van_lap': dict(TVL), 'don_vi_tu_van_tham': dict(TVT)}
    # ADR 0105: totals and performance-security amount computed by the backend
    if plan:
        ctx.update(bf.plan_total_context(ctx['ke_hoach'], ctx['goi_thau_trong_ke_hoach']))
    else:
        for key in ('nha_thau', 'ds_nha_thau_tham_du', 'ds_nha_thau_trung_thau',
                    'ds_nha_thau_truot_thau', 'ds_nha_thau_dat_khong_xep_hang_1'):
            for item in ctx[key]:
                amount = bf.performance_security_amount(
                    ctx['goi_thau'].get('ty_le_bao_dam_hop_dong'), item.get('gia_sau_giam_gia'))
                item[bf.PERFORMANCE_SECURITY_FIELD] = f'{amount:,}'.replace(',', '.') if amount else ''
    # ADR 0099 timeline milestone scalars (moc_so_* / moc_ngay_*)
    plan_section = {'chung_thu_tdg', 'qd_tl_to', 'ttr_dt', 'qd_dt', 'ttr_kh', 'qd_kh', 'ttr_dt_kh', 'qd_dt_kh'}
    for v in VARS:
        col = v['sourceColumn']
        if v['sourceTable'] != '__context__' or not col.startswith('moc_'):
            continue
        slug = col.split('_', 2)[2]
        empty = (plan and slug not in plan_section) or slug in ('qd_tl_to', 'thu_chap_thuan')
        if empty:
            ctx[col] = ''
        elif col.startswith('moc_ngay_'):
            ctx[col] = '2026-10-05'
        else:
            ctx[col] = '%s/QĐ-MOC' % slug.upper()
    money, dates, datetimes = set(), set(), set()
    for v in VARS:
        name, table, col, fmt = v['name'], v['sourceTable'], v['sourceColumn'], v['format']
        if not col:  # list alias
            src = LIST_SOURCES.get(table)
            if table in ('cv_da_thuc_hien', 'cv_khong_ap_dung', 'cv_chua_du_dieu_kien'):
                ctx[name] = copy.deepcopy(ctx['ke_hoach'].get(table, []))
            elif src and src in ctx and isinstance(ctx[src], list):
                ctx[name] = copy.deepcopy(ctx[src])
            continue
        val = None
        if table == '__context__':
            val = ctx.get(col)
        elif table in SOURCES:
            ent = ctx.get(SOURCES[table])
            if isinstance(ent, list):
                ent = ent[-1] if ent else {}
            val = (ent or {}).get(col)
        elif table in ('nha_thau', 'thong_tin_mo_thau') and isinstance(ctx.get('nha_thau'), list) and ctx['nha_thau']:
            val = ctx['nha_thau'][-1].get(col)
        elif table == 'chuyen_gia' and ctx.get('to_chuyen_gia'):
            val = ctx['to_chuyen_gia'][-1].get(col)
        if val is not None:
            ctx[name] = val
            if fmt == 'currency': money.add(name)
            if fmt in ('date', 'datetime'): dates.add(name)
            if fmt == 'datetime': datetimes.add(name)
    allowed = set(ctx) | {f'{p}{r}' for r in money for p in ('bangchu_', 'BangChu_')} | \
        {f'{p}{r}' for r in dates for p in ('S_', 's_')}
    return ctx, allowed, money, datetimes


PNG = None
def tiny_png():
    global PNG
    if PNG is None:
        from PIL import Image
        b = io.BytesIO(); Image.new('RGB', (40, 20), (200, 0, 0)).save(b, 'PNG'); PNG = b.getvalue()
    return io.BytesIO(PNG)


def render(path, plan):
    ctx, allowed, money, datetimes = build_context(plan)
    ctx = bf.replace_placeholders_with_empty(ctx)
    bf.enrich_context_with_words(ctx, money)
    bf.format_context_dates(ctx, datetimes)
    ctx = bf.format_context_money_values(ctx, money)
    ctx.update(bf.COLUMN_LITERAL_CONTEXT)
    allowed |= set(bf.COLUMN_LITERAL_CONTEXT)
    bf.enrich_context_with_lowercase_keys(ctx)
    root_vars = set(ctx.keys())
    valid_vars = set(root_vars)
    for val in ctx.values():
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict): valid_vars.update(item.keys())
        elif isinstance(val, dict):
            valid_vars.update(val.keys())
    with open(path, 'rb') as fh:
        src = fh.read()
    out = io.BytesIO(); parts = []
    with zipfile.ZipFile(io.BytesIO(src)) as zin, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename in ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml']:
                data = bf.translate_xml_tags(data.decode('utf-8'), valid_vars, root_vars=root_vars).encode('utf-8')
            if it.filename.startswith('word/') and it.filename.lower().endswith('.xml'):
                parts.append(data.decode('utf-8'))
            zout.writestr(it, data)
    ts.validate_template_statements(parts)
    ts.validate_template_root_keys(parts, allowed)
    doc = DocxTemplate(io.BytesIO(out.getvalue()))
    # images (like convert_images_in_context)
    def imgs(d):
        if isinstance(d, dict):
            for k, v in list(d.items()):
                if k.startswith(IMAGE_PREFIXES) and v == 'IMG':
                    d[k] = InlineImage(doc, tiny_png(), width=Inches(1.0))
                else:
                    imgs(v)
        elif isinstance(d, list):
            for x in d: imgs(x)
    imgs(ctx)
    doc.render(ctx, jinja_env=ts.create_template_environment())
    b = io.BytesIO(); doc.save(b)
    return b.getvalue()


def doc_text(data):
    from lxml import etree
    W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    x = etree.fromstring(zipfile.ZipFile(io.BytesIO(data)).read('word/document.xml'))
    return '\n'.join(''.join(t.text or '' for t in p.iter(W + 't')) for p in x.iter(W + 'p'))


if __name__ == '__main__':
    root, outdir = sys.argv[1], sys.argv[2]
    results = {}
    for dp, _dirs, fn in os.walk(root):
        for f in sorted(fn):
            if not f.endswith('.docx'): continue
            p = os.path.join(dp, f); rel = os.path.relpath(p, root); folder = rel.split(os.sep)[0]
            try:
                data = render(p, folder in PLAN_FOLDERS)
                o = os.path.join(outdir, rel); os.makedirs(os.path.dirname(o), exist_ok=True)
                with open(o, 'wb') as fh:
                    fh.write(data)
                txt = doc_text(data)
                bad = re.findall(r'\{[^}\n]{0,40}\}?|\{\{|\{%', txt)
                results[rel] = {'ok': True, 'braces': bad[:5], 'None': txt.count('None'),
                                'unmapped': len(re.findall(r'\[\[', txt))}
            except Exception as e:
                results[rel] = {'ok': False, 'error': repr(e)[:300]}
    # Next to the rendered output, not in the repo: it is a per-run artifact.
    with open(os.path.join(outdir, 'results.json'), 'w', encoding='utf-8') as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    ok = sum(1 for r in results.values() if r['ok'])
    print('rendered OK', ok, '/', len(results))
    for k, r in results.items():
        if not r['ok'] or r.get('braces') or r.get('None'):
            print(k, r)
