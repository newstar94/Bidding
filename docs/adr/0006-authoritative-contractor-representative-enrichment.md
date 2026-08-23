# ADR 0006 — Bổ sung người đại diện nhà thầu từ nguồn tra cứu chính thức

- Trạng thái: Chấp nhận
- Ngày: 2026-08-23
- Phạm vi: Tra cứu và lưu thông tin nhà thầu tại bước mở thầu

## Bối cảnh

Nguồn MuaSamCong trả về `repName` và `repPosition`, nhưng worker bổ sung dữ liệu nhà
thầu chỉ lưu tên, địa chỉ, tên viết tắt và mã số thuế. Luồng lưu mở thầu cũng chỉ
tra cứu nhà thầu đứng đầu, không tra cứu các thành viên liên danh. Vì vậy nhà thầu
thành viên có thể đã có tên nhưng vẫn thiếu người đại diện trong dữ liệu nhà thầu,
thông tin mở thầu và ngữ cảnh xuất Word.

Trường hợp xác nhận lỗi là mã nhà thầu `vn0107351723`: nguồn MuaSamCong có người
đại diện và chức vụ, trong khi bản ghi nhà thầu hiện hành và thành viên liên danh
đều đang trống.

## Quyết định

1. Trước khi lưu mở thầu, hệ thống tra cứu theo lô cả nhà thầu đứng đầu và thành
   viên liên danh đang thiếu người đại diện.
2. Các mã trùng nhau trong cùng lượt lưu chỉ tạo một yêu cầu tra cứu; giới hạn
   concurrency hiện hữu được giữ nguyên.
3. Kết quả tra cứu chỉ bổ sung các trường thành viên đang trống, không ghi đè dữ
   liệu người dùng hoặc dữ liệu nhà thầu đã có.
4. Nếu bản ghi nhà thầu hiện hành đang thiếu `nguoi_dai_dien` hoặc
   `chuc_vu_dai_dien`, bản ghi đó được restage trong cùng giao dịch lưu mở thầu.
5. Worker bổ sung dữ liệu bền vững phải coi hai trường đại diện bị thiếu là lý do
   cần tra cứu và chỉ điền chúng khi giá trị hiện tại đang trống.
6. Không suy đoán danh tính. Chỉ lưu giá trị do nguồn tra cứu chính thức trả về.
7. Không thay đổi role, module permission, record scope, assignment scope,
   entitlement, tenant isolation hoặc dữ liệu mà người dùng được phép xem.

## Compatibility impact

- Payload và schema API không đổi; hai trường đã tồn tại tiếp tục dùng cùng tên và
  semantics.
- Bản ghi đã có người đại diện/chức vụ không bị ghi đè.
- Thành viên liên danh thiếu dữ liệu có thể phát sinh thêm một lượt tra cứu trong
  lúc lưu, nhưng vẫn nằm trong deadline và giới hạn concurrency hiện hữu.
- Dữ liệu người đại diện đã được người dùng nhập thủ công được bảo toàn.
- Ngữ cảnh đọc và xuất Word nhận dữ liệu đầy đủ hơn từ cùng bản ghi nhà thầu mà
  người dùng vốn đã được phép truy cập; không mở rộng quyền đọc bản ghi.

## Migration và rollout

1. Không cần thay đổi schema.
2. Các bản ghi cũ bị thiếu được đưa lại vào worker bổ sung dữ liệu theo mã nhà thầu
   hiện hữu; worker chỉ điền trường trống.
3. Sau rollout, kiểm tra lại bản ghi `vn0107351723`, thành viên liên danh của gói
   `IB2600082707` và ngữ cảnh xuất Word tương ứng.

## Rollback strategy

- Có thể rollback đồng bộ frontend và backend.
- Dữ liệu đại diện đã bổ sung từ nguồn chính thức được giữ lại; không tự động xóa
  khi rollback.
- Không có schema hoặc migration cần đảo ngược.

## Regression seams

- `tests/js/opening_contractor_lookup_batch.test.mjs`: thành viên liên danh thiếu
  người đại diện được tra cứu, cập nhật và restage đúng một lần.
- `tests/test_partner_muasamcong_lookup.py`: worker nhận diện trường đại diện bị
  thiếu và lưu tên/chức vụ từ nguồn tra cứu.

