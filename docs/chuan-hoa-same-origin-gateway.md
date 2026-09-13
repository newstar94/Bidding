# Chuẩn Hóa trên cùng tên miền Bidding

Bidding là public ingress; Chuẩn Hóa vẫn là một API/database độc lập.

Đặt biến server-side của Bidding:

```text
CHUAN_HOA_PUBLIC_UPSTREAM_URL=http://127.0.0.1:5206
```

Khi Bidding được phục vụ tại `https://bidding.example`, Add-in dùng:

```text
CHUANHOA_API_URL=https://bidding.example/chuan-hoa
```

Bản Add-in hiện tại mặc định dùng `https://hosodauthau.online/chuan-hoa`, nên
không cần đặt `CHUANHOA_API_URL` khi triển khai production với domain này.
Biến môi trường vẫn có thể dùng để ghi đè khi chạy staging hoặc kiểm thử cục bộ.

Bidding chỉ proxy các route account/VIP công khai:

```text
/chuan-hoa/v1/access/*
/chuan-hoa/health
```

Các route `/v1/admin/integration/*` không đi qua proxy public; Dashboard Bidding
tiếp tục gọi Chuẩn Hóa bằng backend-to-backend HMAC. Không đặt S2S secret trong
`CHUANHOA_API_URL`, browser, bundle hoặc localStorage.

Trong Dashboard, Super Admin có thể bấm **Kết nối tài khoản Super Admin này** khi
chưa có mapping. Bidding chỉ thực hiện mapping sau khi handshake capabilities
thành công, lưu `user_id` ở file server-side
`CHUAN_HOA_ADMIN_MAPPING_FILE` (mặc định `data/chuan-hoa-admin-mappings.json`)
và ghi audit. Không ánh xạ theo email hoặc tự cấp quyền cho tài khoản khác.
