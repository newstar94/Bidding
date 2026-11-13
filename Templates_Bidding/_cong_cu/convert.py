# -*- coding: utf-8 -*-
"""Convert ND30 templates ([[...]] placeholders) into BiddingFlow Word templates."""
import copy
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict

from lxml import etree

from mapping import *  # noqa
from mapping import _total

HERE = os.path.dirname(os.path.abspath(__file__))

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}


def q(tag):
    return '{%s}%s' % (W, tag)


PH_RE = re.compile(r'\[\[(.*?)\]\]')
REPORT = defaultdict(Counter)        # placeholder -> Counter(replacement kind)
UNMAPPED_SEEN = defaultdict(set)      # placeholder -> set(files)
SAMPLES = defaultdict(Counter)        # placeholder -> Counter(replacement text)
FILES = defaultdict(set)              # placeholder -> files
ISSUES = []


# ------------------------------------------------------------------ xml helpers
def owner_p(el):
    e = el.getparent()
    while e is not None and e.tag != q('p'):
        e = e.getparent()
    return e


def atoms(p):
    return [t for t in p.iter(q('t')) if owner_p(t) is p and not in_deleted(t)]


def in_deleted(t):
    e = t.getparent()
    while e is not None and e.tag != q('p'):
        if e.tag in (q('del'), q('moveFrom')):
            return True
        e = e.getparent()
    return False


def ptext(p):
    return ''.join(t.text or '' for t in atoms(p))


def set_text(t, text):
    t.text = text
    if text != text.strip() or '  ' in text:
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')


def split_run(t, off):
    """Split the run containing w:t `t` so that t.text[:off] stays and the rest
    moves to a new run inserted right after. Returns the new w:t."""
    r = t.getparent()
    assert r.tag == q('r'), r.tag
    r2 = copy.deepcopy(r)
    kids = [c for c in r if c.tag != q('rPr')]
    kids2 = [c for c in r2 if c.tag != q('rPr')]
    j = kids.index(t)
    # original run keeps children up to t (with truncated text)
    for c in kids[j + 1:]:
        r.remove(c)
    # new run keeps t (rest of text) and following children
    for c in kids2[:j]:
        r2.remove(c)
    t2 = kids2[j]
    txt = t.text or ''
    set_text(t, txt[:off])
    set_text(t2, txt[off:])
    r.addnext(r2)
    return t2


def isolate(p, s, e):
    """Make [s,e) of the paragraph text consist of whole w:t elements; return them."""
    def locate():
        pos = 0
        out = []
        for t in atoms(p):
            n = len(t.text or '')
            out.append((pos, pos + n, t))
            pos += n
        return out

    # split at s
    for a, b, t in locate():
        if a < s < b:
            split_run(t, s - a)
            break
    for a, b, t in locate():
        if a < e < b:
            split_run(t, e - a)
            break
    return [t for a, b, t in locate() if a >= s and b <= e and b > a]


def drop_empty_run(t):
    r = t.getparent()
    t.getparent().remove(t)
    if r.tag == q('r') and not [c for c in r if c.tag != q('rPr')]:
        r.getparent().remove(r)


def style_run(r, caps=False, uncolor=True):
    rpr = r.find(q('rPr'))
    if rpr is None:
        rpr = etree.SubElement(r, q('rPr'))
        r.remove(rpr)
        r.insert(0, rpr)
    if uncolor:
        c = rpr.find(q('color'))
        if c is not None and (c.get(q('val')) or '').upper() in ('FF0000', 'EE0000', 'C00000', 'FF0000'):
            rpr.remove(c)
    if caps and rpr.find(q('caps')) is None:
        el = etree.Element(q('caps'))
        # keep schema order roughly: insert after b/i/... ; simplest: before color/sz
        order = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps']
        idx = 0
        for i, ch in enumerate(rpr):
            name = etree.QName(ch).localname
            if name in order:
                idx = i + 1
        rpr.insert(idx, el)


def replace_range(p, s, e, text, caps=False, mapped=True):
    ts = isolate(p, s, e)
    if not ts:
        return
    first = ts[0]
    set_text(first, text)
    for t in ts[1:]:
        drop_empty_run(t)
    if mapped:
        style_run(first.getparent(), caps=caps)
    elif caps:
        pass


def new_run_like(ref_run, text):
    r = etree.Element(q('r'))
    if ref_run is not None and ref_run.find(q('rPr')) is not None:
        r.append(copy.deepcopy(ref_run.find(q('rPr'))))
        rpr = r.find(q('rPr'))
        for tag in ('color', 'caps', 'vanish'):
            el = rpr.find(q(tag))
            if el is not None:
                rpr.remove(el)
    t = etree.SubElement(r, q('t'))
    set_text(t, text)
    return r


def prepend_text(p, text):
    runs = [r for r in p if r.tag == q('r')]
    ref = runs[0] if runs else None
    r = new_run_like(ref, text)
    ppr = p.find(q('pPr'))
    if ppr is not None:
        ppr.addnext(r)
    else:
        p.insert(0, r)


def append_text(p, text):
    runs = [r for r in p.iter(q('r')) if owner_p(r) is p]
    ref = runs[-1] if runs else None
    r = new_run_like(ref, text)
    p.append(r)


# ------------------------------------------------------------------ expressions
def nat(expr):
    return '{{ %s|default(\'\', true) }}' % expr


def short_path(path):
    head, _, last = path.rpartition('.')
    return (head + '.' if head else '') + 'S_' + last


def wants_short(prev_text):
    return bool(re.search(r'ngày\s*$', prev_text, re.I))


class Ctx:
    def __init__(self, folder):
        self.folder = folder
        self.plan = folder in PLAN_FOLDERS
        self.kqcd = folder in KQCD_FOLDERS
        self.lot = folder in LOT_FOLDERS


def root_spec(name, ctx):
    if (ctx.folder, name) in FOLDER_ROOT:
        return FOLDER_ROOT[(ctx.folder, name)]
    if name == 'Nguồn vốn' or (name == 'Nguồn vốn KHLCNT' and not ctx.plan):
        return ('kh_nguon_von', KH + 'nguon_von', 'text') if ctx.plan else ('gt_nguon_von', GT + 'nguon_von', 'text')
    if name in ROOT:
        return ROOT[name]
    if name in PKG and not ctx.plan and PKG[name][1]:
        return ROOT[PKG[name][1]]
    return None


def root_expr(spec, prev, native, force_short=False):
    alias, path, fmt = spec
    short = fmt in ('date', 'datetime', 'textdate') and (force_short or wants_short(prev))
    if short:
        if native or fmt == 'textdate':
            return nat(short_path(path)), 'root-native'
        return '{S_%s}' % alias, 'root'
    if native:
        return nat(path), 'root-native'
    return '{%s}' % alias, 'root'


def item_value(var, key, prev, native):
    """Expression of an item field. native=True -> {{ var.key }} else app {key}."""
    if key in DATE_ITEM_KEYS and wants_short(prev):
        return nat('%s.S_%s' % (var, key))
    if native:
        return nat('%s.%s' % (var, key))
    return '{%s}' % key


def contract_expr(kind, key, prev):
    if key in DATE_ITEM_KEYS and wants_short(prev):
        key = 'S_' + key
    return ("{%% for hd in hop_dong_list if hd.phan_loai|lower|trim == '%s' %%}%s{%% endfor %%}"
            % (kind, nat('hd.' + key)))


def leader_expr(leader, key, prev):
    if key in DATE_ITEM_KEYS and wants_short(prev):
        key = 'S_' + key
    op = '==' if leader else '!='
    return ("{%% for cg in to_chuyen_gia if cg.chuc_vu|trim %s 'Tổ trưởng' %%}%s{%% endfor %%}"
            % (op, nat('cg.' + key)))


def base_name(name):
    return CAPS.get(name, name)


# ------------------------------------------------------------------ classification
def item_of(name, ctx, group_hint=None):
    """Return (group, key) if `name` is a list-item placeholder in this folder."""
    if name in TCG_ITEMS:
        return 'TCG', TCG_ITEMS[name]
    if name in TTD_ITEMS:
        return 'TTD', TTD_ITEMS[name]
    if ctx.plan:
        if name in CVDTH_ITEMS:
            return 'CVDTH', CVDTH_ITEMS[name]
        if name in CVKAD_ITEMS:
            return 'CVKAD', CVKAD_ITEMS[name]
        if name in PKG:
            return 'PKG', PKG[name][0]
        return None
    if ctx.kqcd:
        return None
    if group_hint == 'LOTWIN' and name in LOTWIN_ITEMS:
        return 'LOTWIN', LOTWIN_ITEMS[name]
    if group_hint == 'WINLOT' and name in WINLOT_ITEMS:
        return 'WINLOT', WINLOT_ITEMS[name]
    if group_hint == 'LOT' and name in LOT_ITEMS:
        return 'LOT', LOT_ITEMS[name]
    if name in BID_ITEMS:
        return 'BID', BID_ITEMS[name]
    return None


def row_list(names, ctx):
    """Decide (group, list_alias) for a table row, or None."""
    s = set(names)
    if ctx.plan:
        if s & set(CVDTH_ITEMS):
            return 'CVDTH', GROUPS['CVDTH'][0]
        if s & set(CVKAD_ITEMS):
            return 'CVKAD', GROUPS['CVKAD'][0]
        if s & set(PKG):
            return 'PKG', GROUPS['PKG'][0]
        return None
    if s & set(TCG_ITEMS):
        return 'TCG', GROUPS['TCG'][0]
    if s & set(TTD_ITEMS):
        return 'TTD', GROUPS['TTD'][0]
    if ctx.kqcd:
        return None
    if ctx.lot:
        if 'Nhà thầu đối chiếu' in s and 'Tên phần lô' in s:
            return 'LOTWIN', GROUPS['LOTWIN'][0]
        if 'Số phần xếp hạng 1' in s and 'Nhà thầu xếp hạng 1' in s:
            return 'WINLOT', GROUPS['WINLOT'][0]
        if not (s & set(BID_DRIVERS)) and 'Tên phần lô' in s:
            return 'LOT', GROUPS['LOT'][0]
    filt = [n for n in names if n in REASON_FIELDS or n in LAMRO_FIELDS]
    if filt:
        return 'BIDF', BID_ITEMS[filt[0]]
    if s & set(BID_ITEMS):
        for n in names:
            if n in BID_DRIVERS:
                return 'BID', BID_DRIVERS[n]
        return 'BID', 'ds_nt_trung'
    return None


# ------------------------------------------------------------------ main conversion
def convert_xml(root, folder, relname):
    ctx = Ctx(folder)
    paras = list(root.iter(q('p')))
    pidx = {id(p): i for i, p in enumerate(paras)}

    # ---- REPEAT scopes
    scope = {}  # paragraph index -> (group, native list, var)
    i = 0
    rep_marks = {}
    while i < len(paras):
        t = ptext(paras[i])
        m = re.search(r'\[\[REPEAT:\s*([^\]|]+)', t)
        if m:
            kind = m.group(1).strip()
            j = i + 1
            while j < len(paras) and '[[ENDREPEAT]]' not in ptext(paras[j]):
                j += 1
            if j >= len(paras):
                ISSUES.append('%s: REPEAT without ENDREPEAT' % relname)
                break
            if paras[i].getparent() is not paras[j].getparent():
                ISSUES.append('%s: REPEAT/ENDREPEAT in different containers' % relname)
            if kind == 'TCG':
                spec = ('TCG', 'to_chuyen_gia', 'cg')
            elif kind == 'TTĐ':
                spec = ('TTD', 'to_tham_dinh', 'td')
            elif kind.startswith('Dự thầu'):
                spec = ('BID', 'ds_nha_thau_trung_thau', 'nt')
            else:
                ISSUES.append('%s: unknown REPEAT %s' % (relname, kind))
                spec = None
            rep_marks[i] = ('start', spec)
            rep_marks[j] = ('end', spec)
            for k in range(i + 1, j):
                scope[k] = spec
            i = j + 1
            continue
        i += 1

    # ---- rows
    def nearest(el, tag):
        e = el.getparent()
        while e is not None and e.tag != tag:
            e = e.getparent()
        return e

    row_info = {}  # id(tr) -> (group, list)
    rows = list(root.iter(q('tr')))
    for tr in rows:
        rps = [p for p in tr.iter(q('p')) if nearest(p, q('tr')) is tr]
        names = []
        for p in rps:
            if pidx[id(p)] in scope:
                continue
            names += [base_name(m.group(1)) for m in PH_RE.finditer(ptext(p))]
        if not names:
            continue
        cells = [c for c in tr if c.tag == q('tc')]
        first_txt = ''.join(ptext(p) for p in cells[0].iter(q('p'))).strip() if cells else ''
        cell_txts = [''.join(ptext(p) for p in c.iter(q('p'))).strip() for c in cells]
        if 'Họ và tên Tổ viên TV' in names and 'Tổ viên' in cell_txts:
            row_info[id(tr)] = ('DELETE', None)
            continue
        if 'Họ và tên Tổ trưởng TV' in names and 'Tổ trưởng' in cell_txts:
            row_info[id(tr)] = ('TCG', GROUPS['TCG'][0], 'LEADROW')
            continue
        if set(names) & set(LEADER):
            continue
        decision = row_list(names, ctx)
        if decision and decision[0] != 'BIDF':
            g = decision[0]
            items = [n for n in names if (item_of(n, ctx, group_hint=g) or (None,))[0] == g]
            drivers = [n for n in items if n in BID_DRIVERS or n in ('Họ và tên TVL', 'Họ và tên TVT', 'Tên gói thầu KHLCNT',
                                                                     'Đã thực hiện', 'Không áp dụng', 'Tên phần lô')]
            if len(items) < 2 and not drivers:
                decision = None
        if decision and re.match(r'(?i)t[ổo]ng', first_txt):
            ISSUES.append('%s: total row kept without loop: %s' % (relname, first_txt[:40]))
            row_info[id(tr)] = ('TOTAL', None)
            continue
        if decision:
            tbl = tr.getparent()
            if nearest(tbl, q('tc')) is not None:
                ISSUES.append('%s: loop row in nested table (%s)' % (relname, decision[1]))
            row_info[id(tr)] = decision

    # ---- per paragraph replacements
    for p in paras:
        text = ptext(p)
        matches = list(PH_RE.finditer(text))
        if not matches:
            continue
        pi = pidx[id(p)]
        sc = scope.get(pi)
        tr = nearest(p, q('tr'))
        rinfo = row_info.get(id(tr)) if tr is not None else None
        plan = []  # (s, e, text, caps, mapped)

        # inline grouping for paragraph-level list fields
        inline = []
        for m in matches:
            raw = m.group(1)
            name = base_name(raw)
            caps = raw in CAPS
            prev = text[:m.start()]
            mark = rep_marks.get(pi)
            if raw.startswith('REPEAT'):
                spec = mark[1] if mark else None
                if spec:
                    plan.append((m.start(), m.end(), '{%% for %s in %s %%}' % (spec[2], spec[1]), False, True))
                    REPORT[raw]['loop ' + spec[1]] += 1
                else:
                    UNMAPPED_SEEN[raw].add(relname)
                continue
            if raw == 'ENDREPEAT':
                plan.append((m.start(), m.end(), '{% endfor %}', False, True))
                REPORT[raw]['endfor'] += 1
                continue
            res = resolve(name, raw, prev, ctx, sc, rinfo, relname)
            if res is None:
                UNMAPPED_SEEN[raw].add(relname)
                REPORT[raw]['unmapped'] += 1
                continue
            kind, out = res
            if kind == 'inline':
                inline.append((m, out, caps))
                continue
            REPORT[raw][kind] += 1
            plan.append((m.start(), m.end(), out, caps, True))

        # build inline loops: contiguous same-list spans
        if inline:
            spans = []
            for m, (lst, key, _native), caps in inline:
                if spans and spans[-1]['list'] == lst:
                    spans[-1]['items'].append((m, key, caps))
                else:
                    spans.append({'list': lst, 'items': [(m, key, caps)]})
            for sp in spans:
                items = sp['items']
                for k, (m, key, caps) in enumerate(items):
                    out = key
                    if k == 0:
                        out = '{#%s}' % sp['list'] + out
                    if k == len(items) - 1:
                        out = out + '{/%s}' % sp['list']
                    plan.append((m.start(), m.end(), out, caps, True))
                    REPORT[m.group(1)]['inline ' + sp['list']] += 1
                # root placeholders inside the span must use native paths
                s0, e0 = items[0][0].start(), items[-1][0].end()
                for idx, (s, e, out, caps, mapped) in enumerate(plan):
                    if s0 < s < e0 and out.startswith('{') and not out.startswith('{{') and not out.startswith('{%') and not out.startswith('{#'):
                        name = base_name(text[s + 2:e - 2])
                        spec = root_spec(name, ctx)
                        if spec:
                            nout, _ = root_expr(spec, text[:s], True, name in FORCE_SHORT)
                            plan[idx] = (s, e, nout, caps, mapped)

        for m in matches:
            FILES[m.group(1)].add(relname)
        for s, e, out, caps, _mapped in plan:
            SAMPLES[text[s + 2:e - 2]][out + (' [IN HOA]' if caps else '')] += 1
        for s, e, out, caps, mapped in sorted(plan, key=lambda x: -x[0]):
            replace_range(p, s, e, out, caps=caps, mapped=mapped)

    # ---- row loop tags
    for tr in rows:
        info = row_info.get(id(tr))
        if not info or info[0] == 'TOTAL':
            continue
        if info[0] == 'DELETE':
            tr.getparent().remove(tr)
            continue
        group, lst = info[0], info[1]
        if len(info) > 2 and info[2] == 'LEADROW':
            # static role text -> {chuc_vu}
            for p in tr.iter(q('p')):
                tx = ptext(p)
                mm = re.search(r'Tổ trưởng', tx)
                if mm and '{' not in tx:
                    replace_range(p, mm.start(), mm.end(), '{chuc_vu}', mapped=True)
        cells = [c for c in tr if c.tag == q('tc')]
        first_ps = [p for p in cells[0] if p.tag == q('p')] or [p for p in cells[0].iter(q('p'))]
        last_ps = [p for p in cells[-1] if p.tag == q('p')] or [p for p in cells[-1].iter(q('p'))]
        fp, lp = first_ps[0], last_ps[-1]
        # STT column
        ftxt = ''.join(ptext(p) for p in cells[0].iter(q('p'))).strip()
        hdr = ''
        prev_tr = tr.getprevious()
        for _ in range(3):
            if prev_tr is None or prev_tr.tag != q('tr'):
                break
            pc = [c for c in prev_tr if c.tag == q('tc')]
            h = ''.join(ptext(p) for p in pc[0].iter(q('p'))).strip().upper() if pc else ''
            if h in ('STT', 'TT'):
                hdr = h
                break
            prev_tr = prev_tr.getprevious()
        c1 = ''.join(ptext(p) for p in cells[1].iter(q('p'))) if len(cells) > 1 else ''
        has_name = bool(re.search(r'\{[^%]', c1))
        if len(cells) > 1 and has_name and (re.fullmatch(r'0?1', ftxt) or (ftxt == '' and hdr in ('STT', 'TT'))):
            if ftxt:
                for p in cells[0].iter(q('p')):
                    tx = ptext(p)
                    mm = re.search(r'0?\d', tx)
                    if mm:
                        replace_range(p, mm.start(), mm.end(), '{{ loop.index }}', mapped=True)
                        break
            else:
                append_text(fp, '{{ loop.index }}')
        if group == 'BIDF':
            prepend_text(fp, '{%%tr for nt in ds_nha_thau_tham_du if nt.%s %%}' % lst)
            append_text(lp, '{%tr endfor %}')
        else:
            prepend_text(fp, '{#%s}' % lst)
            append_text(lp, '{/%s}' % lst)

    # ---- bookmarks inside repeated regions would be duplicated -> drop them
    loop_trs = {k for k, v in row_info.items() if v and v[0] not in ('TOTAL', 'DELETE')}
    drop_ids = set()
    for bs in list(root.iter(q('bookmarkStart'))):
        repeated = False
        e = bs.getparent()
        while e is not None:
            if e.tag == q('tr') and id(e) in loop_trs:
                repeated = True
                break
            if e.tag == q('p') and (pidx.get(id(e)) in scope or re.search(r'\{#|\{%', ptext(e))):
                repeated = True
                break
            e = e.getparent()
        if not repeated and bs.getparent().tag != q('p'):
            nxt = bs.getnext()
            if nxt is not None and nxt.tag == q('p') and pidx.get(id(nxt)) in scope:
                repeated = True
        if repeated:
            drop_ids.add(bs.get(q('id')))
    if drop_ids:
        for el in list(root.iter(q('bookmarkStart'), q('bookmarkEnd'))):
            if el.get(q('id')) in drop_ids:
                el.getparent().remove(el)
    return ctx


def resolve(name, raw, prev, ctx, sc, rinfo, relname):
    """Return (kind, replacement) or ('inline', (list, key_expr, ...)) or None."""
    force = name in FORCE_SHORT
    if force:
        name = FORCE_SHORT[name]
    # year
    if name in YEAR:
        return 'year', YEAR_EXPR
    if name in LOOP_INDEX:
        if sc or (rinfo and rinfo[0] != 'TOTAL'):
            return 'loop.index', '{{ loop.index }}'
        return None
    if name in CONTRACT:
        kind, key = CONTRACT[name]
        return 'contract', contract_expr(kind, key, prev)
    if name in LEADER:
        leader, key = LEADER[name]
        if rinfo and len(rinfo) > 2 and rinfo[2] == 'LEADROW':
            return 'row-item', '{%s}' % key
        return 'leader', leader_expr(leader, key, prev)
    if name in INFER_PKG:
        if rinfo and rinfo[0] == 'PKG':
            return 'infer', INFER_PKG[name]
        return None
    if name in INFER_PREV:
        return 'infer', INFER_PREV[name](prev)
    if name in INFER:
        return 'infer', INFER[name](wants_short(prev))
    total_of = {'Giá trị đã thực hiện': ('ke_hoach.cv_da_thuc_hien', 'gia_tri', 'Giá trị đã thực hiện tổng'),
                'Giá không áp dụng': ('ke_hoach.cv_khong_ap_dung', 'gia_tri', 'Giá không áp dụng tổng'),
                'Giá gói thầu KHLCNT': ('goi_thau_trong_ke_hoach', 'gia_goi_thau', 'Giá tổng gói thầu')}
    if ctx.plan and name in total_of:
        is_total_row = bool(rinfo and rinfo[0] == 'TOTAL')
        in_loop = bool(rinfo and rinfo[0] not in ('TOTAL', 'DELETE'))
        if is_total_row or (not in_loop and not sc and name != 'Giá gói thầu KHLCNT'):
            lst, fld, marker = total_of[name]
            return 'infer', _total(lst, fld, marker)
    if name in UNMAPPED:
        return None

    in_app_loop = bool(rinfo and rinfo[0] not in ('TOTAL', 'DELETE'))

    # REPEAT scope (native loop var)
    if sc:
        g, nroot, var = sc
        it = item_of(name, ctx)
        if it and it[0] == g:
            return 'repeat-item', item_value(var, it[1], prev, True)
        if g == 'BID' and name in BID_ITEMS:
            return 'repeat-item', item_value(var, BID_ITEMS[name], prev, True)

    # KQCĐ: contractor single values
    if ctx.kqcd and name in NT_ROOT:
        alias, fmt = NT_ROOT[name]
        return 'root', '{%s}' % alias

    # inside app row loop
    if in_app_loop:
        g, lst = rinfo[0], rinfo[1]
        if g == 'BIDF' and name in BID_ITEMS:
            return 'row-item', nat('nt.' + BID_ITEMS[name])
        if g == 'BID' and name in BID_ROW_ROOT:
            return 'root-native', root_expr(BID_ROW_ROOT[name], prev, True)[0]
        it = item_of(name, ctx, group_hint=g)
        if it and it[0] == g:
            key = it[1]
            if key in DATE_ITEM_KEYS and wants_short(prev):
                return 'row-item', nat('item.S_' + key)
            return 'row-item', '{%s}' % key
        spec = root_spec(name, ctx)
        if spec:
            return 'root-native', root_expr(spec, prev, True, force)[0]
        if it:  # list item of another group inside a row loop -> inline loop
            pass
        else:
            return None

    # root
    spec = root_spec(name, ctx)
    if spec:
        out, kind = root_expr(spec, prev, False, force)
        return kind, out

    # paragraph-level list item -> inline loop
    it = item_of(name, ctx)
    if it and rinfo and rinfo[0] == 'TOTAL':
        return None  # a total cell: BiddingFlow has no sum field
    if it and it[0] in ('CVDTH', 'CVKAD') and it[1] == 'gia_tri':
        return None  # paragraph-level value = total of the list
    if it:
        g, key = it
        if g == 'BID':
            if name in REASON_FIELDS:
                lst = 'ds_nt_khong_dat'
            elif name in BID_DRIVERS and BID_DRIVERS[name] != 'ds_nt_tham_du':
                lst = BID_DRIVERS[name]
            else:
                lst = 'ds_nt_trung'
        else:
            lst = GROUPS[g][0]
        if key in DATE_ITEM_KEYS and wants_short(prev):
            kexpr = nat('item.S_' + key)
        else:
            kexpr = '{%s}' % key
        return 'inline', (lst, kexpr, None)
    if name in BID_ROW_ROOT:
        out, kind = root_expr(BID_ROW_ROOT[name], prev, False)
        return kind, out
    return None


def convert_file(src, dst, folder, relname):
    zin = zipfile.ZipFile(src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'word/document.xml':
                root = etree.fromstring(data)
                convert_xml(root, folder, relname)
                data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
            zout.writestr(item, data)
    os.replace(tmp, dst)


if __name__ == '__main__':
    src_root, dst_root = sys.argv[1], sys.argv[2]
    n = 0
    for dp, _dirs, fn in os.walk(src_root):
        for f in sorted(fn):
            if not f.endswith('.docx'):
                continue
            rel = os.path.relpath(os.path.join(dp, f), src_root)
            folder = rel.split(os.sep)[0]
            convert_file(os.path.join(dp, f), os.path.join(dst_root, rel), folder, rel)
            n += 1
    with open(os.path.join(HERE, 'convert_report.json'), 'w', encoding='utf-8') as fh:
        json.dump({'report': {k: dict(v) for k, v in REPORT.items()},
                   'unmapped': {k: sorted(v) for k, v in UNMAPPED_SEEN.items()},
                   'issues': ISSUES,
                   'samples': {k: dict(v) for k, v in SAMPLES.items()},
                   'files': {k: sorted(v) for k, v in FILES.items()}}, fh,
                  ensure_ascii=False, indent=1)
    print('converted', n, 'issues', len(ISSUES))
    for i in ISSUES:
        print(' -', i)
