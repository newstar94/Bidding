# Rà soát và khắc phục trước phát hành — 03/10/2026

## Phạm vi và trạng thái

Rà soát BiddingFlow trong `D:\Bidding`, bắt đầu từ HEAD
`bf72199e6b7a9f2e49174197e5e92d24cc02bb94` với working tree sạch.
Các bản sửa hiện nằm trong working tree; chưa commit, push hoặc triển khai.
Kết quả được kiểm chứng bằng database và thư mục thử riêng.

**Báo cáo đang được cập nhật trong lượt kiểm chứng cuối.** Các trạng thái chờ
dưới đây không phải bằng chứng phát hành đã đạt.

## Lỗi đã xác định và khắc phục

| Nhóm | Nguyên nhân và bản sửa | Bằng chứng |
|---|---|---|
| Đồng bộ nhiều tab | Giữ base snapshot khi gộp IndexedDB, không hồi sinh xóa đã được xác nhận, gộp partial patch theo trường và giữ full import từ tab khác khi gặp stale patch | Tái hiện trước sửa; 61 kiểm thử outbox/transaction/serializer tập trung đạt |
| Đăng xuất | Máy chủ chỉ xác nhận sau commit thu hồi phiên/audit; lỗi trước commit trả 503 và giữ cookie. Giao diện chỉ discard/purge sau xác nhận; giữ hàng đợi, workspace và capability khi thất bại | Fault injection, kiểm thử handler thật và rà soát độc lập |
| Xác thực | Vô hiệu link reset/setup cũ khi đổi mật khẩu/email thực sự; kiểm tra lại phiên trong transaction. Khóa account trước session/token, kiểm tra expiry sau khi chờ khóa; lỗi websocket sau commit không làm mất kết quả đổi mật khẩu | 67 kiểm thử tập trung và 7 race PostgreSQL thực tế; các ca lỗi đã đỏ trước sửa |
| Thanh toán | Đồng nhất khóa owner → order; callback cũ không ghi đè lease đã được claim lại nhờ token riêng mỗi claim | 123 kiểm thử PostgreSQL tập trung, không skip |
| Tác vụ Word | Sửa kiểu trả về danh sách, tên khóa scope và chọn đủ policy/hash bất biến cho kiểm tra quyền | Kiểm thử route/service và quyền đọc tác vụ |
| Snapshot xuất Word | Sau save, push ACK/route bootstrap partial không nâng cursor. Trước xuất chờ complete workspace pull và kiểm tra lại workspace/persona/pending; giữ stale gate | Tái hiện cursor 38/ACK 42; 63 regression export/caller đạt; browser gửi 42 → 202/tải 200 và DOCX inspection đạt |
| Công thức Word | Thay vòng lặp theo từng ngày bằng số học tuần/ngày nghỉ và tìm nhị phân. Giữ quy ước chiều âm, ngày nghỉ, working weekend và lỗi vượt biên | 32 regression; 876 đối chiếu độc lập. Full-range difference 4,701 s → 0,000020 s trên máy thử |
| Phân công | Áp dụng quyết định chủ sản phẩm cho người nhận mới và người nhận đã lưu, qua single/batch/id-only delete; giữ ngoại lệ Super Admin và kế thừa nguyên trạng do máy chủ tạo | Xem ADR 0045 và kiểm thử seam phân công |
| URL PostgreSQL | Decode tên database trước encode URL dịch vụ hoặc truyền cho pg_dump/pg_restore | Regression tên có khoảng trắng, ký tự phần trăm và tiếng Việt |
| Backup/restore | Phân biệt cây rỗng/cây thiếu, khôi phục tài sản qua swap/rollback, dùng đúng storage ngoài release và kiểm tra completeness | Đang hoàn tất gate sau rà soát độc lập; đã có pg_dump/restore thực tế schema 98 trên database thử |
| Preflight triển khai | Tính ngân sách kết nối từ Environment mặc định của unit và các EnvironmentFile có thứ tự; tránh báo 29/40 khi unit thực dùng 56/40 | Regression effective environment; gate cuối đang chạy |

### Quyết định nghiệp vụ được xác nhận trong lượt này

- Chỉ quản lý cao nhất được tạo, sửa, chuyển hoặc xóa phân công của các quản lý khác.
- Giữ ngoại lệ Super Admin nền tảng hiện có.
- Tổ chức cũ chưa xác định quản lý cao nhất phải chặn các thao tác trên; không tự gán owner hồi tố.
- Giữ kế thừa nguyên trạng phân công do máy chủ tạo khi sinh phiên bản.

Các quyền tenant/module/record/assignment khác và hiển thị đầy đủ dữ liệu của
bản ghi được phép đọc được bảo toàn. Entitlement Word vẫn chỉ kiểm soát export.
Không thêm masking hoặc capability đọc dữ liệu nhạy cảm.

## Kiểm chứng

| Gate | Kết quả hiện tại | Giới hạn |
|---|---|---|
| Python cuối | 2.973 passed, 2 skipped, 1 deselected; coverage 66,65%; ratchet 16 module đạt | Hai skip vì Windows không cấp quyền tạo symlink; một ca browser chạy qua gate riêng. Script triển khai sau sửa cuối: 83 passed; package contracts 25 passed |
| JavaScript cuối | 2.314 passed, 0 failed/skipped; lines 58,18%, branches 68,19%, functions 70,39%; ratchet 14 module đạt | Lượt trước chạy xuyên quá trình thêm regression đỏ 38→42 không được coi là final gate. Một kiểm thử trợ lý chờ cố định 500 ms đã đổi sang chờ đúng kết quả |
| Chrome/Firefox/Safari | 100 passed, 2 allowed skips; không unexpected skip | Hai skip là thao tác CDP touch dành riêng Chromium. Có ca mock API và fixture procurement, không phải upstream thật |
| Domain journeys | Auth, offline và multi-assignee đã đạt; timeout navigation liên danh ban đầu chưa tái hiện. Lượt có trace đi qua navigation rồi gặp `EXPORT_SNAPSHOT_STALE` (38/42) | Đang chẩn đoán thời điểm sync/export; giữ nguyên timeout và stale-snapshot gate. Các hành trình phía sau chưa được coi đạt |
| Static / secure build | Đã đạt; 171 bundle obfuscated, route CSS và private symbols được kiểm tra | Cần static cuối sau tất cả bản sửa |
| Dependencies | npm full/runtime và pip: không có lỗ hổng đã biết tại thời điểm kiểm tra | Không thay thế rà soát nguồn hoặc kiểm chứng runtime |
| SBOM | npm/Python đã tạo trong `release` | Công cụ cảnh báo thiếu cạnh dependency của root component; không coi dependency graph đã hoàn chỉnh |
| Legal pages | `LEGAL_READINESS_OK` | Kiểm tra nội dung trang, không phải kết luận pháp lý |
| PostgreSQL | Fresh schema 98, 216 FK không thiếu index; dry-run migration rollback đạt | Local database, không phải grants/TLS/migration trên host thực |
| Admin dữ liệu lớn | Budget truy vấn và kích thước response đạt trên 10.000 account, 1.000 tổ chức và các tập audit/invoice lớn | Dữ liệu tổng hợp, transaction rollback |
| Restore thực tế | pg_dump, verify, signed database drill và full restore đạt schema 98; không FK chưa validate; cây template rỗng được khôi phục | Local disposable database/storage; không phải diễn tập offhost production |
| Artifact cuối | 892 runtime files, 893 ZIP entries; extracted-runtime smoke đạt | SHA-256 và manifest được ghi dưới đây; không có `.md`, `.map`, `.env` thật, cache hoặc private symbols |

## Các gate còn thiếu trước production

| Ưu tiên | Hạng mục | Trạng thái và bằng chứng cần có |
|---|---|---|
| P0 | Linux document worker | Unit/coordinator/parser sandbox đã có trong repo; cần chạy bằng service identities thực, verify sandbox/IPC/mount/ACL và hoàn tất job Word trên staging Linux |
| P0 | Database dịch vụ | Cần runtime/migrator/backup/worker role thật, effective grants/ownership/search path, TLS verify-full và ngân sách kết nối theo max_connections của host |
| P0 | Storage và restore | Cần encrypted/private volumes, owner/group, shared storage khi nhiều instance, offhost retention và diễn tập restore/rollback với RPO/RTO thật |
| P0 | Ingress và phiên HTTPS | Cần DNS/TLS/public origin, trusted proxy/host/cookie, firewall/tunnel/NGINX và live/ready từ ingress thực |
| P0 | Deploy và rollback staging | Cần dùng đúng artifact cuối, smoke read-only/login/Word, asset compatibility và rollback có log từ Linux; local package smoke không thay thế |
| P1 | Provider ngoài | SMTP/OAuth/Turnstile/payOS và Mua Sắm Công cần chứng minh bằng cấu hình và luồng thật được chủ hệ thống cấp; fixture/mock chỉ chứng minh contract local |
| P1 | Browser worker dưới systemd | Cần kiểm chứng Node/Chromium với W^X, namespace và process policy của web unit; chưa có host Linux để kết luận runtime tương thích |
| P1 | Coverage bảo mật | Nguồn bảo mật được ưu tiên rà soát và có bằng chứng cụ thể; chưa rà soát thủ công toàn bộ mọi file. Không kết luận ứng dụng không còn lỗ hổng |

## Báo cáo bảo mật

Scan `e7980866-3f72-4504-883d-2d542e6f239f` giữ năm finding đã được xác minh từ
nguồn ban đầu: recovery token sau credential rotation, session authority race,
logout chưa thu hồi bền vững, CPU calendar formula và hierarchy phân công đã
được chủ sản phẩm xác nhận. Bốn finding đầu mức medium; hierarchy mức low.
Các bản sửa hiện tại và
bằng chứng regression được ghi riêng, không xóa finding vì đã sửa.
Coverage thủ công là **partial**; mapping kiến trúc, tìm kiếm và test không được
tính thành đã security-review toàn bộ file. Native scan đã complete và sealed;
46 đường dẫn được đọc đầy đủ, tổng inventory 1.776 file. [Báo cáo native](../../release/audit-20261003/security-report.md),
[findings](../../release/audit-20261003/security-findings.json),
[coverage](../../release/audit-20261003/security-coverage.json),
[scan manifest](../../release/audit-20261003/security-scan-manifest.json).
Telemetry native trả về measurement `complete`: tổng 90.663.348 token từ 11
thread, gồm 85.998.464 cached-input và 361.803 output. Đây là số tool ghi nhận,
không phải ước tính chi phí hoặc số token chỉ của lượt trả lời này.

## Identity của artifact thử phát hành

- HEAD nền: `bf72199e6b7a9f2e49174197e5e92d24cc02bb94`, kèm các bản sửa chưa commit.
- ZIP: `release/biddingflow-production.zip` — SHA-256 `770ec7b53d518324dbe5c1e776c38d655eb3f972458d1ec08e02128e01c60e4a`.
- Frontend release ID: `f27fdb30c1283b729b1be93eb07fdd1ee02734a3c1ca4de089f2ccfcc54e77fe`. ID này chỉ bao phủ input frontend; backend được ràng buộc bởi ZIP và hash từng file trong manifest.
- Production manifest SHA-256: `b01f273937c9ba332d2f53b43ace55ec68c4e1f600c7422b4f3e94fc65d14d2e`.
- Secure-build marker SHA-256: `8bab0606f118c6703ae41c86d6594f30fbe1d7ead15f2966cb324d06627f37eb`.
- Vite manifest SHA-256: `6cb0dce8977ba35e7af60d7440d0c3beb1d1d946e03b9494b284efa705d07890`.
- [Hash và inventory](../../release/audit-20261003/artifact-identity.json), [bằng chứng restore](../../release/audit-20261003/restore-evidence.json). Log local đã lọc thông tin kết nối thử nghiệm tại `release/audit-20261003`.

## Điều kiện chốt

Hoàn tất các gate local còn lại, ghi identity/hash artifact và giữ nguyên các
blocker host/external ở trên. Chỉ gọi production-ready sau khi bằng chứng từ
staging/production host đáp ứng các gate; không suy ra từ build hoặc unit test.
