from backend.shared.sensitive_data import mask_identifier, redact_contractor_financial_item, redact_expert_item


def test_identifier_mask_keeps_only_a_short_suffix():
    assert mask_identifier("001234567890") == "********7890"
    assert mask_identifier("123") == "****123"
    assert mask_identifier("") == ""


def test_read_only_expert_payload_removes_private_media():
    source = {
        "id": "expert-1",
        "soCCCD": "001234567890",
        "anhChungChi": "/uploads/certificate.png",
        "anhChuKy": "/uploads/signature.png",
        "tenAnhChungChi": "certificate.png",
        "hoTen": "Nguyễn Văn A",
    }

    redacted = redact_expert_item(source)

    assert redacted["soCCCD"] == "********7890"
    assert redacted["anhChungChi"] is None
    assert redacted["anhChuKy"] is None
    assert redacted["tenAnhChungChi"] is None
    assert redacted["sensitiveDataMasked"] is True
    assert redacted["hoTen"] == "Nguyễn Văn A"
    assert source["anhChuKy"] == "/uploads/signature.png"


def test_read_only_contractor_payload_masks_bank_data_including_joint_venture_members():
    source = {
        "soTaiKhoan": "1234567890123", "noiMoTaiKhoan": "Ngân hàng A", "maNganHang": "001",
        "thanhVienLienDanh": [{"soTaiKhoan": "9876543210", "noiMoTaiKhoan": "Ngân hàng B"}],
    }
    redacted = redact_contractor_financial_item(source)
    assert redacted["soTaiKhoan"].endswith("0123")
    assert redacted["noiMoTaiKhoan"] is None
    assert redacted["maNganHang"] is None
    assert redacted["thanhVienLienDanh"][0]["soTaiKhoan"].endswith("3210")
    assert source["soTaiKhoan"] == "1234567890123"
