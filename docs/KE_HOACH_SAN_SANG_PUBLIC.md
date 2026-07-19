# Kế hoạch bảo mật, chịu tải và sẵn sàng public BiddingFlow

> Ngày lập: 19/07/2026  
> Phạm vi: mã nguồn và cấu hình triển khai trong `D:\Bidding`  
> Cơ sở dữ liệu mục tiêu: PostgreSQL fresh install, không chuyển dữ liệu cũ  
> Trạng thái: kế hoạch khắc phục sau rà soát pre-production  
> Nguyên tắc giao diện: không thay đổi frontend, CSS, bố cục hoặc hợp đồng hiển thị nếu công việc không được phê duyệt riêng

## 1. Mục tiêu

Kế hoạch này đưa BiddingFlow từ trạng thái chạy thử nội bộ sang trạng thái đủ điều kiện cung cấp công khai trên Internet. Bốn mục tiêu chính:

1. Không để người dùng vượt tenant, tiếp tục dùng quyền đã bị thu hồi hoặc chiếm quyền tài khoản.
2. Chống được brute force, credential stuffing, XSS, CSRF, upload độc hại, khai thác parser tài liệu, lạm dụng API và các hình thức làm cạn tài nguyên phổ biến.
3. Duy trì độ trễ ổn định khi tăng tải, không để queue, pool PostgreSQL hoặc công việc nền làm nghẽn toàn bộ ứng dụng.
4. Có quy trình build, kiểm thử, giám sát, backup, phục hồi và rollback đủ tin cậy để vận hành sản phẩm thương mại.

## 2. Phạm vi và ràng buộc

### 2.1. Trong phạm vi

- Backend Starlette, xác thực, session, phân quyền cá nhân/tổ chức và Super Admin.
- PostgreSQL, transaction, connection pool, index, runtime role và tenant isolation.
- WebSocket, multi-worker, background task, document worker và email.
- Các thư viện JavaScript/Python, kể cả thư viện được chép trực tiếp vào `views/vendor`.
- Nginx, systemd, TLS, WAF/CDN, secrets, log, metrics, cảnh báo và backup.
- CI/CD, test bảo mật, test hợp đồng API, test tải và release gate.

### 2.2. Ngoài phạm vi

- Không nhập hoặc bảo tồn dữ liệu từ hệ cơ sở dữ liệu cũ.
- Không thay đổi nghiệp vụ, UI, CSS, nội dung hiển thị hoặc định dạng dữ liệu trả về nếu không có yêu cầu riêng.
- Không coi bài thử tải trên máy phát triển là chứng nhận năng lực production.
- Không coi rà soát mã nguồn là thay thế cho penetration test trên staging.

### 2.3. Các đường dẫn không được thay đổi trong đợt backend/hạ tầng

```text
frontend/**
views/**/*.html
**/*.css
```

Ngoại lệ duy nhất ở frontend là nâng thư viện vendored có lỗ hổng hoặc thay đổi nội bộ bắt buộc để loại bỏ lỗ hổng XSS; mọi ngoại lệ phải giữ nguyên giao diện và được kiểm tra hồi quy trực quan.

## 3. Baseline đã kiểm chứng

| Hạng mục | Kết quả hiện tại |
|---|---|
| Python compile | Đạt |
| Test ứng dụng | 750 đạt, 1 bỏ qua có điều kiện với `pytest -q tests --cov=backend --cov-branch` |
| Branch coverage backend | 72,72%; mọi module `backend/sync` đạt từ 92,12% đến 100% |
| Secure frontend build | Đạt |
| Production package | Đạt, tạo được `release/biddingflow-production.zip` |
| `npm audit` | 0 lỗ hổng trong dependency npm |
| `pip-audit` | Không phát hiện lỗ hổng đã biết |
| Secret trong file Git theo dõi | Không phát hiện secret có độ tin cậy cao |
| Thử tải 16 concurrent, 4 worker | 524,44 request/giây; p95 53,7 ms; không lỗi |
| Thử tải 32 concurrent, 4 worker | 192,03 request/giây; 6 ReadTimeout; request chậm nhất trên 20 giây |

## 4. Điều kiện chặn phát hành hiện tại

Ứng dụng ở trạng thái **No-Go** cho tới khi document worker được kiểm chứng
ranh giới sandbox trên máy Linux staging tương đương production.

## 5. Giai đoạn P0 — Khắc phục blocker bảo mật

### 5.1. Cô lập xử lý tài liệu

**Công việc**

1. Chạy worker bằng UID/GID riêng, không cùng tài khoản với web service.
2. Đặt worker trong container hoặc systemd service riêng với:
   - read-only root filesystem;
   - thư mục job riêng, quyền `0700`;
   - network namespace không có egress;
   - giới hạn CPU, RAM, file size, file descriptor, process count;
   - seccomp/AppArmor/SELinux;
   - timeout và kill toàn bộ process tree.
3. Không mount source chứa secrets, file `.env`, backup hoặc Unix socket PostgreSQL vào worker.

**Test bắt buộc**

- Zip-slip, zip bomb, external relationship, encrypted OOXML, entity expansion và file hỏng.
- Worker cố mở socket, đọc `.env`, truy cập DB hoặc tạo child process phải thất bại.
- Worker bị kill/timeout không làm hỏng web process và không để file tạm tồn tại.

## 8. Giai đoạn P1 — Hạ tầng chặn tấn công và vận hành

### 8.1. Lớp biên

- Đặt CDN/WAF có chống DDoS phía trước Nginx.
- Bật managed rules cho OWASP Core Rule Set, bot/credential-stuffing và request anomaly.
- Rate limit riêng cho login, OTP, reset password, Google login, lookup, sync, upload và export.
- Giới hạn connection, body size, header size, timeout và WebSocket handshake.
- Chỉ mở 80/443; PostgreSQL, Prometheus và admin endpoint ở private network/VPN.

### 8.2. Quản lý bí mật

- Nạp secret production bằng secret manager hoặc file environment quyền `0600`
  ngoài thư mục ứng dụng.
- Cấp giá trị độc lập cho runtime DB, migrator DB, backup, SMTP, Google OAuth,
  email-outbox encryption và audit; thiết lập lịch rotate tối đa 90 ngày cùng quy
  trình revoke khẩn cấp.

### 8.3. Backup và phục hồi

- Kết nối job backup với kho offsite được mã hóa và bật
  immutability/object-lock; xác minh media/template cũng được sao chép.
- Bật timer backup/restore drill trên host đích và ghi nhận người phê duyệt
  RPO/RTO.
- Đưa backup trước thay đổi schema cùng rollback runbook thành release gate bắt
  buộc trong CI/CD production.

### 8.4. Quan sát và cảnh báo

- Triển khai cấu hình Prometheus/Grafana đã kiểm chứng lên staging/production,
  nối tất cả severity với receiver/on-call thực tế và chạy thử cảnh báo trước
  khi public.

## 9. CI/CD và kiểm thử bắt buộc

### 9.1. Pipeline cho mọi pull request

- Đẩy workflow lên GitHub, chạy xanh trên một pull request thật và lưu evidence
  artifact theo commit SHA.
- Bật branch protection bắt buộc workflow này đạt trước khi merge vào `main`.

### 9.2. Ma trận kiểm thử bảo mật

| Nhóm | Trường hợp tối thiểu |
|---|---|
| Authentication | brute force đồng thời, credential stuffing, session fixation, revoked session, idle/absolute expiry |
| Authorization | personal ↔ organization, former member, manager/employee, Super Admin, đổi role/gói, IDOR tenant chéo |
| CSRF/CORS | thiếu token, Origin/Referer sai, origin null, Host giả, preflight ngoài allowlist |
| XSS | stored/reflected/DOM XSS qua mọi trường text, import Excel và dữ liệu upstream |
| SQL | injection payload, identifier tampering, pagination cursor tampering |
| Upload | zip-slip, zip bomb, malformed OOXML, external link, image bomb, oversized/chunked body |
| SSRF | URL/redirect/DNS bất thường ở toàn bộ outbound connector |
| WebSocket | origin sai, session revoke, tenant switch, connection flood, broker replay |
| Business abuse | tăng quyền, dùng gói tổ chức ở personal scope, export không entitlement, quota race |

### 9.3. Kiểm thử tải staging

Chạy tối thiểu ba workload với dữ liệu mô phỏng đủ lớn:

1. **Steady state:** 60 phút ở tải dự kiến trung bình.
2. **Peak:** 15 phút ở 2 lần tải cao điểm dự kiến.
3. **Soak:** 8–24 giờ để phát hiện leak, bloat và queue backlog.

SLO ban đầu đề xuất:

- API đọc p95 dưới 300 ms, p99 dưới 800 ms.
- API ghi/sync p95 dưới 750 ms, p99 dưới 2 giây với payload chuẩn.
- Tỷ lệ lỗi không chủ ý dưới 0,1%.
- Không có ReadTimeout ở tải mục tiêu.
- Không vượt 70% ngân sách DB connection trong steady state.
- Không có queue tăng liên tục sau khi tải trở lại bình thường.

Các con số phải được điều chỉnh sau khi xác định tải kinh doanh thực tế, nhưng không được hạ chuẩn chỉ để làm bài test đạt.

## 10. Penetration test trước public

Sau khi hoàn thành P0/P1 và triển khai staging giống production:

1. Thực hiện DAST tự động trên toàn bộ endpoint.
2. Penetration test thủ công tập trung tenant escape, IDOR, role/subscription, account recovery, OAuth, file parser và WebSocket.
3. Kiểm tra cấu hình TLS, cookie, header, DNS, WAF bypass và origin server exposure.
4. Quét production artifact/SBOM độc lập với workspace phát triển.
5. Không còn phát hiện Critical hoặc High chưa xử lý; Medium phải có quyết định chấp nhận rủi ro bằng văn bản và thời hạn sửa.

## 11. Quy trình triển khai

### 11.1. Trước triển khai

- Release ID bất biến và commit/tag đã ký.
- CI xanh, production package hash đã lưu.
- Database fresh install/migration chạy bằng migrator role.
- Runtime role test đạt.
- Backup/restore drill đạt.
- Cấu hình production được kiểm tra tự động, không dùng giá trị placeholder.
- Runbook, on-call và dashboard đã sẵn sàng.

### 11.2. Triển khai canary

1. Triển khai một instance/nhóm người dùng nhỏ.
2. Theo dõi error, latency, DB pool, login, sync, WebSocket và audit.
3. Tăng lưu lượng theo từng bước 5% → 25% → 50% → 100%.
4. Dừng ngay khi vi phạm error budget hoặc xuất hiện lỗi phân quyền/dữ liệu.

### 11.3. Rollback

- Artifact cũ phải còn sẵn và có checksum.
- Thay đổi schema phải backward-compatible trong cửa sổ rollout hoặc có kế hoạch rollback đã thử.
- Không rollback bằng cách xóa dữ liệu production.
- Nếu có sự cố phân quyền/tenant leak: tắt endpoint liên quan, revoke session chịu ảnh hưởng, bảo toàn audit log và kích hoạt incident response.

## 12. Release gate Go/No-Go

Chỉ được **Go** khi tất cả điều kiện sau đạt:

- [ ] Toàn bộ P0 hoàn thành và có regression test.
- [ ] PostgreSQL xác minh TLS đầy đủ.
- [ ] Runtime DB role least-privilege được startup kiểm chứng.
- [ ] Document worker vượt qua test cô lập và không dùng pickle IPC.
- [ ] Staging load/soak test đạt SLO, không timeout.
- [ ] Backup và restore drill đạt RPO/RTO.
- [ ] CI, SAST, secret scan, dependency scan và SBOM đạt.
- [ ] Penetration test không còn Critical/High.
- [ ] WAF/CDN, firewall, monitoring và cảnh báo đã hoạt động.
- [ ] Giao diện và hợp đồng API không thay đổi ngoài phạm vi được phê duyệt.

Chỉ cần một điều kiện trên chưa đạt thì trạng thái vẫn là **No-Go**.

## 13. Thứ tự triển khai đề xuất

### Đợt 1 — Blocker bảo mật

1. Document worker IPC/sandbox.

### Đợt 2 — Authentication và tenant hardening

1. Argon2id, chính sách mật khẩu và quản lý phiên có thể thu hồi.
2. Runtime DB role và tenant test.
3. Trusted Types/XSS/media fail-closed.
4. Host/proxy hardening.

### Đợt 3 — Hiệu năng và vận hành

1. Profiling lỗi tại 32 concurrent.
2. Tối ưu session/query/index/pool.
3. Job nền, queue và WebSocket toàn cụm.
4. Compression, CDN/WAF, metrics và alert.

### Đợt 4 — Xác nhận phát hành

1. CI đầy đủ và production artifact scan.
2. Load, peak và soak test.
3. Restore drill.
4. Penetration test.
5. Canary và quyết định Go/No-Go.

## 14. Hồ sơ phải lưu sau khi hoàn thành

- Báo cáo dependency/SBOM và checksum artifact.
- Báo cáo test, coverage, load/soak và penetration test.
- Kết quả restore drill, RPO/RTO thực tế.
- Danh sách production environment variables không chứa giá trị secret.
- Sơ đồ quyền DB, firewall, WAF và luồng dữ liệu.
- Runbook incident, credential rotation, backup/restore và rollback.
- Biên bản Go/No-Go có người chịu trách nhiệm phê duyệt.
