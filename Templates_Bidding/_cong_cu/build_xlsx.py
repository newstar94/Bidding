# -*- coding: utf-8 -*-
import json, re, sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
from collections import Counter
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

sys.path.insert(0, HERE)
from mapping import UNMAPPED

R = json.load(open(os.path.join(HERE, 'convert_report.json')))
VARS = {v['name']: v for v in json.load(open(os.path.join(HERE, 'vars.json')))}
META = json.load(open(os.path.join(HERE, 'meta.json')))
COL_LABEL = {}
PRIORITY = ['thong_tin_mo_thau', 'nha_thau', 'chuyen_gia', 'hop_dong', 'goi_thau', 'ke_hoach_lcnt', 'chu_dau_tu']
for tbl in PRIORITY:
    for v in VARS.values():
        if v['sourceTable'] == tbl and v['sourceColumn']:
            COL_LABEL.setdefault(v['sourceColumn'], v['label'].replace(' mở thầu', ''))
for tbl, cols in META.items():
    for c, d in cols.items():
        COL_LABEL.setdefault(c, d.get('label', c))
COL_LABEL.update({'gia_xep_hang': 'Giá xếp hạng', 'gia_de_nghi_trung_thau': 'Giá đề nghị trúng thầu',
                  'diem_danh_gia': 'Điểm đánh giá', 'chuc_vu': 'Chức vụ trong tổ', 'cong_viec': 'Công việc được phân công',
                  'ten_cong_viec': 'Tên công việc', 'gia_tri': 'Giá trị', 'don_vi_thuc_hien': 'Đơn vị thực hiện',
                  'van_ban_phe_duyet': 'Văn bản phê duyệt', 'ten_nha_thau_trung': 'Tên nhà thầu trúng phần lô',
                  'gia_trung_thau': 'Giá trúng thầu', 'so_phan_lo_trung': 'Số phần lô trúng',
                  'tong_gia_tri_trung_thau': 'Tổng giá trị trúng thầu', 'gia_tri_phan_lo': 'Giá trị phần lô',
                  'ten_phan_lo': 'Tên phần lô', 'ma_phan_lo': 'Mã phần lô', 'anh_chu_ky': 'Ảnh chữ ký',
                  'anh_chung_chi': 'Ảnh chứng chỉ', 'bangchu_gia_tri': 'Giá trị hợp đồng bằng chữ'})
LIST_LABEL = {v['name']: v['label'] for v in VARS.values() if not v['sourceColumn']}
LIST_LABEL.update({'to_chuyen_gia': 'Tổ chuyên gia', 'to_tham_dinh': 'Tổ thẩm định',
                   'ds_nha_thau_trung_thau': 'Danh sách nhà thầu trúng thầu',
                   'ds_nha_thau_tham_du': 'Danh sách nhà thầu tham dự', 'hop_dong_list': 'Hợp đồng của gói thầu'})

NOTES = {
    'Giảm giá tổng': 'BiddingFlow chỉ có tỷ lệ giảm giá (%), không có số tiền giảm giá',
    'Giảm giá đạt kỹ thuật tổng': 'BiddingFlow chỉ có tỷ lệ giảm giá (%)', 'Giá trị giảm': 'BiddingFlow chỉ có tỷ lệ giảm giá (%)',
    'Nhà thầu hợp lệ': 'Không có danh sách riêng "đạt hợp lệ": lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu hợp lệ V2': 'Không có danh sách riêng "đạt hợp lệ": lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu đạt năng lực, kinh nghiệm': 'Không có danh sách riêng: lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu đạt năng lực, kinh nghiệm V2': 'Không có danh sách riêng: lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu đạt kỹ thuật': 'Không có danh sách riêng: lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu đạt kỹ thuật V2': 'Không có danh sách riêng: lặp toàn bộ nhà thầu tham dự',
    'Nhà thầu xếp hạng 1': 'Nhà thầu trúng / đề nghị trúng thầu (ds_nt_trung)',
    'Nhà thầu đối chiếu': 'Nhà thầu trúng / đề nghị trúng thầu (ds_nt_trung)',
    'Nhà thầu': 'Nhà thầu trúng / đề nghị trúng thầu (ds_nt_trung)',
    'Nhà thầu xếp hạng 2 trở đi': 'Nhà thầu đạt nhưng không xếp hạng 1',
    'Xếp hạng': 'Lấy kết quả "Đánh giá tài chính" (ví dụ "Xếp hạng 1")',
    'Điểm kỹ thuật': 'Điểm đánh giá của nhà thầu',
    'Giá trị phần lô': 'Trong bảng nhà thầu: giá gói thầu; trong bảng phần lô: giá trị phần lô',
    'Cơ quan ký QĐKHLCNT': 'Lấy tên chủ đầu tư',
    'Ngày thương thảo': 'Trường "Ngày đối chiếu tài liệu / thương thảo"',
    'Ngày thư mời thương thảo': 'Trường "Ngày mời đối chiếu tài liệu / thương thảo"',
    'Tiến độ': 'Thời gian thực hiện gói thầu',
    'Tên nhà thầu': 'Bảng/mục nhà thầu: lặp danh sách; thư mời, biên bản chỉ định thầu (KQCĐ): {ten_nt}',
    'Lý do không đạt tư cách hợp lệ': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'Lý do không đạt năng lực, kinh nghiệm': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'Lý do không đạt kỹ thuật': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'Tính hợp lệ-Làm rõ': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'Năng lực kinh nghiệm - Làm rõ': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'Kỹ thuật - Làm rõ': 'Chỉ hiện dòng của nhà thầu có nội dung',
    'REPEAT:TCG': 'Lặp khối cam kết cho từng thành viên tổ chuyên gia',
    'REPEAT:TTĐ': 'Lặp khối cam kết cho từng thành viên tổ thẩm định',
    'REPEAT: TTĐ': 'Lặp khối cam kết cho từng thành viên tổ thẩm định',
    'REPEAT:Dự thầu|REQUIRE:Nhà thầu xếp hạng 1': 'Lặp cả thư cho từng nhà thầu trúng / đề nghị trúng thầu',
    'Họ và tên Tổ trưởng TV': 'Thành viên có chức vụ "Tổ trưởng"', 'Họ và tên Tổ viên TV': 'Các thành viên không phải tổ trưởng',
}
INFER_NOTES = {
    'Địa danh': 'SUY LUẬN: tên tỉnh/thành phố tìm thấy trong địa chỉ chủ đầu tư (tên tỉnh cũ quy về tỉnh mới sau sáp nhập 2025). Không tìm thấy thì hiện [[Địa danh]] để điền tay',
    'Phê duyệt': 'Trường "Phê duyệt" của kế hoạch (Kế hoạch / Dự toán và kế hoạch), viết thường. Nếu trường này trống thì SUY LUẬN: có QĐ phê duyệt dự toán riêng (khác số hoặc ngày QĐ kế hoạch) → "kế hoạch"; kế hoạch loại dự toán mua sắm không có QĐ dự toán riêng → "dự toán và kế hoạch"; dự án → "kế hoạch"',
    'Số QĐ thành lập tổ': 'Tiến độ, mốc "QĐ thành lập tổ" ({so_qd_tl_to}); mốc chưa có số thì SUY LUẬN theo quy ước ".../QĐ-<tên viết tắt CĐT>" như file Excel cũ',
    'Ngày thành lập tổ': 'Tiến độ, mốc "QĐ thành lập tổ" ({ngay_qd_tl_to}); mốc chưa có ngày thì SUY LUẬN: ngày tờ trình dự toán, không có thì ngày tờ trình kế hoạch',
    'Chứng thư thẩm định': 'Tiến độ, mốc "Chứng thư thẩm định giá, Báo giá": "số <số> ngày <dd/mm/yyyy>"; mốc chưa có số và ngày thì hiện [[...]] để điền tay',
    'Ngày tờ trình KQ': 'SUY LUẬN: ngày QĐ phê duyệt kết quả; chưa có thì ngày thương thảo (quy tắc trong file Excel cũ)',
    'Ngày thư mời xác nhận năng lực': 'SUY LUẬN: ngày phê duyệt KHLCNT (quy tắc trong file Excel cũ)',
    'Ngày thư chấp thuận': 'Tiến độ, mốc "Thư chấp thuận và trao hợp đồng" ({ngay_thu_chap_thuan}); chưa có thì SUY LUẬN: ngày QĐ phê duyệt kết quả',
    'Giá tổng gói thầu': 'SUY LUẬN: đúng khi kế hoạch có 0–1 gói; nhiều gói thì hiện [[...]] (Bidding không cho phép cộng trong mẫu)',
    'Giá không áp dụng tổng': 'SUY LUẬN: đúng khi có 0–1 dòng; nhiều dòng thì hiện [[...]]',
    'Giá trị đã thực hiện tổng': 'SUY LUẬN: đúng khi có 0–1 dòng; nhiều dòng thì hiện [[...]]',
    'Giá tổng dự toán': 'SUY LUẬN: = Tổng mức đầu tư/dự toán khi không có phần việc đã thực hiện; có thì hiện [[...]]',
    'Tên gói thầu BS': 'Phần tên bổ sung: để trống', 'Tên KHLCNTBS': 'Phần tên bổ sung: để trống',
    'Áp dụng Hình thức KHLCNT': 'SUY LUẬN: "Chỉ định thầu rút gọn" → căn cứ như file Excel cũ; hình thức khác hiện [[...]]',
    'Áp dụng Phương thức KHLCNT': 'SUY LUẬN: không có phương thức → "Không có phương thức lựa chọn nhà thầu"; khác hiện [[...]]',
    'Áp dụng Loại hợp đồng KHLCNT': 'SUY LUẬN: hợp đồng đơn giá cố định → lý do như file Excel cũ; loại khác hiện [[...]]',
}
NOTES.update(INFER_NOTES)
for n in ('Số QĐ thành lập TVL', 'Ngày thành lập TVL'):
    NOTES[n] = 'Tiến độ, mốc "QĐ thành lập TCG" (tư vấn lập)'
for n in ('Số QĐ thành lập TVT', 'Ngày thành lập TVT'):
    NOTES[n] = 'Tiến độ, mốc "QĐ thành lập TTĐ" (tư vấn thẩm)'
NOTES['Ngày ký BBHT TVL'] = 'Tiến độ, mốc "Biên bản hoàn thiện hợp đồng" của tư vấn lập; riêng mẫu 5. TVTB1/3.3 (BBHT tư vấn thẩm định) lấy mốc của tư vấn thẩm'
NOTES['Ngày hoàn thiện hợp đồng'] = 'Tiến độ, mốc "BB hoàn thiện hợp đồng" (kết quả LCNT)'
for n in ('Số BCĐG', 'Ngày trình BCĐG', 'Ngày trình BCĐGS', 'Số BCTĐ KT', 'Ngày BCTĐ KT', 'Số QĐ KT', 'Ngày QĐ KT', 'Ngày QĐ KTS',
          'Số BC TC', 'Ngày BC TC', 'Ngày BC TCS', 'Số BBĐC', 'Số BCTĐ KQ', 'Ngày BCTĐKQ', 'Ngày gửi giấy mời TVL', 'Ngày gửi giấy mời TVT',
          'Ngày đơn xin TVL', 'Ngày đơn xin TVT', 'Ngày trình TVL', 'Ngày trình TVT'):
    NOTES.setdefault(n, 'Tiến độ: số/ngày văn bản của mốc tương ứng')
for n in ('Năm', 'Năm BCĐG', 'Năm HSMT', 'Năm BCTĐ HSMT', 'Năm BCTĐ KQLCNT', 'Năm TĐKT'):
    NOTES[n] = 'Năm tại thời điểm xuất file (BiddingFlow không cho dùng biến nam_...)'
for n in ('Số HĐ TVL', 'Ngày ký HĐTVL', 'Giá TVL', 'Bằng chữ Giá TVL', 'Thời gian TVL', 'Số QĐTVL', 'Ngày ký QĐTVL'):
    NOTES[n] = 'Hợp đồng của gói thầu có Phân loại = "Tư vấn"'
for n in ('Số HĐTVT', 'Ngày ký HĐTVT', 'Giá TVT', 'Bằng chữ Giá TVT', 'Thời gian TVT', 'Số QĐTVT', 'Ngày ký QĐTVT'):
    NOTES[n] = 'Hợp đồng của gói thầu có Phân loại = "Thẩm định"'


def describe(out):
    """Human description of a replacement string."""
    out = out.replace(' [IN HOA]', '')
    if 'dd[0]' in out:
        return 'Địa chỉ chủ đầu tư'
    if 'loai_hinh_mua_sam' in out:
        return 'Số, ngày QĐ dự toán / kế hoạch; loại kế hoạch'
    if 'ten_viet_tat' in out:
        return 'Tên viết tắt chủ đầu tư'
    if out == '':
        return '(để trống)'
    m = re.fullmatch(r'\{(S_)?(bangchu_)?(\w+)\}', out)
    if m and not out.startswith('{#'):
        name = m.group(3)
        if name in VARS:
            lab = VARS[name]['label']
            if m.group(1):
                lab += ' (dạng ngắn dd/mm/yyyy)'
            return lab
        if m.group(2) and ('bangchu_' + name) and name in VARS:
            return VARS[name]['label'] + ' bằng chữ'
        return COL_LABEL.get(name, name)
    m = re.fullmatch(r'\{bangchu_(\w+)\}', out)
    if m and m.group(1) in VARS:
        return VARS[m.group(1)]['label'] + ' bằng chữ'
    m = re.match(r'\{#(\w+)\}(.*)\{/\1\}$', out)
    if m:
        keys = re.findall(r'\{(\w+)\}', m.group(2))
        return 'Lặp %s: %s' % (LIST_LABEL.get(m.group(1), m.group(1)), ', '.join(COL_LABEL.get(k, k) for k in keys))
    if 'hop_dong_list' in out:
        k = re.search(r'\{\{ hd\.(\w+)', out).group(1)
        return COL_LABEL.get(k.replace('S_', ''), k) + (' (dạng ngắn)' if k.startswith('S_') else '')
    if 'current_time' in out:
        return 'Năm hiện tại'
    if 'loop.index' in out:
        return 'Số thứ tự của dòng'
    m = re.search(r'\{%\s*for (\w+) in (\w+)', out)
    if m and 'endfor' not in out:
        return 'Bắt đầu lặp ' + LIST_LABEL.get(m.group(2), m.group(2))
    if out == '{% endfor %}':
        return 'Kết thúc khối lặp'
    m = re.search(r'\{\{\s*(\w+)\.(S_)?(\w+)', out)
    if m:
        return COL_LABEL.get(m.group(3), m.group(3)) + (' (dạng ngắn)' if m.group(2) else '')
    m = re.fullmatch(r'\{(\w+)\}', out)
    if m:
        return COL_LABEL.get(m.group(1), m.group(1))
    return ''


thin = Side(style='thin', color='999999')
B = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = Font(name='Arial', bold=True, color='FFFFFF', size=10)
HFILL = PatternFill('solid', fgColor='1F4E78')
F = Font(name='Arial', size=10)
MONO = Font(name='Consolas', size=10)
WRAP = Alignment(wrap_text=True, vertical='top')


def sheet(ws, headers, rows, widths, mono_cols=()):
    ws.append(headers)
    for c in ws[1]:
        c.font, c.fill, c.alignment, c.border = HF, HFILL, Alignment(wrap_text=True, vertical='center', horizontal='center'), B
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = MONO if c.column in mono_cols else F
            c.alignment, c.border = WRAP, B
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions


samples, files, rep = R['samples'], R['files'], R['report']
wb = Workbook()
ws = wb.active
ws.title = 'Đã thay'
rows = []
names = sorted([k for k in samples], key=lambda s: s.strip().lower())
for i, k in enumerate(names, 1):
    outs = Counter(samples[k]).most_common()
    total = sum(n for _, n in outs)
    shown = '\n'.join((o if len(o) <= 600 else o[:300] + ' … ' + o[-120:]) for o, _ in outs[:4]) + ('\n…' if len(outs) > 4 else '')
    desc = '; '.join(dict.fromkeys(d for d in (describe(o) for o, _ in outs[:4]) if d))
    caps = any('[IN HOA]' in o for o, _ in outs)
    note = NOTES.get(k, '')
    if caps:
        note = (note + '; ' if note else '') + 'Giữ chữ IN HOA bằng định dạng Word (All caps)'
    unm = rep.get(k, {}).get('unmapped', 0)
    if unm:
        note = (note + '; ' if note else '') + '%d chỗ chưa thay (là dòng tổng)' % unm
    rows.append([i, '[[%s]]' % k, shown, desc, note, total, len(files.get(k, []))])
sheet(ws, ['STT', 'Placeholder mẫu cũ', 'Thay bằng (cú pháp BiddingFlow)', 'Dữ liệu lấy từ', 'Ghi chú', 'Số chỗ', 'Số file'],
      rows, [6, 34, 60, 42, 46, 8, 8], mono_cols=(3,))

ws2 = wb.create_sheet('Chưa có dữ liệu')
rows = []
unm_names = sorted([k for k in R['unmapped'] if k not in samples or rep.get(k, {}).get('unmapped')], key=str.lower)
i = 0
for k in unm_names:
    if k in samples:  # partly mapped (total rows) -> already noted on sheet 1
        continue
    i += 1
    base = {'Tư vấn lậpH': 'Tư vấn lập', 'Tư vấn thẩmH': 'Tư vấn thẩm', 'Chức vụ TVLH': 'Chức vụ TVL', 'Chức vụ TVTH': 'Chức vụ TVT'}.get(k, k)
    folders = sorted({f.split('/')[0] for f in R['unmapped'][k]})
    rows.append([i, '[[%s]]' % k, UNMAPPED.get(base, ''), rep.get(k, {}).get('unmapped', 0), len(R['unmapped'][k]), ', '.join(folders)])
sheet(ws2, ['STT', 'Placeholder giữ nguyên', 'Lý do chưa thay', 'Số chỗ', 'Số file', 'Thư mục'], rows, [6, 34, 52, 8, 8, 60])

ws3 = wb.create_sheet('Hướng dẫn')
guide = [
    ['Nội dung', 'Giải thích'],
    ['Biến đơn', '{ten_gt}, {ten_cdt}… — tên biến theo Từ điển biến Word mặc định của BiddingFlow. Thiếu dữ liệu thì để trống.'],
    ['Ngày tháng', '{ngay_qd_hsmt} → "ngày 09 tháng 3 năm 2026"; {S_ngay_qd_hsmt} → "09/3/2026" (dùng khi mẫu đã có sẵn chữ "ngày"); trường ngày giờ → "09:00 ngày 10/3/2026".'],
    ['Số tiền', '{gia_gt} → "288.000.000"; {bangchu_gia_gt} → "Hai trăm tám mươi tám triệu đồng".'],
    ['Lặp theo dòng bảng', '{#ds_nt_tham_du} … {/ds_nt_tham_du} đặt ở ô đầu và ô cuối của dòng: mỗi phần tử danh sách sinh một dòng. Trong khối lặp dùng tên trường gốc: {ten_nha_thau}, {gia_du_thau}, {ho_ten}, {chuc_vu}…'],
    ['Số thứ tự', '{{ loop.index }} trong cột STT của dòng lặp.'],
    ['Lặp có điều kiện', '{%tr for nt in ds_nha_thau_tham_du if nt.lam_ro_hop_le %} … {%tr endfor %}: chỉ sinh dòng cho nhà thầu có nội dung ở trường đó.'],
    ['Lặp khối cam kết', '{% for cg in to_chuyen_gia %} … {% endfor %} thay cho [[REPEAT:TCG]] … [[ENDREPEAT]] (tổ thẩm định: to_tham_dinh; thư mời/chấp thuận: ds_nha_thau_trung_thau). Trong khối dùng {{ cg.ho_ten|default(\'\', true) }} cho trường thành viên, biến đơn {ten_gt} vẫn dùng bình thường.'],
    ['Trường gói thầu trong dòng lặp', 'Trong dòng lặp, biến đơn phải viết theo đường dẫn: {{ goi_thau.gia_goi_thau|default(\'\', true) }} (BiddingFlow coi {gia_gt} trong khối lặp là trường của phần tử).'],
    ['Hợp đồng tư vấn', "{% for hd in hop_dong_list if hd.phan_loai|lower|trim == 'tư vấn' %}{{ hd.so_hop_dong|default('', true) }}{% endfor %} — lấy hợp đồng có Phân loại \"Tư vấn\" (\"thẩm định\" cho tư vấn thẩm định). Cần nhập hợp đồng và phân loại trong BiddingFlow."],
    ['Năm', '{{ current_time[0] }}{{ current_time[1] }}{{ current_time[2] }}{{ current_time[3] }} → năm tại thời điểm xuất.'],
    ['Chữ in hoa', 'Các placeholder đuôi H (ví dụ [[Tên CĐTH]]) được thay bằng biến thường và đặt định dạng All caps trên chữ, kết quả xuất ra vẫn in hoa.'],
    ['Số/ngày theo Tiến độ', '{so_<mốc>} và {ngay_<mốc>} (ví dụ {so_bcdg}, {ngay_qd_tl_tcg}, {S_ngay_bcdg}) lấy số văn bản và ngày của mốc trên tab Tiến độ gói thầu: ngày thực tế, chưa có thì ngày dự kiến; mốc không áp dụng thì để trống. Cần bản BiddingFlow có ADR 0042 (biến mặc định v17).'],
    ['Giá trị suy luận', 'Các mục ghi "SUY LUẬN" ở trang "Đã thay" được tính từ dữ liệu Bidding theo quy tắc (địa chỉ CĐT → địa danh; số/ngày QĐ dự toán → "kế hoạch" hay "dự toán và kế hoạch"; các ngày theo quy tắc của file Excel cũ…). Trường hợp quy tắc không áp dụng được thì vẫn hiện [[...]] để điền tay.'],
    ['Placeholder còn lại', 'Giữ nguyên [[...]] màu đỏ (xem trang "Chưa có dữ liệu") để điền tay sau khi xuất. Biến đã thay được bỏ màu đỏ.'],
    ['Gán biểu mẫu', 'Tải các file lên mục Biểu mẫu Word, rồi gán đúng chức năng: KHLCNT → Kế hoạch LCNT; 3/4. TVLB1-2 → Tư vấn lập Bước 1-2; 5/6. TVTB1-2 → Tư vấn thẩm định Bước 1-2; 8. BCĐG → Báo cáo đánh giá; 9. KQLCNT → Báo cáo thẩm định, KQLCNT; 10/11. KQCĐ → Kết quả lựa chọn nhà thầu.'],
    ['Đã kiểm tra', 'Cả 101 file đã chạy thử qua bộ dịch biến, kiểm tra bảo mật mẫu và docxtpl của BiddingFlow với dữ liệu giả: xuất được, không còn ký hiệu biến sót, file Word hợp lệ.'],
]
sheet(ws3, guide[0], guide[1:], [28, 120])
wb.save(sys.argv[1])
print('rows', ws.max_row - 1, ws2.max_row - 1)
