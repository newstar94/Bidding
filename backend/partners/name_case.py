"""Casing-only normalization of all-uppercase procurement partner names."""
import re

ACRONYMS = set("TNHH CTCP CP MTV UBND HĐND BQL BQLDA HTX JSC LLC FPT VNPT EVN BIDV PCCC TM DV XNK".split())
COMMON_WORDS = set("CONG TY DUOC PHAM THUONG MAI DICH VU XAY DUNG DAU TU PHAT TRIEN TRUNG TAM TE BENH VIEN BAN QUAN LY ANH CHI NHAN DAN TINH THANH PHO KHU VUC".split())
PHRASES = (
    "Công ty", "Cổ phần", "Trách nhiệm hữu hạn", "Một thành viên", "Hai thành viên",
    "Thương mại", "Dịch vụ", "Dược phẩm", "Xây dựng", "Đầu tư", "Phát triển",
    "Trung tâm", "Y tế", "Bệnh viện", "Ban quản lý", "Dự án", "Ủy ban nhân dân",
    "Liên danh", "Chi nhánh", "Khu vực", "Thành phố", "Thị xã", "Thị trấn",
)


def normalize_procurement_partner_name(value):
    text = str(value or "")
    if not text.isupper():
        return text

    def word_case(match):
        word = match.group()
        if word in ACRONYMS or any(char.isdigit() for char in word):
            return word
        return word[:1] + word[1:].lower()

    result = re.sub(r"[^\W\d_][^\W_]*", word_case, text)
    for phrase in PHRASES:
        result = re.sub(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", phrase, result, flags=re.I)
    return result
