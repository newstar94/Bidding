# ADR 0043 — Production artifact không chứa Markdown

- Trạng thái: Chấp nhận
- Ngày: 2026-09-12

## Quyết định

Gói ZIP production không chứa bất kỳ file `*.md` nào. Markdown vẫn được giữ trong repository để phục vụ ADR, kiểm thử, legal gate, hướng dẫn vận hành và audit, nhưng không phải runtime payload.

`scripts/package_production.py` phải loại Markdown khỏi cả danh sách file riêng lẻ, thư mục `deploy/` và mọi đầu vào phát sinh khác. Regression test phải xác nhận tập runtime source không có đường dẫn kết thúc bằng `.md`.

## Compatibility impact

Không thay đổi API, schema, quyền, entitlement, masking, record scope hoặc dữ liệu người dùng. Các operator không còn đọc runbook/README trực tiếp từ artifact; phải dùng đúng revision trong repository hoặc kho tài liệu vận hành tương ứng với release.

## Migration và rollback

- Trước khi triển khai, cung cấp repository revision hoặc bản sao tài liệu vận hành ngoài artifact cho operator.
- Không chuyển secret hoặc fact sheet vào ZIP để thay thế Markdown.
- Rollback bằng cách hoàn nguyên ADR và allowlist packager trong cùng một release đã được kiểm tra lại.
