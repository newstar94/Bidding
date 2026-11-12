"""Extracted BiddingFlow DOCX rendering pipeline (pure functions) for offline verification."""
import ast, re, os
from datetime import datetime
SRC = '/mnt/user-data/uploads/Bidding/backend/documents/custom_exporter.py'
WANT = {'number_to_vietnamese_words', 'enrich_context_with_lowercase_keys', 'enrich_context_with_words',
        'normalize_date_str', 'is_datetime_field_name', 'format_vietnamese_datetime', 'SmartDate',
        'format_context_dates', 'translate_xml_tags', 'replace_placeholders_with_empty',
        'format_context_money_values', 'DATETIME_FIELD_NAMES'}
MONEY_COLUMNS = {("ke_hoach_lcnt", "tong_muc_dau_tu"), ("ke_hoach_cong_viec", "gia_tri"), ("goi_thau", "gia_goi_thau"),
    ("goi_thau", "gia_trung_thau"), ("goi_thau", "gia_tri_dam_bao_du_thau"), ("goi_thau_phan_lo", "gia_tri_phan_lo"),
    ("goi_thau_phan_lo", "bao_dam_du_thau"), ("goi_thau_phan_lo", "gia_trung_thau"), ("hop_dong", "gia_tri"),
    ("thong_tin_mo_thau", "gia_du_thau"), ("thong_tin_mo_thau", "gia_sau_giam_gia"), ("thong_tin_mo_thau", "tong_gia_tri_cong_uu_dai"),
    ("thong_tin_mo_thau", "gia_so_sanh_sau_uu_dai"), ("thong_tin_mo_thau", "gia_danh_gia_sau_uu_dai"), ("thong_tin_mo_thau", "gia_tri_dam_bao"),
    ("ket_qua_danh_gia_nha_thau", "gia_xep_hang"), ("ket_qua_danh_gia_nha_thau", "gia_de_nghi_trung_thau"), ("goi_dich_vu", "gia_ca")}

class VietnameseFloat(float):
    def __str__(self):
        v = float(self)
        if v == int(v):
            return f"{int(v):,}".replace(',', '.')
        return f"{v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

def format_short_vietnamese_month(month):
    m = int(month); return f"{m:02d}" if m in {1, 2} else str(m)
def format_short_vietnamese_date(day, month, year):
    return f"{int(day):02d}/{format_short_vietnamese_month(month)}/{int(year):04d}"

ns = {'re': re, 'datetime': datetime, 'VietnameseFloat': VietnameseFloat,
      'format_short_vietnamese_date': format_short_vietnamese_date,
      'format_short_vietnamese_month': format_short_vietnamese_month,
      '_DOCX_MONEY_FIELD_NAMES': frozenset(c for _t, c in MONEY_COLUMNS),
      'DOCX_INTERNAL_EMPTY_LIST': 'docx_internal_empty_list',
      'DOCX_INTERNAL_EMPTY_VALUE': 'docx_internal_empty_value'}
tree = ast.parse(open(SRC, encoding='utf-8').read())
nodes = []
for n in tree.body:
    name = getattr(n, 'name', None)
    if isinstance(n, ast.Assign):
        name = n.targets[0].id if isinstance(n.targets[0], ast.Name) else None
    if name in WANT:
        nodes.append(n)
exec(compile(ast.Module(body=nodes, type_ignores=[]), SRC, 'exec'), ns)
globals().update({k: ns[k] for k in WANT})
COLUMN_LITERAL_CONTEXT = {"docx_column_literal_open_brace": "{", "docx_column_literal_close_brace": "}",
                          'docx_internal_empty_list': (), 'docx_internal_empty_value': ""}
