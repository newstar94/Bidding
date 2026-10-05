import json

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    normalize_evaluation_method_form,
    normalize_technical_weight_form,
)
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


@pytest.mark.parametrize('weight,expected', [
    (80, 80), ('80', 80), ('80%', 80), (' 80 ', 80), (0, 0), (100, 100),
    (None, None), ('', None), (True, None), ('invalid', None),
    (-1, None), (101, None), (80.5, None), ('NaN', None),
])
def test_combined_method_maps_txtk_as_a_technical_percentage(weight, expected):
    raw = {'bidoInvBiddingDTO': [form('NEW.FORM', '3', formValue=json.dumps({
        'method': '3', 'txtK': weight, 'txtG': None,
    }))]}
    assert normalize_technical_weight_form(raw, 'TV') == expected


def test_technical_weight_ignores_other_methods_chapters_files_and_nested_values():
    raw = {'txtK': 80, 'bidoInvBiddingDTO': [
        form('CONTRACT', '3', chapterCode='BD_CONTRACT_CONDITION',
             formValue=json.dumps({'method': '3', 'txtK': 75})),
        form('OTHER_FILE', '3', bidFile='OTHER',
             formValue=json.dumps({'method': '3', 'txtK': 75})),
        form('NESTED', None, formValue=json.dumps({'payment': {'method': '3', 'txtK': 75}})),
        form('EVALUATION', '2', formValue=json.dumps({'method': '2', 'txtK': 80})),
    ]}
    assert normalize_technical_weight_form(raw, 'HH') is None


def test_duplicate_technical_weights_must_agree():
    assert normalize_technical_weight_form({'bidoInvBiddingDTO': [
        form('A', '3', formValue=json.dumps({'method': '3', 'txtK': 80})),
        form('B', '3', formValue=json.dumps({'method': '3', 'txtK': '80'})),
    ]}, 'TV') == 80
    for weights in [(75, 80), (80, 75)]:
        with pytest.raises(ProcurementSourceError, match='PROCUREMENT_SCHEMA_CHANGED'):
            normalize_technical_weight_form({'bidoInvBiddingDTO': [
                form('A', '3', formValue=json.dumps({'method': '3', 'txtK': weights[0]})),
                form('B', '3', formValue=json.dumps({'method': '3', 'txtK': weights[1]})),
            ]}, 'TV')


def test_unknown_method_does_not_supply_another_candidates_weight():
    assert normalize_technical_weight_form({'bidoInvBiddingDTO': [
        form('A', '999', formValue=json.dumps({'method': '999', 'txtK': 80})),
        form('B', '3', formValue=json.dumps({'method': '3', 'txtK': 80})),
    ]}, 'TV') is None
