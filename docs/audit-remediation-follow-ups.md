# Follow-up sau remediation audit 2026-08-22

Tài liệu này ghi các hạng mục cố ý chưa thay đổi vì cần quyết định nghiệp vụ,
mapping dữ liệu hoặc xác nhận asset. Chúng không phải phần remediation kỹ thuật
được phép tự suy đoán.

## Quyết định cần chủ sản phẩm cung cấp

1. **Migration v61 — tenant `HTD`/`HCP`**
   - Cần mapping chính xác theo tenant ID, backup và bằng chứng rollout.
   - Không được sửa migration v61 đã phát hành hoặc tự đổi toàn bộ `HCP` về
     `HTD`.
   - Preflight hiện chỉ báo candidate aggregate và yêu cầu mapping được duyệt.

2. **Offboarding successor**
   - Xác nhận assignment chính thức là optional hay bắt buộc có người tiếp quản.
   - Cho đến khi có ADR, giữ nguyên backend branch, request fields và modal cũ;
     không khôi phục hoặc xóa successor semantics.

3. **Staged approval**
   - Xác nhận retention period và việc metadata/flag còn thuộc API contract hay
     chỉ cần giữ cho audit history.
   - Nếu retire, cần migration mới, compatibility plan và regression tests.

4. **Legacy procurement wizard**
   - Xác nhận flow đã retire hay còn entrypoint ngoài module graph hiện tại.
   - Trước khi được phê duyệt, giữ nguyên wizard và chỉ bảo đảm Playwright luôn
     discover các spec liên quan.

5. **Sensitive-read schema**
   - `sensitive_record_read_capabilities` hiện là legacy no-op phù hợp contract
     đọc đầy đủ bản ghi đã được cấp quyền.
   - Chỉ được retire bằng migration mới và ADR; tuyệt đối không tái kích hoạt
     masking hoặc capability đọc nhạy cảm riêng.

6. **Root `favicon.png`**
   - Runtime dùng `views/assets/favicon.png`; cần xác nhận root asset 1,87 MiB có
     phải source-design asset ngoài runtime hay không trước khi xóa.

## Hạng mục vận hành không tự động dọn

- Không xóa `data`, `release`, `.env` hoặc `.env.before-staging` bằng cleanup
  codebase. Owner vận hành phải xác nhận retention/backup trước.
- Không ghi giá trị secret vào ticket, log hay tài liệu. Nếu file secret cũ
  không còn dùng, rotate/revoke qua quy trình secret manager trước khi xóa.

## Contract bất biến trong thời gian chờ

- Người đã có quyền đọc bản ghi vẫn xem đầy đủ dữ liệu của bản ghi đó.
- Entitlement Word chỉ kiểm soát tạo/tải Word, không kiểm soát trường dữ liệu đọc.
- Không thay đổi role, module permission, assignment scope, record scope,
  inheritance hoặc default allow/deny khi chưa có phê duyệt và ADR.
