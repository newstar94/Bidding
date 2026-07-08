import re
import datetime


def safe_float(val):
    """
    Parse giá trị sang float.
    Trả về None cho giá trị trống (None/'') để bảo toàn NULL trong DB
    (phân biệt 'chưa nhập' vs 'nhập 0' cho các trường tài chính Optional).
    Hỗ trợ cả dạng số tiếng Việt (1.000.000,50) và tiếng Anh (1,000,000.50).
    """
    if val is None or val == '':
        return None
    try:
        s = str(val).strip()
        if not s:
            return None
        if ',' in s and '.' in s:
            if s.find('.') < s.find(','):
                # Dạng tiếng Việt: 1.000.000,50 → 1000000.50
                s = s.replace('.', '').replace(',', '.')
            else:
                # Dạng tiếng Anh: 1,000,000.50 → 1000000.50
                s = s.replace(',', '')
        elif ',' in s:
            if s.count(',') == 1:
                # Dấu phẩy duy nhất → dấu phân cách thập phân
                s = s.replace(',', '.')
            else:
                # Nhiều dấu phẩy → dấu phân cách nghìn
                s = s.replace(',', '')
        return float(s)
    except Exception:
        return None


def safe_int(val):
    """
    Parse giá trị sang int.
    Trả về None cho giá trị trống (None/'') để bảo toàn NULL trong DB.
    """
    if val is None or val == '':
        return None
    try:
        return int(float(val))
    except Exception:
        return None

def to_snake_case(name):
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()



def to_camel_case(snake_str):
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])



def clean_id(val):
    if val is None or val == "":
        return None
    return str(val).strip()



def format_date_str(date_str):
    if not date_str:
        return '--'
    date_str = str(date_str).strip().split(' ')[0]
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.datetime.strptime(date_str, fmt).strftime('%d/%m/%Y')
        except ValueError:
            pass
    return date_str



class VietnameseFloat(float):
    def __str__(self):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__str__()

    def __repr__(self):
        return self.__str__()

    def __format__(self, spec):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__format__(spec)



def clean_admin_prefix(name):
    if not name:
        return ""
    pattern = r"^(thành phố|tỉnh|phường|xã|thị trấn)\s+"
    return re.sub(pattern, '', name, flags=re.IGNORECASE)

