import json

import pytest

from backend.integrations.muasamcong_browser.canonical import normalize_evaluation_method_form
from backend.procurement_import.source import ProcurementSourceError


def form(code, method, **metadata):
    return {
        'formCode': code, 'chapterCode': 'C3', 'bidFile': 'HSMT',
        'formValue': json.dumps({'method': method}), **metadata,
    }


@pytest.mark.parametrize('field,method,expected', [
    ('XL', '1', 'Giá thấp nhất'),
    ('TV', '2', 'Giá cố định'),
    ('PTV', '2', 'Giá đánh giá'),
    ('TV', '3', 'Kết hợp giữa kỹ thuật và giá'),
])
def test_method_discovery_does_not_depend_on_form_identifier(field, method, expected):
    assert normalize_evaluation_method_form(
        {'bidoInvBiddingDTO': [form('NEW.FORM', method)]}, field,
    ) == expected


def test_construction_form_from_ib2600501124():
    assert normalize_evaluation_method_form(
        {'bidoInvBiddingDTO': [form('BD.MT.02.0791', '1')]}, 'XL',
    ) == 'Giá thấp nhất'


def test_unrelated_and_nested_methods_are_not_evaluation_methods():
    raw = {'method': '2', 'other': form('OTHER', '2'), 'bidoInvBiddingDTO': [
        form('CONTRACT', '2', chapterCode='BD_CONTRACT_CONDITION'),
        form('OTHER_FILE', '2', bidFile='OTHER'),
        form('NESTED', None, formValue=json.dumps({'payment': {'method': '2'}})),
        form('EVALUATION', '1'),
    ]}
    assert normalize_evaluation_method_form(raw, 'XL') == 'Giá thấp nhất'


def test_duplicate_evidence_agrees_and_conflicts_do_not_depend_on_order():
    assert normalize_evaluation_method_form(
        {'bidoInvBiddingDTO': [form('A', '1'), form('B', 1)]}, 'XL',
    ) == 'Giá thấp nhất'
    for methods in [('1', '3'), ('3', '1')]:
        with pytest.raises(ProcurementSourceError, match='PROCUREMENT_SCHEMA_CHANGED'):
            normalize_evaluation_method_form(
                {'bidoInvBiddingDTO': [form('A', methods[0]), form('B', methods[1])]}, 'XL',
            )


def test_unknown_method_is_not_replaced_with_another_candidate():
    assert normalize_evaluation_method_form(
        {'bidoInvBiddingDTO': [form('A', '999'), form('B', '1')]}, 'XL',
    ) is None
