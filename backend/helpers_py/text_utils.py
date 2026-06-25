import re
import datetime

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
            return datetime.strptime(date_str, fmt).strftime('%d/%m/%Y')
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

