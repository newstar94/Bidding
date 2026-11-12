"""Word scalar variables projected from the effective package timeline.

ADR 0042: every non-repeatable milestone of ``shared/timeline_rules.json``
gets one document-number and one document-date context key.  Values come from
the same effective-timeline evaluator used by the Tiến độ tab, so manual rows,
automatically sourced rows and applicability rules stay identical.  This module
is pure: it only knows the catalog and how to project evaluated rows.
"""

from __future__ import annotations

from backend.timeline.effective_timeline import CATALOG, SECTION_BY_KEY


CONTEXT_NUMBER_PREFIX = "moc_so_"
CONTEXT_DATE_PREFIX = "moc_ngay_"
VARIABLE_NUMBER_PREFIX = "so_"
VARIABLE_DATE_PREFIX = "ngay_"
PLAN_SECTION_KEY = "PLAN_AND_ESTIMATE"

# Stable, human-readable Word slugs.  Keys are catalog ``milestoneKey`` values;
# changing a slug renames a published Word variable, so treat them as API.
# Variables are ``so_<slug>`` and ``ngay_<slug>``; slugs must not recreate an
# existing default name (``so_qd_hsmt``, ``so_qd_kq``... belong to package
# fields), hence the ``pd`` in the three approval/submission slugs below.
MILESTONE_WORD_SLUGS = {
    "VALUATION_EVIDENCE": "chung_thu_tdg",
    "PLAN_TEAM_ESTABLISHMENT": "qd_tl_to",
    "COST_ESTIMATE_SUBMISSION": "ttr_dt",
    "COST_ESTIMATE_APPROVAL": "qd_dt",
    "PLAN_SUBMISSION": "ttr_kh",
    "PLAN_APPROVAL": "qd_kh",
    "COMBINED_COST_PLAN_SUBMISSION": "ttr_dt_kh",
    "COMBINED_COST_PLAN_APPROVAL": "qd_dt_kh",
    "PREPARATION_CONSULTANT_INVITATION": "thu_moi_tvl",
    "PREPARATION_CONSULTANT_APPLICATION": "don_xin_tvl",
    "PREPARATION_CONSULTANT_CONTRACT_FINALIZATION": "bbht_tvl",
    "PREPARATION_CONSULTANT_APPOINTMENT_SUBMISSION": "ttr_chi_dinh_tvl",
    "PREPARATION_CONSULTANT_APPOINTMENT": "qd_chi_dinh_tvl",
    "PREPARATION_CONSULTANT_CONTRACT": "hd_tvl",
    "EXPERT_TEAM_ESTABLISHMENT": "qd_tl_tcg",
    "E_HSMT_ACCEPTANCE": "bbnt_hsmt",
    "EVALUATION_REPORT_ACCEPTANCE": "bbnt_bcdg",
    "PREPARATION_CONSULTANT_COMPLETION_VOLUME": "kl_ht_tvl",
    "PREPARATION_CONSULTANT_PAYMENT_REQUEST": "de_nghi_tt_tvl",
    "PREPARATION_CONSULTANT_LIQUIDATION": "thanh_ly_tvl",
    "APPRAISAL_CONSULTANT_INVITATION": "thu_moi_tvt",
    "APPRAISAL_CONSULTANT_APPLICATION": "don_xin_tvt",
    "APPRAISAL_CONSULTANT_CONTRACT_FINALIZATION": "bbht_tvt",
    "APPRAISAL_CONSULTANT_APPOINTMENT_SUBMISSION": "ttr_chi_dinh_tvt",
    "APPRAISAL_CONSULTANT_APPOINTMENT": "qd_chi_dinh_tvt",
    "APPRAISAL_CONSULTANT_CONTRACT": "hd_tvt",
    "APPRAISAL_TEAM_ESTABLISHMENT": "qd_tl_ttd",
    "E_HSMT_APPRAISAL_ACCEPTANCE": "bbnt_bctd_hsmt",
    "RESULT_APPRAISAL_ACCEPTANCE": "bbnt_bctd_kq",
    "APPRAISAL_CONSULTANT_COMPLETION_VOLUME": "kl_ht_tvt",
    "APPRAISAL_CONSULTANT_PAYMENT_REQUEST": "de_nghi_tt_tvt",
    "APPRAISAL_CONSULTANT_LIQUIDATION": "thanh_ly_tvt",
    "E_HSMT_SUBMISSION": "ttr_pd_hsmt",
    "E_HSMT_APPRAISAL_REPORT": "bctd_hsmt",
    "E_HSMT_APPROVAL": "qd_pd_hsmt",
    "BID_OPENING_MINUTES": "bb_mo_thau",
    "BID_EVALUATION_REPORT": "bcdg",
    "TECHNICAL_RESULT_APPRAISAL": "bctd_kt",
    "TECHNICAL_QUALIFIED_APPROVAL": "qd_kt",
    "FINANCIAL_OPENING_MINUTES": "bb_mo_tc",
    "FINANCIAL_EVALUATION_REPORT": "bcdg_tc",
    "DOCUMENT_RECONCILIATION_INVITATION": "thu_moi_dc",
    "DOCUMENT_RECONCILIATION_MINUTES": "bbdc",
    "CONTRACT_NEGOTIATION": "bb_thuong_thao",
    "CONTRACTOR_SELECTION_RESULT_APPRAISAL": "bctd_kq",
    "CONTRACTOR_SELECTION_RESULT_APPROVAL": "qd_pd_kq",
    "CONTRACT_AWARD_NOTICE": "thu_chap_thuan",
    "CONTRACT_FINALIZATION_MINUTES": "bbht_hd",
}

_SECTION_LABELS = {
    "PLAN_AND_ESTIMATE": "KHLCNT + dự toán",
    "PREPARATION_CONSULTANT": "Tư vấn lập",
    "APPRAISAL_CONSULTANT": "Tư vấn thẩm",
    "E_HSMT": "E-HSMT",
    "SELECTION_RESULT": "Kết quả LCNT",
}

_DEFINITIONS = {item["milestoneKey"]: item for item in CATALOG["milestones"]}


def _validate_catalog():
    singles = {
        key for key, item in _DEFINITIONS.items() if not item.get("repeatable")
    }
    if set(MILESTONE_WORD_SLUGS) != singles:
        missing = sorted(singles - set(MILESTONE_WORD_SLUGS))
        unknown = sorted(set(MILESTONE_WORD_SLUGS) - singles)
        raise RuntimeError(
            f"Timeline Word slugs out of sync: missing={missing} unknown={unknown}"
        )
    if len(set(MILESTONE_WORD_SLUGS.values())) != len(MILESTONE_WORD_SLUGS):
        raise RuntimeError("Timeline Word slugs must be unique.")


_validate_catalog()


def number_context_key(milestone_key):
    return f"{CONTEXT_NUMBER_PREFIX}{MILESTONE_WORD_SLUGS[milestone_key]}"


def date_context_key(milestone_key):
    return f"{CONTEXT_DATE_PREFIX}{MILESTONE_WORD_SLUGS[milestone_key]}"


def _title(milestone_key):
    definition = _DEFINITIONS[milestone_key]
    title = " ".join(str(definition.get("title") or milestone_key).split())
    section = _SECTION_LABELS.get(
        definition["sectionKey"],
        SECTION_BY_KEY[definition["sectionKey"]]["title"],
    )
    return f"{title} ({section})"


def _ordered_milestone_keys():
    return [
        item["milestoneKey"]
        for item in CATALOG["milestones"]
        if item["milestoneKey"] in MILESTONE_WORD_SLUGS
    ]


TIMELINE_MILESTONE_KEYS = tuple(_ordered_milestone_keys())
PLAN_SECTION_MILESTONE_KEYS = frozenset(
    key for key in TIMELINE_MILESTONE_KEYS
    if _DEFINITIONS[key]["sectionKey"] == PLAN_SECTION_KEY
)
TIMELINE_NUMBER_CONTEXT_KEYS = frozenset(
    number_context_key(key) for key in TIMELINE_MILESTONE_KEYS
)
TIMELINE_DATE_CONTEXT_KEYS = frozenset(
    date_context_key(key) for key in TIMELINE_MILESTONE_KEYS
)
TIMELINE_CONTEXT_KEYS = TIMELINE_NUMBER_CONTEXT_KEYS | TIMELINE_DATE_CONTEXT_KEYS

TIMELINE_CONTEXT_LABELS = {}
TIMELINE_WORD_CONTEXT_MAPPINGS = []
for _key in TIMELINE_MILESTONE_KEYS:
    _slug = MILESTONE_WORD_SLUGS[_key]
    _number_label = f"Tiến độ – Số văn bản: {_title(_key)}"
    _date_label = f"Tiến độ – Ngày: {_title(_key)}"
    TIMELINE_CONTEXT_LABELS[number_context_key(_key)] = _number_label
    TIMELINE_CONTEXT_LABELS[date_context_key(_key)] = _date_label
    TIMELINE_WORD_CONTEXT_MAPPINGS.append((
        f"{VARIABLE_NUMBER_PREFIX}{_slug}",
        number_context_key(_key),
        _number_label,
    ))
    TIMELINE_WORD_CONTEXT_MAPPINGS.append((
        f"{VARIABLE_DATE_PREFIX}{_slug}",
        date_context_key(_key),
        f"{_date_label}; ngày thực tế, chưa có thì lấy ngày dự kiến",
    ))
del _key, _slug, _number_label, _date_label


def _row_value(row):
    number = str(row.get("so_van_ban") or "").strip()
    date = str(row.get("ngay_thuc_te") or row.get("ngay_du_kien") or "").strip()
    return number, date


def milestone_values_from_rows(rows, milestone_keys=None):
    """Return ``{milestone_key: (number, date)}`` for applicable rows.

    Only rows the official timeline export would print are used: applicable,
    non-repeatable catalog milestones.  Dates are ISO ``YYYY-MM-DD`` strings;
    the actual date wins over the planned date.
    """

    allowed = set(TIMELINE_MILESTONE_KEYS if milestone_keys is None else milestone_keys)
    values = {}
    for row in rows or ():
        key = row.get("milestone_key")
        if (
            key not in allowed
            or row.get("is_repeatable")
            or row.get("applicability") != "APPLICABLE"
        ):
            continue
        values.setdefault(key, _row_value(row))
    return values


def timeline_word_context(values=None):
    """Project milestone values into the complete, string-only context keys."""

    values = values or {}
    context = {}
    for key in TIMELINE_MILESTONE_KEYS:
        number, date = values.get(key, ("", ""))
        context[number_context_key(key)] = number or ""
        context[date_context_key(key)] = date or ""
    return context


def merge_first_filled(values_by_package):
    """Pick, per milestone, the first package (in the given order) with data."""

    merged = {}
    for values in values_by_package:
        for key, (number, date) in values.items():
            if key not in merged and (number or date):
                merged[key] = (number, date)
    return merged
