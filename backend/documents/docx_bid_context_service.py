"""Build bidder/result lists and lot summaries for Word contexts."""

import re

from backend.shared.helpers import VietnameseFloat

def _ensure_list(value):
    return value if isinstance(value, list) else []


def _as_text(value):
    return str(value or '').strip()


def _same_id(left, right):
    return _as_text(left) and _as_text(left) == _as_text(right)


def _normalize_vietnamese_text(value):
    import unicodedata
    text = _as_text(value).lower()
    text = unicodedata.normalize('NFD', text)
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return text.replace('đ', 'd')


def _is_rank_1(value):
    text = _normalize_vietnamese_text(value)
    return 'xep hang 1' in text or text in ('1', 'hang 1')


def _is_not_evaluated_bid(bid, pkg):
    conclusion = _normalize_vietnamese_text(bid.get('danh_gia_ket_luan'))
    if conclusion in ('khong danh gia', 'cho danh gia'):
        return True
    quy_trinh = _normalize_vietnamese_text(pkg.get('quy_trinh_danh_gia') if isinstance(pkg, dict) else '')
    if quy_trinh == 'quytrinh2':
        values = [
            bid.get('danh_gia_hop_le'),
            bid.get('danh_gia_nang_luc'),
            bid.get('danh_gia_ky_thuat'),
            bid.get('danh_gia_tai_chinh'),
            bid.get('danh_gia_ket_luan'),
        ]
        return not any(_as_text(value) for value in values)
    return False


def _is_unqualified_bid(bid):
    fields = (
        'danh_gia_hop_le',
        'danh_gia_nang_luc',
        'danh_gia_ky_thuat',
        'danh_gia_tai_chinh',
        'danh_gia_ket_luan',
    )
    return any('khong dat' in _normalize_vietnamese_text(bid.get(field)) for field in fields)


def _is_passed_bid(bid):
    conclusion = _normalize_vietnamese_text(bid.get('danh_gia_ket_luan'))
    if conclusion.startswith('dat'):
        return True
    if conclusion and ('khong dat' in conclusion or conclusion in ('khong danh gia', 'cho danh gia')):
        return False
    hop_le = _normalize_vietnamese_text(bid.get('danh_gia_hop_le'))
    nang_luc = _normalize_vietnamese_text(bid.get('danh_gia_nang_luc'))
    ky_thuat = _normalize_vietnamese_text(bid.get('danh_gia_ky_thuat'))
    return hop_le == 'dat' and nang_luc == 'dat' and ky_thuat not in ('', 'khong dat')


def _is_winning_bid(bid, pkg):
    winner_id = pkg.get('nha_thau_trung_thau_id') if isinstance(pkg, dict) else ''
    if winner_id and _same_id(bid.get('nha_thau_id'), winner_id):
        return True
    conclusion = _normalize_vietnamese_text(bid.get('danh_gia_ket_luan'))
    return conclusion in ('trung thau', 'de nghi trung thau')


def _bid_identity_key(bid):
    return (
        _as_text(bid.get('nha_thau_id'))
        or _as_text(bid.get('ma_nha_thau'))
        or _as_text(bid.get('ma_dinh_danh'))
        or _as_text(bid.get('ten_nha_thau'))
        or _as_text(bid.get('ten_nha_thau_mt'))
    ).lower()


def _dedupe_bids(bids):
    result = []
    seen = set()
    for bid in bids:
        key = _bid_identity_key(bid) or f'row-{len(result)}'
        if key in seen:
            continue
        seen.add(key)
        result.append(bid)
    return result


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


def _collect_lot_winner_keys(context):
    winner_keys = set()
    for lot in _ensure_list(context.get('ds_phan_lo_co_nha_thau_trung')):
        for bid in _ensure_list(lot.get('ds_nha_thau_trung_thau') if isinstance(lot, dict) else []):
            if isinstance(bid, dict):
                key = _bid_identity_key(bid)
                if key:
                    winner_keys.add(key)
    return winner_keys


def enrich_context_with_filtered_bidders(context):
    bids = [_bid_display_item(b) for b in _ensure_list(context.get('nha_thau')) if isinstance(b, dict)]
    pkg = context.get('goi_thau', {})
    lot_winner_keys = _collect_lot_winner_keys(context)

    winning_bids = []
    losing_bids = []
    unqualified_bids = []
    passed_not_rank_1_bids = []
    not_evaluated_bids = []

    for bid in bids:
        is_winner = _is_winning_bid(bid, pkg) or (_bid_identity_key(bid) in lot_winner_keys)
        if is_winner:
            winning_bids.append(bid)
        else:
            losing_bids.append(bid)

        if _is_not_evaluated_bid(bid, pkg):
            not_evaluated_bids.append(bid)
        elif _is_unqualified_bid(bid):
            unqualified_bids.append(bid)
        elif _is_passed_bid(bid) and not _is_rank_1(bid.get('danh_gia_tai_chinh')) and not is_winner:
            passed_not_rank_1_bids.append(bid)

    winning_bids = [_strip_private_keys(bid) for bid in _dedupe_bids(winning_bids)]
    losing_bids = [_strip_private_keys(bid) for bid in _dedupe_bids(losing_bids)]
    unqualified_bids = [_strip_private_keys(bid) for bid in _dedupe_bids(unqualified_bids)]
    passed_not_rank_1_bids = [_strip_private_keys(bid) for bid in _dedupe_bids(passed_not_rank_1_bids)]
    not_evaluated_bids = [_strip_private_keys(bid) for bid in _dedupe_bids(not_evaluated_bids)]
    all_bids = [_strip_private_keys(bid) for bid in bids]

    context['nha_thau'] = all_bids
    context['ds_nha_thau_tham_du'] = all_bids
    context['ds_nha_thau_trung_thau'] = winning_bids
    context['ds_nha_thau_truot_thau'] = losing_bids
    context['ds_nha_thau_khong_dat'] = unqualified_bids
    context['ds_nha_thau_dat_khong_xep_hang_1'] = passed_not_rank_1_bids
    context['ds_nha_thau_khong_duoc_danh_gia'] = not_evaluated_bids
    context['tong_so_nha_thau_tham_du'] = len(all_bids)
    context['so_nha_thau_trung_thau'] = len(winning_bids)
    context['so_nha_thau_truot_thau'] = len(losing_bids)
    context['so_nha_thau_khong_dat'] = len(unqualified_bids)
    context['so_nha_thau_dat_khong_xep_hang_1'] = len(passed_not_rank_1_bids)
    context['so_nha_thau_khong_duoc_danh_gia'] = len(not_evaluated_bids)


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
        context['ds_phan_lo_co_nha_thau_tham_du_khong_trung'] = []
        context['ds_nha_thau_trung_theo_phan_lo'] = []
        context['tong_so_phan_lo'] = 0
        context['so_phan_lo_co_nha_thau_tham_du'] = 0
        context['so_phan_lo_khong_co_nha_thau_tham_du'] = 0
        context['so_phan_lo_co_nha_thau_trung'] = 0
        context['so_phan_lo_tham_du_khong_trung'] = 0
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
        lot_item['ds_nha_thau_tham_du'] = [_strip_private_keys(bid) for bid in participants]
        lot_item['ds_nha_thau_trung_thau'] = [winner_display_item] if winner_display_item else []
        lot_item['ds_nha_thau_truot_thau'] = [_strip_private_keys(bid) for bid in failed_bidders]
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
    context['ds_phan_lo_co_nha_thau_tham_du_khong_trung'] = lots_participated_without_winner
    context['ds_nha_thau_trung_theo_phan_lo'] = winner_summary
    context['tong_so_phan_lo'] = len(all_lots)
    context['so_phan_lo_co_nha_thau_tham_du'] = len(lots_with_participants)
    context['so_phan_lo_khong_co_nha_thau_tham_du'] = len(lots_without_participants)
    context['so_phan_lo_co_nha_thau_trung'] = len(lots_with_winner)
    context['so_phan_lo_tham_du_khong_trung'] = len(lots_participated_without_winner)




