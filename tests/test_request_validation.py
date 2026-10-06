"""Oversized numeric values and decoder limits stay bounded at input seams."""

import asyncio
from decimal import Decimal
import json
import sys

import pytest
from starlette.requests import Request

from backend.shared import numeric_utils
from backend.shared.request_validation import read_json_object


@pytest.mark.parametrize("value", ["1e1000000000", "-1e1000000000"])
def test_money_rejects_out_of_range_exponent_before_integer_conversion(monkeypatch, value):
    class CheckedDecimal(Decimal):
        def __int__(self):
            raise AssertionError("An invalid exponent must be rejected before allocating its integer")

    monkeypatch.setattr(numeric_utils, "Decimal", CheckedDecimal)
    assert numeric_utils.parse_vnd_amount(value) is None


@pytest.mark.parametrize(
    "value, expected",
    [("0", 0), ("1e3", 1000), (str(numeric_utils.MAX_SIGNED_64BIT_INTEGER),
      numeric_utils.MAX_SIGNED_64BIT_INTEGER),
     (str(numeric_utils.MAX_SIGNED_64BIT_INTEGER + 1), None),
     ("1.5", None), ("NaN", None), ("Infinity", None), (True, None)],
)
def test_money_preserves_exact_existing_range(value, expected):
    assert numeric_utils.parse_vnd_amount(value) == expected


def _request(body):
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({
        "type": "http", "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/api/sync", "query_string": b"",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8000),
    }, receive)


@pytest.mark.parametrize("decoder_limit", ["integer", "syntax", "utf8"])
def test_json_decoder_resource_limits_return_existing_400_contract(decoder_limit):
    if decoder_limit == "integer":
        digit_limit = sys.get_int_max_str_digits()
        if not digit_limit:
            pytest.skip("This Python runtime disables the integer decoding limit")
        body = b'{"value":' + b"7" * (digit_limit + 1) + b"}"
    elif decoder_limit == "syntax":
        body = b'{"value":'
    else:
        body = b'{"value":"\xff"}'

    data, response = asyncio.run(read_json_object(_request(body)))
    assert data is None
    assert response.status_code == 400
    assert json.loads(response.body)["code"] == "REQUEST_JSON_INVALID"


def test_json_object_still_accepts_valid_financial_and_nested_fields():
    body = b'{"price":"9223372036854775807","nested":{"value":[1,2]}}'
    data, response = asyncio.run(read_json_object(_request(body)))
    assert data == json.loads(body)
    assert response is None
