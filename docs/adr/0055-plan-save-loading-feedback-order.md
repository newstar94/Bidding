# ADR 0055 — Thứ tự loading và thông báo khi lưu kế hoạch

Status: Accepted by the product owner's request.

## Decision

Trong luồng lưu kế hoạch, màn hình loading phải được đóng hoàn toàn trước khi
hiển thị toast hoặc hộp thoại kết quả. Loading vẫn giữ nguyên trong suốt quá
trình chuẩn bị, lưu cục bộ và chờ xác nhận máy chủ.

Thông báo trạng thái chờ đồng bộ được phát sau khi loading đóng. Toast trung
gian không được hiển thị trong lúc lớp loading còn che màn hình.

## Compatibility and migration

Thay đổi chỉ điều chỉnh thứ tự phản hồi giao diện của luồng kế hoạch. Không
thay đổi dữ liệu, quyền, phạm vi bản ghi, trạng thái đồng bộ hoặc schema; không
cần migration.

## Verification

- `tests/js/plan_version_draft_session.test.mjs`
- `npm run lint:security`
- `npm run lint:modules`
