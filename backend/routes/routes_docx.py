import os
import json
import re
import zipfile
import ast
from datetime import datetime, date, timedelta
from urllib.parse import quote
from starlette.responses import StreamingResponse, JSONResponse

from helpers import (
    database,
    verify_session,
    clean_id,
    get_active_org,
    VietnameseFloat,
    OrgPermissionError
)
import custom_exporter
import services.docx_service as docx_service
import uuid

SYSTEM_TEMPLATES = {'mau_bao_cao_dau_thau.docx', 'mau_hop_dong_lcnt.docx'}
MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024
COMPUTED_SOURCE_TABLE = '__computed__'
CONTEXT_SOURCE_TABLE = '__context__'

WORD_DYNAMIC_MAPPING_SEEDS = [
    ("ds_phan_lo", "ds_phan_lo", "", "Danh sách tất cả phần lô"),
    ("ds_nha_thau", "ds_nha_thau", "", "Danh sách nhà thầu tham dự"),
    ("ds_nha_thau_trung", "ds_nha_thau_trung", "", "Danh sách nhà thầu trúng thầu"),
    ("ds_nha_thau_truot", "ds_nha_thau_truot", "", "Danh sách nhà thầu trượt thầu"),
    ("ds_phan_lo_co_nha_thau_tham_du", "ds_phan_lo_co_nha_thau_tham_du", "", "Danh sách phần lô có nhà thầu tham dự"),
    ("ds_phan_lo_khong_co_nha_thau_tham_du", "ds_phan_lo_khong_co_nha_thau_tham_du", "", "Danh sách phần lô không có nhà thầu tham dự"),
    ("ds_phan_lo_co_nha_thau_trung", "ds_phan_lo_co_nha_thau_trung", "", "Danh sách phần lô có nhà thầu trúng thầu"),
    ("ds_phan_lo_tham_du_khong_trung", "ds_phan_lo_tham_du_khong_trung", "", "Danh sách phần lô có nhà thầu tham dự nhưng không có nhà thầu trúng"),
    ("tong_so_phan_lo", CONTEXT_SOURCE_TABLE, "tong_so_phan_lo", "Tổng số phần lô"),
    ("so_phan_lo_co_nha_thau_tham_du", CONTEXT_SOURCE_TABLE, "so_phan_lo_co_nha_thau_tham_du", "Số phần lô có nhà thầu tham dự"),
    ("so_phan_lo_khong_co_nha_thau_tham_du", CONTEXT_SOURCE_TABLE, "so_phan_lo_khong_co_nha_thau_tham_du", "Số phần lô không có nhà thầu tham dự"),
    ("so_phan_lo_co_nha_thau_trung", CONTEXT_SOURCE_TABLE, "so_phan_lo_co_nha_thau_trung", "Số phần lô có nhà thầu trúng thầu"),
    ("so_phan_lo_tham_du_khong_trung", CONTEXT_SOURCE_TABLE, "so_phan_lo_tham_du_khong_trung", "Số phần lô tham dự nhưng không có nhà thầu trúng")
]

def ensure_dynamic_word_mappings_for_org(org_name):
    org_name = str(org_name or '').strip()
    if not org_name:
        return 0

    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        existing = cursor.fetchall()
        existing_keys = {(row[1], row[2]) for row in existing}
        existing_vars = {str(row[0] or '').lower() for row in existing}

        inserted = 0
        for ten_bien, source_table, source_column, mo_ta in WORD_DYNAMIC_MAPPING_SEEDS:
            if ten_bien.lower() in existing_vars:
                continue
            if (source_table, source_column) in existing_keys:
                continue
            mapping_id = "wmp-" + str(uuid.uuid4())[:8]
            cursor.execute("""
                INSERT INTO cau_hinh_bien_word (id, ten_bien, source_table, source_column, mo_ta, owner_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (mapping_id, ten_bien, source_table, source_column, mo_ta, org_name))
            existing_vars.add(ten_bien.lower())
            existing_keys.add((source_table, source_column))
            inserted += 1

        conn.commit()
        return inserted
    finally:
        conn.close()


def ensure_default_word_mappings_for_all_orgs():
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        owners = set()
        try:
            cursor.execute("SELECT id FROM to_chuc WHERE id IS NOT NULL AND TRIM(id) <> ''")
            owners.update(str(row[0]).strip() for row in cursor.fetchall() if row[0])
        except Exception:
            pass
        try:
            cursor.execute("SELECT DISTINCT owner_id FROM cau_hinh_bien_word WHERE owner_id IS NOT NULL AND TRIM(owner_id) <> ''")
            owners.update(str(row[0]).strip() for row in cursor.fetchall() if row[0])
        except Exception:
            pass
    finally:
        conn.close()

    total_inserted = 0
    for owner in sorted(owners):
        total_inserted += ensure_default_word_mappings_for_org(owner)
    return total_inserted



def ensure_default_word_mappings_for_org(org_name):
    org_name = str(org_name or '').strip()
    if not org_name:
        return 0

    return ensure_dynamic_word_mappings_for_org(org_name)

def _safe_filename(value, fallback='download.docx'):
    name = os.path.basename(str(value or fallback)).strip()
    name = re.sub(r'[^A-Za-z0-9_.-]+', '_', name)
    name = name.strip('._')
    return name or fallback


def _content_disposition(filename):
    safe_name = _safe_filename(filename)
    return f"attachment; filename={safe_name}; filename*=UTF-8''{quote(safe_name)}"


def _resolve_template_path(user_id, filename):
    safe_name = _safe_filename(filename)
    if safe_name in SYSTEM_TEMPLATES:
        base_dir = os.path.realpath(custom_exporter.TEMPLATE_DIR)
    else:
        base_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
    path = os.path.realpath(os.path.join(base_dir, safe_name))
    if not path.startswith(base_dir + os.sep):
        raise ValueError('Tên mẫu không hợp lệ')
    if not os.path.exists(path):
        raise FileNotFoundError('Không tìm thấy mẫu Word')
    return path, safe_name


def _validate_docx_upload(filename, content):
    safe_name = _safe_filename(filename, f"template_{uuid.uuid4().hex[:8]}.docx")
    root, ext = os.path.splitext(safe_name)
    if ext.lower() != '.docx':
        raise ValueError('Chỉ cho phép tải lên tệp .docx')
    if not content:
        raise ValueError('Tệp tải lên đang trống')
    if len(content) > MAX_TEMPLATE_UPLOAD_BYTES:
        raise ValueError('Tệp mẫu vượt quá giới hạn 10MB')
    import io
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = set(zf.namelist())
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                raise ValueError('Tệp .docx không hợp lệ')
    except zipfile.BadZipFile:
        raise ValueError('Tệp .docx không hợp lệ')
    return _safe_filename(f"{root[:80]}_{uuid.uuid4().hex[:8]}.docx")

def enrich_context_with_filtered_bidders(context):
    bids = context.get('nha_thau', [])
    if not isinstance(bids, list):
        bids = []

    pkg = context.get('goi_thau', {})
    nha_thau_trung_thau_id = pkg.get('nha_thau_trung_thau_id') if isinstance(pkg, dict) else None

    winning_bids = []
    failed_bids = []
    for b in bids:
        if not isinstance(b, dict):
            continue
        is_winner = False
        if nha_thau_trung_thau_id and b.get('nha_thau_id') == nha_thau_trung_thau_id:
            is_winner = True
        elif b.get('danh_gia_ket_luan') in ('Trúng thầu', 'Đề nghị trúng thầu', 'Đạt'):
            is_winner = True

        if is_winner:
            winning_bids.append(b)
        else:
            failed_bids.append(b)

    context['nha_thau_trung_thau'] = winning_bids
    context['nha_thau_truot_thau'] = failed_bids
    context['ds_nha_thau'] = bids
    context['ds_nha_thau_trung'] = winning_bids
    context['ds_nha_thau_truot'] = failed_bids


def _ensure_list(value):
    return value if isinstance(value, list) else []


def _as_text(value):
    return str(value or '').strip()


def _same_id(left, right):
    return _as_text(left) and _as_text(left) == _as_text(right)


def _money_text(value):
    try:
        amount = float(value or 0)
        if amount == 0:
            return ''
        return f'{VietnameseFloat(amount)}'
    except Exception:
        return _as_text(value)


def _bid_display_item(bid):
    item = dict(bid or {})
    item['ten_nha_thau'] = item.get('ten_nha_thau') or item.get('ten_nha_thau_mt') or ''
    item['ma_nha_thau'] = item.get('ma_nha_thau') or item.get('ma_dinh_danh') or ''
    item['_gia_du_thau_raw'] = item.get('gia_du_thau')
    item['_gia_sau_giam_gia_raw'] = item.get('gia_sau_giam_gia')
    item['gia_du_thau'] = _money_text(item.get('gia_du_thau'))
    item['gia_sau_giam_gia'] = _money_text(item.get('gia_sau_giam_gia'))
    item['ly_do_truot'] = item.get('ly_do_truot') or item.get('nguyen_nhan_khong_dat_tai_chinh') or ''
    return item


def _strip_private_keys(item):
    if not isinstance(item, dict):
        return item
    return {k: v for k, v in item.items() if not str(k).startswith('_')}


def enrich_context_with_lot_summaries(context):
    pkg = context.get('goi_thau')
    if not isinstance(pkg, dict):
        return

    phan_lo_list = _ensure_list(pkg.get('phan_lo_list'))
    awarded_phan_lo_list = _ensure_list(pkg.get('awarded_phan_lo_list'))
    bids = _ensure_list(context.get('nha_thau'))

    if not phan_lo_list and not awarded_phan_lo_list:
        context['ds_phan_lo'] = []
        context['ds_phan_lo_co_nha_thau_tham_du'] = []
        context['ds_phan_lo_khong_co_nha_thau_tham_du'] = []
        context['ds_phan_lo_co_nha_thau_trung'] = []
        context['ds_phan_lo_tham_du_khong_trung'] = []
        context['ds_nha_thau_trung'] = []
        return

    lots_by_code = {}
    for lot in phan_lo_list + awarded_phan_lo_list:
        if not isinstance(lot, dict):
            continue
        code = _as_text(lot.get('ma_phan_lo'))
        if not code:
            continue
        merged = dict(lots_by_code.get(code, {}))
        merged.update(lot)
        lots_by_code[code] = merged

    awarded_by_code = {
        _as_text(lot.get('ma_phan_lo')): lot
        for lot in awarded_phan_lo_list
        if isinstance(lot, dict) and _as_text(lot.get('ma_phan_lo'))
    }

    bids_by_lot = {}
    for bid in bids:
        if not isinstance(bid, dict):
            continue
        code = _as_text(bid.get('ma_phan_lo'))
        if not code:
            continue
        bids_by_lot.setdefault(code, []).append(bid)
        if code not in lots_by_code:
            lots_by_code[code] = {
                'ma_phan_lo': code,
                'ten_phan_lo': bid.get('ten_phan_lo') or ''
            }

    all_lots = []
    lots_with_participants = []
    lots_without_participants = []
    lots_with_winner = []
    lots_participated_without_winner = []
    winner_groups = {}

    for code in sorted(lots_by_code.keys(), key=lambda x: x.lower()):
        lot = dict(lots_by_code[code])
        lot_award = awarded_by_code.get(code, {})
        for key, val in lot_award.items():
            if val not in (None, ''):
                lot[key] = val

        participants = [_bid_display_item(bid) for bid in bids_by_lot.get(code, [])]
        winner_id = lot.get('nha_thau_trung_thau_id') or lot_award.get('nha_thau_trung_thau_id')
        winner_bid = next((bid for bid in participants if _same_id(bid.get('nha_thau_id'), winner_id)), None)

        winner_item = None
        if winner_id:
            winner_item = dict(winner_bid or {})
            winner_item['nha_thau_id'] = winner_id
            winner_item['ten_nha_thau'] = winner_item.get('ten_nha_thau') or lot.get('ten_nha_thau_trung') or ''
            winner_item['ma_nha_thau'] = winner_item.get('ma_nha_thau') or ''
            winner_price = lot.get('gia_trung_thau') or lot_award.get('gia_trung_thau') or winner_item.get('_gia_sau_giam_gia_raw') or winner_item.get('_gia_du_thau_raw') or 0
            winner_item['_gia_trung_thau_raw'] = winner_price
            winner_item['gia_trung_thau'] = _money_text(winner_price)
            winner_item['thoi_gian_goi_thau'] = lot.get('thoi_gian_goi_thau') or winner_item.get('thoi_gian_thuc_hien') or ''
            winner_item['thoi_gian_hop_dong'] = lot.get('thoi_gian_hop_dong') or ''

        failed_bidders = []
        for bid in participants:
            if winner_id and _same_id(bid.get('nha_thau_id'), winner_id):
                continue
            failed = dict(bid)
            failed['ly_do_truot'] = failed.get('ly_do_truot') or ('Không được lựa chọn do có nhà thầu khác trúng thầu' if winner_id else 'Không có nhà thầu được lựa chọn trúng thầu')
            failed_bidders.append(failed)

        winner_display_item = dict(winner_item) if winner_item else None
        if winner_display_item:
            winner_display_item.pop('_gia_du_thau_raw', None)
            winner_display_item.pop('_gia_sau_giam_gia_raw', None)
            winner_display_item.pop('_gia_trung_thau_raw', None)

        lot_item = dict(lot)
        lot_item['ma_phan_lo'] = code
        lot_item['ten_phan_lo'] = lot_item.get('ten_phan_lo') or ''
        lot_item['ds_nha_thau'] = [_strip_private_keys(bid) for bid in participants]
        lot_item['ds_nha_thau_trung'] = [winner_display_item] if winner_display_item else []
        lot_item['ds_nha_thau_truot'] = [_strip_private_keys(bid) for bid in failed_bidders]
        lot_item['so_nha_thau_tham_du'] = len(participants)
        lot_item['co_nha_thau_tham_du'] = 'Có' if participants else 'Không'
        lot_item['co_nha_thau_trung'] = 'Có' if winner_item else 'Không'
        lot_item['ten_nha_thau_trung'] = winner_item.get('ten_nha_thau') if winner_item else ''
        lot_item['gia_trung_thau'] = winner_item.get('gia_trung_thau') if winner_item else ''
        lot_item['ds_ten_nha_thau_tham_du'] = '; '.join([b.get('ten_nha_thau') for b in participants if b.get('ten_nha_thau')])
        lot_item['ly_do_khong_trung'] = '; '.join([b.get('ly_do_truot') for b in failed_bidders if b.get('ly_do_truot')])

        all_lots.append(lot_item)
        if participants:
            lots_with_participants.append(lot_item)
        else:
            lots_without_participants.append(lot_item)
        if winner_item:
            lots_with_winner.append(lot_item)
            winner_key = _as_text(winner_item.get('nha_thau_id')) or winner_item.get('ten_nha_thau') or 'unknown'
            group = winner_groups.setdefault(winner_key, {
                'nha_thau_id': winner_item.get('nha_thau_id') or '',
                'ma_nha_thau': winner_item.get('ma_nha_thau') or '',
                'ten_nha_thau': winner_item.get('ten_nha_thau') or '',
                '_tong_gia_tri_trung_thau_raw': 0,
                'ds_phan_lo': []
            })
            try:
                group['_tong_gia_tri_trung_thau_raw'] += float(winner_item.get('_gia_trung_thau_raw') or 0)
            except Exception:
                pass
            won_lot_item = {
                'ma_phan_lo': code,
                'ten_phan_lo': lot_item.get('ten_phan_lo') or '',
                'gia_trung_thau': winner_item.get('gia_trung_thau') or 0,
                'thoi_gian_goi_thau': winner_item.get('thoi_gian_goi_thau') or '',
                'thoi_gian_hop_dong': winner_item.get('thoi_gian_hop_dong') or ''
            }
            group['ds_phan_lo'].append(won_lot_item)
        elif participants:
            lots_participated_without_winner.append(lot_item)

    winner_summary = []
    for group in winner_groups.values():
        group['so_phan_lo_trung'] = len(group['ds_phan_lo'])
        group['tong_gia_tri_trung_thau'] = _money_text(group.pop('_tong_gia_tri_trung_thau_raw', 0))
        winner_summary.append(group)

    context['ds_phan_lo'] = all_lots
    context['ds_phan_lo_co_nha_thau_tham_du'] = lots_with_participants
    context['ds_phan_lo_khong_co_nha_thau_tham_du'] = lots_without_participants
    context['ds_phan_lo_co_nha_thau_trung'] = lots_with_winner
    context['ds_phan_lo_tham_du_khong_trung'] = lots_participated_without_winner
    context['ds_nha_thau_trung'] = winner_summary
    context['tong_so_phan_lo'] = len(all_lots)
    context['so_phan_lo_co_nha_thau_tham_du'] = len(lots_with_participants)
    context['so_phan_lo_khong_co_nha_thau_tham_du'] = len(lots_without_participants)
    context['so_phan_lo_co_nha_thau_trung'] = len(lots_with_winner)
    context['so_phan_lo_tham_du_khong_trung'] = len(lots_participated_without_winner)


def _project_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load_holidays():
    holidays_file = os.path.join(_project_root(), 'holidays.json')
    try:
        with open(holidays_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _parse_formula_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        raise ValueError('Gia tri ngay thang dang trong')
    text = str(value).strip()
    if not text or text == '--':
        raise ValueError('Gia tri ngay thang dang trong')
    text = text.split('T')[0].split(' ')[0]
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f'Khong doc duoc ngay thang: {value}')


def _format_formula_date(value):
    if isinstance(value, (datetime, date)):
        return value.strftime('%d/%m/%Y')
    return value


def _to_number(value):
    if isinstance(value, (int, float)):
        return value
    if value is None:
        return 0
    text = str(value).strip()
    if not text or text == '--':
        return 0
    normalized = re.sub(r'[^\d,.\-]', '', text)
    if ',' in normalized and '.' in normalized:
        normalized = normalized.replace('.', '').replace(',', '.')
    elif ',' in normalized:
        normalized = normalized.replace(',', '.')
    elif normalized.count('.') > 1:
        normalized = normalized.replace('.', '')
    return float(normalized)


def _is_working_day(day, holidays_data):
    iso = day.isoformat()
    year_cfg = holidays_data.get(str(day.year), {}) if isinstance(holidays_data, dict) else {}
    if iso in set(year_cfg.get('working_weekends') or []):
        return True
    if day.weekday() >= 5:
        return False
    return iso not in set(year_cfg.get('holidays') or [])


def _add_working_days(start, amount, holidays_data):
    day = _parse_formula_date(start)
    steps = int(_to_number(amount))
    if steps == 0:
        return day
    direction = 1 if steps > 0 else -1
    remaining = abs(steps)
    while remaining:
        day += timedelta(days=direction)
        if _is_working_day(day, holidays_data):
            remaining -= 1
    return day


def _diff_working_days(start, end, holidays_data):
    start_day = _parse_formula_date(start)
    end_day = _parse_formula_date(end)
    if start_day == end_day:
        return 0
    direction = 1 if end_day > start_day else -1
    count = 0
    day = start_day
    while day != end_day:
        day += timedelta(days=direction)
        if _is_working_day(day, holidays_data):
            count += direction
    return count


class _FormulaEvaluator(ast.NodeVisitor):
    def __init__(self, variables, holidays_data):
        self.variables = variables
        self.holidays_data = holidays_data
        self.functions = {
            'addDays': lambda d, n: _parse_formula_date(d) + timedelta(days=int(_to_number(n))),
            'subtractDays': lambda d, n: _parse_formula_date(d) - timedelta(days=int(_to_number(n))),
            'addWorkingDays': lambda d, n: _add_working_days(d, n, self.holidays_data),
            'subtractWorkingDays': lambda d, n: _add_working_days(d, -int(_to_number(n)), self.holidays_data),
            'nextWorkingDay': lambda d: _add_working_days(d, 1, self.holidays_data),
            'previousWorkingDay': lambda d: _add_working_days(d, -1, self.holidays_data),
            'diffWorkingDays': lambda a, b: _diff_working_days(a, b, self.holidays_data),
            'isWorkingDay': lambda d: _is_working_day(_parse_formula_date(d), self.holidays_data),
            'round': lambda v, digits=0: round(_to_number(v), int(_to_number(digits))),
            'ceil': lambda v: __import__('math').ceil(_to_number(v)),
            'floor': lambda v: __import__('math').floor(_to_number(v)),
            'formatDate': lambda d, fmt='dd/MM/yyyy': _format_date_custom(_parse_formula_date(d), fmt),
            'formatNumber': lambda v: f"{_to_number(v):,.0f}".replace(',', '.'),
        }

    def visit_Expression(self, node):
        return self.visit(node.body)

    def visit_Constant(self, node):
        return node.value

    def visit_Name(self, node):
        if node.id in self.variables:
            return self.variables[node.id]
        raise ValueError(f'Bien "{node.id}" chua co gia tri')

    def visit_UnaryOp(self, node):
        val = self.visit(node.operand)
        if isinstance(node.op, ast.USub):
            return -_to_number(val)
        if isinstance(node.op, ast.UAdd):
            return _to_number(val)
        raise ValueError('Toan tu khong duoc ho tro')

    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        if isinstance(node.op, ast.Add):
            if isinstance(left, (date, datetime)):
                return _parse_formula_date(left) + timedelta(days=int(_to_number(right)))
            if isinstance(right, (date, datetime)):
                return _parse_formula_date(right) + timedelta(days=int(_to_number(left)))
            return _to_number(left) + _to_number(right)
        if isinstance(node.op, ast.Sub):
            if isinstance(left, (date, datetime)):
                return _parse_formula_date(left) - timedelta(days=int(_to_number(right)))
            return _to_number(left) - _to_number(right)
        if isinstance(node.op, ast.Mult):
            return _to_number(left) * _to_number(right)
        if isinstance(node.op, ast.Div):
            return _to_number(left) / _to_number(right)
        if isinstance(node.op, ast.Mod):
            return _to_number(left) % _to_number(right)
        raise ValueError('Toan tu khong duoc ho tro')

    def visit_Call(self, node):
        if not isinstance(node.func, ast.Name) or node.func.id not in self.functions:
            raise ValueError('Ham cong thuc khong duoc ho tro')
        args = [self.visit(arg) for arg in node.args]
        return self.functions[node.func.id](*args)

    def visit_IfExp(self, node):
        return self.visit(node.body if self.visit(node.test) else node.orelse)

    def visit_Compare(self, node):
        left = self.visit(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = self.visit(comparator)
            l_val = _to_comparable(left)
            r_val = _to_comparable(right)
            if isinstance(op, ast.Eq):
                ok = l_val == r_val
            elif isinstance(op, ast.NotEq):
                ok = l_val != r_val
            elif isinstance(op, ast.Lt):
                ok = l_val < r_val
            elif isinstance(op, ast.LtE):
                ok = l_val <= r_val
            elif isinstance(op, ast.Gt):
                ok = l_val > r_val
            elif isinstance(op, ast.GtE):
                ok = l_val >= r_val
            else:
                raise ValueError('Phep so sanh khong duoc ho tro')
            if not ok:
                return False
            left = right
        return True

    def visit_BoolOp(self, node):
        if isinstance(node.op, ast.And):
            return all(self.visit(v) for v in node.values)
        if isinstance(node.op, ast.Or):
            return any(self.visit(v) for v in node.values)
        raise ValueError('Phep logic khong duoc ho tro')

    def generic_visit(self, node):
        raise ValueError('Cu phap cong thuc khong duoc ho tro')


def _format_date_custom(day, fmt):
    fmt = str(fmt or 'dd/MM/yyyy')
    return fmt.replace('dd', f'{day.day:02d}').replace('MM', f'{day.month:02d}').replace('yyyy', f'{day.year:04d}')


def _to_comparable(value):
    if isinstance(value, (date, datetime)):
        return _parse_formula_date(value)
    try:
        return _to_number(value)
    except Exception:
        return str(value)


def _evaluate_formula(formula, variables, holidays_data):
    normalized = (formula or '').strip()
    normalized = re.sub(r'\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}', r'\1', normalized)
    normalized = re.sub(r'\bif\s*\(', 'if_(', normalized)
    normalized = normalized.replace(' and ', ' and ').replace(' or ', ' or ')
    evaluator = _FormulaEvaluator(variables, holidays_data)
    evaluator.functions['if_'] = lambda cond, yes, no='': yes if cond else no
    tree = ast.parse(normalized, mode='eval')
    return evaluator.visit(tree)


def apply_computed_mappings(context, mappings_rows):
    computed_rows = []
    variables = {k: v for k, v in context.items() if isinstance(k, str)}
    for row in mappings_rows:
        ten_bien, src_table, src_column = row[:3]
        if src_table == COMPUTED_SOURCE_TABLE:
            computed_rows.append((str(ten_bien or '').lower(), src_column or ''))

    holidays_data = _load_holidays()
    pending = dict(computed_rows)
    for _ in range(len(pending) + 1):
        progressed = False
        for ten_bien, formula in list(pending.items()):
            try:
                value = _evaluate_formula(formula, variables, holidays_data)
                value = _format_formula_date(value)
                context[ten_bien] = value
                variables[ten_bien] = value
                del pending[ten_bien]
                progressed = True
            except ValueError as exc:
                if 'chua co gia tri' not in str(exc):
                    context[ten_bien] = f'-- Loi cong thuc: {exc}'
                    variables[ten_bien] = context[ten_bien]
                    del pending[ten_bien]
                    progressed = True
        if not pending or not progressed:
            break

    for ten_bien, formula in pending.items():
        context[ten_bien] = '-- Loi cong thuc: vong lap hoac thieu bien nguon'

def apply_custom_mappings(context, mappings_rows):
    from helpers import VietnameseFloat
    # Mapping table name to context keys
    table_to_context = {
        'ke_hoach_lcnt': ['ke_hoach'],
        'goi_thau': ['goi_thau', 'goi_thau_versions', 'goi_thau'],
        'nha_thau': ['nha_thau'],
        'nha_thau_trung_thau': ['nha_thau_trung_thau'],
        'nha_thau_truot_thau': ['nha_thau_truot_thau'],
        'chu_dau_tu': ['chu_dau_tu'],
        'hop_dong': ['hop_dong'],
        'tai_khoan': ['user'],
        'to_chuc': ['to_chuc'],
        'goi_dich_vu': ['goi_dich_vu']
    }

    # helper to format values
    def format_mapped_value(val, col_name):
        if val is None:
            return '--'
        if isinstance(val, (int, float)) and ('gia' in col_name or 'tong_muc' in col_name or 'gia_tri' in col_name or 'tong_tien' in col_name):
            try:
                return f'{VietnameseFloat(val)}'
            except Exception:
                pass
        return val

    def apply_field_to_value(target, src_column, ten_bien):
        val_found = False
        resolved_val = None
        if isinstance(target, list):
            for item in target:
                found, value = apply_field_to_value(item, src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
        elif isinstance(target, dict):
            if src_column in target and target.get(src_column) is not None:
                formatted = format_mapped_value(target.get(src_column), src_column)
                target[ten_bien] = formatted
                val_found = True
                resolved_val = formatted
            for child in target.values():
                if isinstance(child, (dict, list)):
                    found, value = apply_field_to_value(child, src_column, ten_bien)
                    if found:
                        val_found = True
                        resolved_val = value
        return val_found, resolved_val

    def apply_field_to_named_list(container, list_key, src_column, ten_bien):
        val_found = False
        resolved_val = None
        if isinstance(container, dict):
            if list_key in container and isinstance(container[list_key], list):
                found, value = apply_field_to_value(container[list_key], src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
            for child in container.values():
                if isinstance(child, (dict, list)):
                    found, value = apply_field_to_named_list(child, list_key, src_column, ten_bien)
                    if found:
                        val_found = True
                        resolved_val = value
        elif isinstance(container, list):
            for item in container:
                found, value = apply_field_to_named_list(item, list_key, src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
        return val_found, resolved_val

    # 1. First pass: Handle custom list mappings (where source_column is empty/null or '*')
    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if not src_column or src_column == '*' or src_column == '':
            ctx_keys = table_to_context.get(src_table, [])
            if ctx_keys:
                for key in ctx_keys:
                    if key in context and isinstance(context[key], list):
                        context[ten_bien] = [dict(item) for item in context[key]]
                        break
                    elif key in context and isinstance(context[key], dict):
                        context[ten_bien] = [dict(context[key])]
                        break
            else:
                # Handle sub-lists or nested attributes (e.g. phan_lo_list, thanh_vien_lien_danh)
                found = False
                if src_table in context and isinstance(context[src_table], list):
                    context[ten_bien] = list(context[src_table])
                    found = True
                if not found:
                    for ctx_val in context.values():
                        if isinstance(ctx_val, dict) and src_table in ctx_val:
                            val = ctx_val[src_table]
                            if isinstance(val, list):
                                context[ten_bien] = list(val)
                                found = True
                                break
                        elif isinstance(ctx_val, list):
                            for item in ctx_val:
                                if isinstance(item, dict) and src_table in item:
                                    val = item[src_table]
                                    if isinstance(val, list):
                                        context[ten_bien] = list(val)
                                        found = True
                                        break
                            if found:
                                break

    # 2. Second pass: Handle custom field mappings (where source_column is specified)
    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if src_column and src_column != '*' and src_column != '':
            if src_table == CONTEXT_SOURCE_TABLE:
                if src_column in context:
                    context[ten_bien] = format_mapped_value(context.get(src_column), src_column)
                continue

            # Group related contractor/bid tables to self-identify contractor type
            entity_keys = {
                'ke_hoach_lcnt': ['ke_hoach'],
                'goi_thau': ['goi_thau', 'goi_thau_versions'],
                'nha_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'thong_tin_mo_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'nha_thau_trung_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'nha_thau_truot_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids', 'nha_thau_trung_thau', 'nha_thau_truot_thau'],
                'chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_tham_dinh': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'yeu_cau_lam_ro': ['yeu_cau_lam_ro_list'],
                'yeu_cau_lam_ro_list': ['yeu_cau_lam_ro_list'],
                'tra_loi_lam_ro': ['tra_loi_lam_ro_list'],
                'tra_loi_lam_ro_list': ['tra_loi_lam_ro_list'],
                'phan_lo': ['phan_lo_list', 'awarded_phan_lo_list'],
                'phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'awarded_phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'tuy_chon_mua_them': ['tuy_chon_mua_them_list'],
                'tuy_chon_mua_them_list': ['tuy_chon_mua_them_list'],
                'gia_han': ['gia_han_list'],
                'gia_han_list': ['gia_han_list'],
                'thanh_vien_lien_danh': ['thanh_vien_lien_danh'],
                'cv_da_thuc_hien': ['cv_da_thuc_hien'],
                'cv_da_thuc_hien_list': ['cv_da_thuc_hien'],
                'cv_khong_ap_dung': ['cv_khong_ap_dung'],
                'cv_khong_ap_dung_list': ['cv_khong_ap_dung'],
                'cv_chua_du_dieu_kien': ['cv_chua_du_dieu_kien'],
                'cv_chua_du_dieu_kien_list': ['cv_chua_du_dieu_kien'],
                'chu_dau_tu': ['chu_dau_tu'],
                'hop_dong': ['hop_dong'],
                'tai_khoan': ['user'],
                'to_chuc': ['to_chuc'],
                'goi_dich_vu': ['goi_dich_vu']
            }

            primary_keys = entity_keys.get(src_table, [])
            if src_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau'):
                primary_keys = list(set(entity_keys['nha_thau'] + entity_keys['thong_tin_mo_thau']))
            elif src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'):
                primary_keys = list(set(entity_keys['chuyen_gia']))
            elif src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'):
                primary_keys = ['yeu_cau_lam_ro_list']
            elif src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'):
                primary_keys = ['tra_loi_lam_ro_list']
            elif src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'):
                primary_keys = list(set(entity_keys['phan_lo']))
            elif src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'):
                primary_keys = ['tuy_chon_mua_them_list']
            elif src_table in ('gia_han', 'gia_han_list'):
                primary_keys = ['gia_han_list']
            elif src_table == 'thanh_vien_lien_danh':
                primary_keys = ['thanh_vien_lien_danh']
            elif src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'):
                primary_keys = ['cv_da_thuc_hien']
            elif src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'):
                primary_keys = ['cv_khong_ap_dung']
            elif src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'):
                primary_keys = ['cv_chua_du_dieu_kien']

            custom_lists = []
            for l_bien, l_table, l_col in mappings_rows:
                if not l_col or l_col == '*' or l_col == '':
                    is_match = (
                        (l_table == src_table)
                        or (src_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau') and l_table in ('nha_thau', 'thong_tin_mo_thau', 'nha_thau_trung_thau', 'nha_thau_truot_thau'))
                        or (src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh') and l_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'))
                        or (src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list') and l_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'))
                        or (src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list') and l_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'))
                        or (src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list') and l_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'))
                        or (src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list') and l_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'))
                        or (src_table in ('gia_han', 'gia_han_list') and l_table in ('gia_han', 'gia_han_list'))
                        or (src_table == 'thanh_vien_lien_danh' and l_table == 'thanh_vien_lien_danh')
                        or (src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list') and l_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'))
                        or (src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list') and l_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'))
                        or (src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list') and l_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'))
                    )
                    if is_match:
                        custom_lists.append(l_bien.lower())

            all_keys = list(set(primary_keys + custom_lists))

            val_found = False
            resolved_val = None

            for key in all_keys:
                if key in context:
                    found, value = apply_field_to_value(context[key], src_column, ten_bien)
                    if found:
                        resolved_val = value
                        val_found = True
                else:
                    for ctx_val in context.values():
                        found, value = apply_field_to_named_list(ctx_val, key, src_column, ten_bien)
                        if found:
                            resolved_val = value
                            val_found = True

            if val_found:
                context[ten_bien] = resolved_val
            else:
                # Fallback for investor
                if src_table == 'chu_dau_tu':
                    if src_column == 'ten_chu_dau_tu':
                        context[ten_bien] = context.get('investor_name', '--')
                    elif src_column == 'dia_chi':
                        context[ten_bien] = context.get('investor_address', '--')

async def export_plan_api(request):
    plan_id = clean_id(request.path_params.get('plan_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        # Build context from service
        unified_context = docx_service.build_plan_context(plan_id, user_id, org_name)
        enrich_context_with_filtered_bidders(unified_context)
        enrich_context_with_lot_summaries(unified_context)

        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)

        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)

        filename = f"Ke_hoach_LCNT_{unified_context['ke_hoach']['ma_ke_hoach']}.docx"
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(filename)}
        )
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def export_report_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    type_param = request.query_params.get('type', 'evaluation')
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        # Build context from service
        unified_context = docx_service.build_report_context(package_id, user_id, org_name, type_param)
        enrich_context_with_filtered_bidders(unified_context)
        enrich_context_with_lot_summaries(unified_context)

        # Load mappings
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        conn.close()

        apply_custom_mappings(unified_context, mappings_rows)
        apply_computed_mappings(unified_context, mappings_rows)
        custom_vars_list = [row[0].lower() for row in mappings_rows]

        active_tpl = custom_exporter.get_active_template(user_id)
        if type_param == 'contract':
            if active_tpl != 'mau_hop_dong_lcnt.docx':
                active_tpl = 'mau_hop_dong_lcnt.docx'

        tpl_path, active_tpl = _resolve_template_path(user_id, active_tpl)

        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)

        if type_param == 'contract':
            filename = f"Hop_dong_{unified_context['hop_dong'].get('so_hop_dong', 'LCNT')}.docx"
        elif type_param in ['hsmt', 'opening']:
            filename = f"{type_param.upper()}_{unified_context['goi_thau']['ma_goi_thau']}.docx"
        else:
            filename = f"Bao_cao_danh_gia_goi_thau_{unified_context['goi_thau']['ma_goi_thau']}.docx"

        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": _content_disposition(filename)}
        )
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def list_templates_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        templates = custom_exporter.list_templates(user_id)
        return JSONResponse(templates)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def set_active_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        data = await request.json()
        template_name = data.get('template_name') or data.get('filename')
        if not template_name:
            return JSONResponse({"error": "Missing template_name parameter"}, status_code=400)

        _, safe_name = _resolve_template_path(user_id, template_name)
        custom_exporter.set_active_template(safe_name, user_id)
        return JSONResponse({"success": True})
    except FileNotFoundError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def upload_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        form = await request.form()
        file_obj = form.get('file')
        if not file_obj:
            return JSONResponse({"success": False, "error": "Không tìm thấy tệp tin tải lên!"}, status_code=400)

        content = await file_obj.read()
        try:
            filename = _validate_docx_upload(file_obj.filename, content)
        except ValueError as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=400)

        user_dir = os.path.realpath(custom_exporter.get_user_template_dir(user_id))
        dest_path = os.path.realpath(os.path.join(user_dir, filename))
        if not dest_path.startswith(user_dir + os.sep):
            return JSONResponse({"success": False, "error": "Tên tệp không hợp lệ"}, status_code=400)

        with open(dest_path, "wb") as f:
            f.write(content)

        custom_exporter.set_active_template(filename, user_id)
        return JSONResponse({"success": True, "filename": filename})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

async def list_word_mappings_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)
        ensure_default_word_mappings_for_org(org_name)
        conn = database.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id, ten_bien, source_table, source_column, mo_ta FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        rows = cursor.fetchall()
        conn.close()

        mappings = []
        for row in rows:
            r = dict(row)
            r['tenBien'] = r.get('ten_bien')
            r['sourceTable'] = r.get('source_table')
            r['sourceColumn'] = r.get('source_column')
            r['mappingType'] = 'computed' if r.get('source_table') == COMPUTED_SOURCE_TABLE else 'mapping'
            r['formula'] = r.get('source_column') if r.get('source_table') == COMPUTED_SOURCE_TABLE else ''
            r['moTa'] = r.get('mo_ta')
            mappings.append(r)
        return JSONResponse(mappings)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def save_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        data = await request.json()
        ten_bien = (data.get('ten_bien') or data.get('tenBien') or '').strip().lower()
        source_table = (data.get('source_table') or data.get('sourceTable') or '').strip()
        source_column = (data.get('source_column') or data.get('sourceColumn') or '').strip()
        mapping_type = (data.get('mapping_type') or data.get('mappingType') or '').strip()
        formula = (data.get('formula') or '').strip()
        mo_ta = (data.get('mo_ta') or data.get('moTa') or '').strip()
        if mapping_type == 'computed':
            source_table = COMPUTED_SOURCE_TABLE
            source_column = formula

        if not source_column:
            source_column = ""

        if not ten_bien or not source_table:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin!"}, status_code=400)

        if source_table == COMPUTED_SOURCE_TABLE and not source_column:
            return JSONResponse({"error": "Vui long nhap cong thuc cho bien ket qua!"}, status_code=400)

        id_param = data.get('id')

        conn = database.get_connection()
        cursor = conn.cursor()

        # Check if record for this (source_table, source_column) already exists.
        # Computed variables are identified by name; two variables may reasonably reuse the same formula.
        row_by_data = None
        if source_table != COMPUTED_SOURCE_TABLE:
            cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE source_table = ? AND source_column = ? AND owner_id = ?", (source_table, source_column, org_name))
            row_by_data = cursor.fetchone()

        # Check if record for this ten_bien already exists
        cursor.execute("SELECT id FROM cau_hinh_bien_word WHERE ten_bien = ? AND owner_id = ?", (ten_bien, org_name))
        row_by_name = cursor.fetchone()
        if id_param:
            # We are updating a specific record
            # To avoid duplicates, delete any OTHER record that matches the target (source_table, source_column) or ten_bien
            if row_by_data and row_by_data[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_data[0],))
            if row_by_name and row_by_name[0] != id_param:
                cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ?", (row_by_name[0],))

            cursor.execute("""
                UPDATE cau_hinh_bien_word
                SET ten_bien = ?, source_table = ?, source_column = ?, mo_ta = ?
                WHERE id = ? AND owner_id = ?
            """, (ten_bien, source_table, source_column, mo_ta, id_param, org_name))
            mapping_id = id_param
        else:
            # We are creating a new record
            if row_by_data:
                # Overwrite by updating its ten_bien and mo_ta
                mapping_id = row_by_data[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word
                    SET ten_bien = ?, mo_ta = ?
                    WHERE id = ?
                """, (ten_bien, mo_ta, mapping_id))
            elif row_by_name:
                # Overwrite by updating its source_table and source_column
                mapping_id = row_by_name[0]
                cursor.execute("""
                    UPDATE cau_hinh_bien_word
                    SET source_table = ?, source_column = ?, mo_ta = ?
                    WHERE id = ?
                """, (source_table, source_column, mo_ta, mapping_id))
            else:
                # Insert new
                mapping_id = "wmp-" + str(uuid.uuid4())[:8]
                cursor.execute("""
                    INSERT INTO cau_hinh_bien_word (id, ten_bien, source_table, source_column, mo_ta, owner_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (mapping_id, ten_bien, source_table, source_column, mo_ta, org_name))

        conn.commit()
        conn.close()
        return JSONResponse({"success": True, "id": mapping_id})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def delete_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        org_name = get_active_org(request, user_id)

        mapping_id = request.path_params.get('mapping_id')
        if not mapping_id:
            return JSONResponse({"error": "Missing mapping_id parameter"}, status_code=400)

        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ? AND owner_id = ?", (mapping_id, org_name))
        conn.commit()
        conn.close()
        return JSONResponse({"success": True})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
