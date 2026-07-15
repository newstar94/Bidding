import re
import datetime
import unicodedata


def normalize_business_identifier(value, *, digits_only=False):
    """Return the canonical stored representation of a business identifier."""
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(str.maketrans({
        "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
        "／": "/",
    }))
    text = re.sub(r"\s+", "", text) if digits_only else re.sub(r"\s+", " ", text).strip()
    return text.upper()


def normalize_person_name(value):

    text = re.sub(r"\s+", " ", str(value or "").strip()).lower()
    return re.sub(
        r"(^|[\s'-])([^\W\d_])",
        lambda match: f"{match.group(1)}{match.group(2).upper()}",
        text,
        flags=re.UNICODE,
    )


ORGANIZATION_ACRONYMS = {
    "tnhh", "mtv", "ubnd", "hđnd", "cp", "jsc", "llc", "fpt", "vnpt",
    "viettel", "evn", "bidv", "vietcombank", "vietinbank", "agribank", "pccc",
}
ADMIN_NAME_MARKERS = {
    "xã", "phường", "huyện", "quận", "tỉnh", "thành phố", "thị xã", "thị trấn",
}


def normalize_organization_name(value):

    compact = re.sub(r"\s+", " ", str(value or "").strip())
    if not compact:
        return ""

    letters = [char for char in compact if char.isalpha()]
    is_all_upper = bool(letters) and all(char == char.upper() for char in letters)
    is_all_lower = bool(letters) and all(char == char.lower() for char in letters)
    if not is_all_upper and not is_all_lower:
        return compact

    words = compact.lower().split(" ")
    result = []
    capitalize_admin_name = False
    for index, word in enumerate(words):
        bare = re.sub(r"^[^\wÀ-ỹ]+|[^\wÀ-ỹ]+$", "", word, flags=re.UNICODE)
        if bare in ORGANIZATION_ACRONYMS:
            normalized_word = word.replace(bare, bare.upper())
        else:
            normalized_word = word
            if index == 0 or capitalize_admin_name:
                normalized_word = re.sub(
                    r"([^\W\d_])",
                    lambda match: match.group(1).upper(),
                    word,
                    count=1,
                    flags=re.UNICODE,
                )

        two_word_marker = f"{words[index - 1]} {bare}" if index > 0 else ""
        is_marker = bare in ADMIN_NAME_MARKERS or two_word_marker in ADMIN_NAME_MARKERS
        if is_marker:
            capitalize_admin_name = True
        if re.search(r"[,:;()]$", word) and not is_marker:
            capitalize_admin_name = False
        result.append(normalized_word)
    return " ".join(result)


def safe_float(val):

    if val is None or val == '':
        return None
    try:
        s = str(val).strip()
        if not s:
            return None
        if ',' in s and '.' in s:
            if s.find('.') < s.find(','):

                s = s.replace('.', '').replace(',', '.')
            else:

                s = s.replace(',', '')
        elif ',' in s:
            if s.count(',') == 1:

                s = s.replace(',', '.')
            else:

                s = s.replace(',', '')
        return float(s)
    except Exception:
        return None


def safe_int(val):

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
