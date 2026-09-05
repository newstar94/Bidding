# ADR 0032 — Mặc định bật tra cứu và nhập Mua Sắm Công

- Trạng thái: Chấp nhận
- Ngày: 2026-08-31
- Phạm vi: nguồn tra cứu/nhập KHLCNT, TBMT và mở thầu từ Mua Sắm Công

## Quyết định

1. Khi không có override môi trường, `PROCUREMENT_LOOKUP_ENABLED` và
   `PROCUREMENT_IMPORT_ENABLED` có effective default là `true`.
2. Provider mặc định là `muasamcong`; deployment mới không phải khai báo ba
   biến `PROCUREMENT_LOOKUP_ENABLED`, `PROCUREMENT_IMPORT_ENABLED` và
   `PROCUREMENT_PROVIDER`.
3. Trình duyệt tra cứu thống nhất theo ADR 0036, target bị
   giới hạn đúng hostname chính thức `muasamcong.mpi.gov.vn`.
4. Override `false`, provider khác và các alias `VNEPS_*` cũ vẫn được đọc để
   rollback hoặc tương thích deployment cũ.

## Business contract

- Việc bật connector không tự cấp entitlement, quota, role, module permission,
  assignment scope hoặc record scope.
- Mọi thao tác vẫn đi qua tenant/record authorization và commercial policy hiện
  hành; không thay đổi masking hoặc dữ liệu người dùng được phép xem.
- Trình duyệt không giải CAPTCHA, replay token/cookie, giả challenge hoặc vô
  hiệu hóa sandbox/bảo mật Chromium.

## Compatibility impact

- Deployment không khai báo feature flag sẽ bắt đầu quảng bá capability lookup
  và import, đồng thời khởi tạo nguồn browser theo cơ chế lazy hiện có.
- Deployment muốn tạm tắt phải khai báo tường minh
  `PROCUREMENT_LOOKUP_ENABLED=false` và `PROCUREMENT_IMPORT_ENABLED=false`.
- Alias `VNEPS_*` tường minh tiếp tục có precedence tương thích khi canonical
  provider/lookup flag chưa được khai báo.

## Migration và rollback

- Xóa ba biến canonical khỏi `.env` của deployment dùng mặc định mới.
- Giữ Chromium/Playwright và kết nối TLS tới hostname chính thức trong image.
- Rollback bằng hai flag `false` nêu trên; dùng
  rollback phiên bản code nếu cần phục hồi browser adapter trước đó.

## Regression seams

- Environment rỗng chọn provider `muasamcong`, bật lookup/import và quảng bá cả
  hai server capability.
- Override `false` vẫn tắt đúng connector.
- Legacy fixture/provider vẫn hoạt động trong phạm vi test được phép.
- Exact-host gate, CAPTCHA interaction taxonomy, tenant/record authorization và
  commercial entitlement/quota giữ nguyên.
