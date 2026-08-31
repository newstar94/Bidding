# ADR 0035 — Mã dự án và tên dự án không bắt buộc trên kế hoạch

- Trạng thái: Chấp nhận
- Ngày: 2026-08-31
- Phạm vi: Tạo, sửa, nhập và lưu kế hoạch lựa chọn nhà thầu

## Bối cảnh

Form kế hoạch, validation máy chủ và schema PostgreSQL từng bắt buộc tên dự
án/dự toán; riêng kế hoạch loại Dự án còn bắt buộc Mã dự án. Chủ sản phẩm xác
nhận kế hoạch được phép tồn tại khi chưa có hai thông tin này.

## Quyết định và business contract

1. Với kế hoạch loại `Dự án`, `maDuan` và `tenDuAnDuToan` đều là trường không
   bắt buộc.
2. Form không hiển thị dấu bắt buộc, không dùng thuộc tính HTML `required` và
   không tự bật yêu cầu khi chọn loại hình Dự án.
3. API tạo, sửa, đồng bộ và hoàn tất chuỗi phiên bản không từ chối kế hoạch chỉ
   vì hai trường này trống hoặc không được gửi.
4. PostgreSQL cho phép `ma_du_an` và `ten_du_an_du_toan` là `NULL` hoặc chuỗi
   rỗng đối với kế hoạch loại `Dự án`. Dữ liệu đã có không bị xóa, rút gọn hay
   biến đổi.
5. Nếu người dùng hoặc nguồn Mua Sắm Công cung cấp giá trị, hệ thống tiếp tục
   lưu, hiển thị, tìm kiếm và xuất tài liệu như trước.
6. Không thay đổi tenant isolation, role, module permission, assignment scope,
   record scope, entitlement, masking hoặc phạm vi dữ liệu được phép đọc.
7. `Tên dự toán` của loại `Dự toán mua sắm` tiếp tục bắt buộc vì quyết định này
   không thay đổi contract của dự toán.

## Compatibility impact

- Kế hoạch loại Dự án trước đây bị chặn vì thiếu Mã dự án hoặc Tên dự án nay
  được phép lưu.
- Payload và bản ghi đã có hai giá trị không đổi cấu trúc hoặc semantics.
- Màn hình danh sách, chi tiết, tìm kiếm và tài liệu tiếp tục dùng giá trị khi
  có; khi trống tiếp tục dùng cách hiển thị rỗng hiện hữu.

## Migration và rollout

- Schema v90 bỏ `NOT NULL` và check không-rỗng toàn cục của
  `ke_hoach_lcnt.ten_du_an_du_toan`, rồi thêm check chỉ yêu cầu tên đối với loại
  `Dự toán mua sắm`; `ma_du_an` vốn đã nullable.
- Migration không cập nhật hoặc backfill bản ghi hiện hữu.
- Frontend, backend và migration được rollout cùng release để contract nhất
  quán ở mọi ranh giới lưu.

## Rollback strategy

Không rollback schema sang bắt buộc nếu đã có bản ghi thiếu tên dự án/dự toán.
Muốn khôi phục contract cũ phải có quyết định nghiệp vụ mới và chiến lược bổ
sung dữ liệu rõ ràng trước khi thêm lại constraint.

## Regression seams

- `tests/js/optional_plan_project_approval_fields.test.mjs`: hai ô không có dấu
  bắt buộc, `required` tĩnh hoặc `required` bật theo loại hình.
- `tests/test_sync_mutation_contract.py`: backend chấp nhận kế hoạch loại Dự án
  khi cả mã và tên dự án trống.
- `tests/test_postgres_migration_chain.py`: nâng từ v89 lên schema mới rồi lưu
  bản ghi có hai cột dự án là `NULL`.
