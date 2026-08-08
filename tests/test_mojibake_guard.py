from scripts.check_mojibake import find_mojibake


def test_mojibake_guard_detects_double_decoded_vietnamese_sequences():
    findings = find_mojibake('throw new Error("KhÃ´ng Ä‘á»§ dá»¯ liá»‡u")')
    assert findings


def test_mojibake_guard_accepts_valid_vietnamese_and_uppercase_alphabet_text():
    assert find_mojibake('eyebrow="GỬI LẠI MÃ XÁC THỰC"') == []
    assert find_mojibake('alphabet="ÀÁẠẢÃÂẦẤẬẨẪĂ"') == []
