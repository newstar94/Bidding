# Chuẩn Hóa account/VIP implementation status

Ngày xác minh: 2026-09-13

## Đã triển khai

- V004 append-only schema cho `account_sessions`, `account_device_bindings`,
  `activation_keys` và `activation_key_devices`.
- Account registration/login/logout/current-session API.
- Session absolute expiry 72 giờ; logout giải phóng binding; session hết hạn
  cho phép rebind thiết bị mới.
- Password PBKDF2 hash; không lưu plaintext password.
- VIP key tạo server-side bằng CSPRNG 160-bit; DB chỉ lưu hash/prefix.
- Activation cùng device idempotent; concurrent final-slot activation không
  oversubscribe.
- S2S Admin tạo/list/revoke VIP key, release activation device và reset account
  device; audit external actor tại Chuẩn Hóa.
- Bidding Admin hiện có tab VIP keys, form tạo key, revoke key và reset device.
- `AccessMode.None/Account/ActivationKey` policy giới hạn account lease theo
  session expiry và khóa cache khác device.

## Bằng chứng

- Persistence harness V001–V004: `13 passed`.
- Chuẩn Hóa solution: `506 passed`.
- Client Core: `439 passed`.
- Bidding integration: `15 passed`.
- Bidding Admin Chuẩn Hóa JS: `6 passed`.
- `npm run lint:security`: pass.
- NuGet, npm production và Python dependency scans không phát hiện advisory đã biết.

## Chưa hoàn tất / chưa thể xác minh

- Word Add-in chưa gọi production account/activation API để lấy signed lease/rule-pack;
  access-mode policy mới là seam trung tâm đã kiểm thử.
- Account/VIP WPF settings UI chưa có end-to-end network flow.
- VSTO build/Word Interop regression chưa chạy vì máy xác minh thiếu Word VSTO
  Developer Tools và .NET Framework 4.8 targeting pack.
- Chưa chạy production migration, deploy, multi-replica production traffic,
  payment thật hoặc production proxy topology.

Không được gọi hệ thống production-ready khi các mục trên chưa có bằng chứng.
### 2026-09-13 security seam update

`LocalAccessManager` now carries the server-authorized `AccessModeState` in
memory and passes it through every cached lease validation, so an account lease
cannot authorize a command after the 72-hour account session expires. Account
session material has a dedicated Windows DPAPI-backed
`ProtectedSessionStore`. The asynchronous production API adapter and UI wiring
are now wired through `AccountAccessApiClient` and the WPF settings surface.
The signed entitlement/rule-pack bootstrap is still required before this can be
called production-complete; account login/API behavior can be tested locally,
while the VSTO binary itself requires the Word developer workload.
