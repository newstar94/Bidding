"""Safe formula evaluation for computed Word mappings."""

import ast
import json
import os
import re
from datetime import date, datetime, timedelta


COMPUTED_SOURCE_TABLE = "__computed__"

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
    raise ValueError(f'Không đọc được ngày tháng: {value}')


def _format_formula_date(value):
    if isinstance(value, (datetime, date)):
        month = f'{value.month:02d}' if value.month in (1, 2) else str(value.month)
        return f'{value.day:02d}/{month}/{value.year:04d}'
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
    month = f'{day.month:02d}' if day.month in (1, 2) else str(day.month)
    return fmt.replace('dd', f'{day.day:02d}').replace('MM', month).replace('yyyy', f'{day.year:04d}')


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
            except (ValueError, ArithmeticError, TypeError) as exc:
                if isinstance(exc, ValueError) and 'chua co gia tri' in str(exc):
                    continue
                else:
                    context[ten_bien] = f'-- Lỗi công thức: {exc}'
                    variables[ten_bien] = context[ten_bien]
                    del pending[ten_bien]
                    progressed = True
        if not pending or not progressed:
            break

    for ten_bien, formula in pending.items():
        context[ten_bien] = '-- Lỗi công thức: vòng lặp hoặc thiếu biến nguồn'


