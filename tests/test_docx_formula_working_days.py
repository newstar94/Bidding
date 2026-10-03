from datetime import date, timedelta

import pytest

from backend.documents import docx_formula_service as formulas


HOLIDAYS = {
    "2025": {"holidays": ["2025-12-31", "2025-12-31", "2026-01-01"]},
    "2026": {
        "holidays": ["2026-01-01", "2026-01-03", "2026-01-05"],
        "working_weekends": ["2026-01-03", "2026-01-05"],
    },
}


def reference_add(start, amount, holidays):
    steps = int(amount)
    direction = 1 if steps > 0 else -1
    day = start
    for _ in range(abs(steps)):
        while True:
            day += timedelta(days=direction)
            if formulas._is_working_day(day, holidays):
                break
    return day


def reference_diff(start, end, holidays):
    direction = 1 if end > start else -1
    result = 0
    while start != end:
        start += timedelta(days=direction)
        if formulas._is_working_day(start, holidays):
            result += direction
    return result


@pytest.mark.parametrize("start", [date(2025, 12, 29), date(2026, 1, 3), date(2026, 1, 9)])
@pytest.mark.parametrize("amount", [-40, -7, -1.9, 0, 1.9, 7, 40])
def test_add_preserves_calendar_holidays_overrides_and_truncation(start, amount):
    assert formulas._add_working_days(start, amount, HOLIDAYS) == reference_add(start, amount, HOLIDAYS)


@pytest.mark.parametrize("start", [date(2025, 12, 29), date(2026, 1, 3), date(2026, 1, 9)])
@pytest.mark.parametrize("end", [date(2025, 12, 27), date(2026, 1, 3), date(2026, 2, 3)])
def test_diff_preserves_direction_specific_endpoints(start, end):
    assert formulas._diff_working_days(start, end, HOLIDAYS) == reference_diff(start, end, HOLIDAYS)


def test_extreme_date_formulas_do_not_walk_millions_of_days(monkeypatch):
    calls = 0
    original = formulas._is_working_day

    def bounded_calendar(day, holidays):
        nonlocal calls
        calls += 1
        assert calls <= 64, "A formula must not occupy a shared API worker by iterating every day"
        return original(day, holidays)

    monkeypatch.setattr(formulas, "_is_working_day", bounded_calendar)
    assert formulas._diff_working_days(date.min, date.max, {}) == 2_608_614
    assert formulas._add_working_days(date.min, 2_608_614, {}) == date.max
    assert formulas._add_working_days(date.max, -2_608_614, {}) == date.min
    with pytest.raises(OverflowError):
        formulas._add_working_days(date.min, 10**100, {})


def test_computed_mapping_retains_existing_valid_output_and_overflow_error():
    context = {}
    formulas.apply_computed_mappings(context, [
        ("days", "__computed__", "diffWorkingDays('2026-10-03', '2026-10-02')"),
        ("date", "__computed__", "addWorkingDays('2026-10-02', 1)"),
        ("invalid", "__computed__", "addWorkingDays('9999-12-31', 1)"),
    ])
    assert context["days"] == -1
    assert context["date"] == "05/10/2026"
    assert context["invalid"].startswith("-- Lỗi công thức:")
