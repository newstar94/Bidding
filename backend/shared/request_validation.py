"""Small strict JSON request validator used at HTTP write boundaries."""

import math

from backend.shared.logging_utils import error_response
from backend.shared.numeric_utils import parse_vnd_amount


def _issue(field, code, message):
    return {"field": field, "code": code, "message": message}


def validate_json_object(data, fields, *, allow_unknown=False):
    """Return field errors for a JSON object according to declarative field specs.

    Supported spec keys: ``type``, ``required``, ``nullable``, ``min_length``,
    ``max_length``, ``min``, ``max`` and ``enum``. No invalid value is coerced.
    """
    if not isinstance(data, dict):
        return [_issue("$", "TYPE_OBJECT_REQUIRED", "Nội dung yêu cầu phải là JSON object.")]

    errors = []
    if not allow_unknown:
        for name in data:
            if name not in fields:
                errors.append(_issue(name, "UNKNOWN_FIELD", "Trường không được hỗ trợ."))

    for name, spec in fields.items():
        present = name in data
        if not present:
            if spec.get("required"):
                errors.append(_issue(name, "FIELD_REQUIRED", "Trường bắt buộc."))
            continue
        value = data[name]
        if value is None:
            if not spec.get("nullable", False):
                errors.append(_issue(name, "NULL_NOT_ALLOWED", "Trường này không được là null."))
            continue

        expected = spec.get("type", "any")
        valid_type = True
        if expected == "string":
            valid_type = isinstance(value, str)
        elif expected == "boolean":
            valid_type = isinstance(value, bool)
        elif expected == "integer":
            valid_type = isinstance(value, int) and not isinstance(value, bool)
        elif expected == "number":
            valid_type = (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
            )
        elif expected == "money":
            valid_type = parse_vnd_amount(value) is not None
        elif expected == "array":
            valid_type = isinstance(value, list)
        elif expected == "object":
            valid_type = isinstance(value, dict)

        if not valid_type:
            errors.append(_issue(name, f"INVALID_{expected.upper()}", f"Kiểu dữ liệu của '{name}' không hợp lệ."))
            continue
        if isinstance(value, (str, list, dict)):
            if spec.get("min_length") is not None and len(value) < spec["min_length"]:
                errors.append(_issue(name, "VALUE_TOO_SHORT", "Giá trị ngắn hơn giới hạn cho phép."))
            if spec.get("max_length") is not None and len(value) > spec["max_length"]:
                errors.append(_issue(name, "VALUE_TOO_LONG", "Giá trị vượt quá giới hạn cho phép."))
        if expected in {"integer", "number"}:
            if spec.get("min") is not None and value < spec["min"]:
                errors.append(_issue(name, "VALUE_TOO_SMALL", "Giá trị nhỏ hơn giới hạn cho phép."))
            if spec.get("max") is not None and value > spec["max"]:
                errors.append(_issue(name, "VALUE_TOO_LARGE", "Giá trị lớn hơn giới hạn cho phép."))
        if spec.get("enum") is not None and value not in spec["enum"]:
            errors.append(_issue(name, "INVALID_ENUM", "Giá trị không thuộc danh sách cho phép."))
    return errors


def request_validation_response(request, errors, *, code="REQUEST_VALIDATION_FAILED"):
    return error_response(
        request,
        code,
        "Dữ liệu yêu cầu không hợp lệ.",
        status_code=400,
        fields={"errors": errors},
    )


def validate_or_response(request, data, fields, *, allow_unknown=False):
    errors = validate_json_object(data, fields, allow_unknown=allow_unknown)
    return request_validation_response(request, errors) if errors else None
