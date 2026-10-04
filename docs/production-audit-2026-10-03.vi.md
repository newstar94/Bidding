# Rà soát và khắc phục trước phát hành — 03/10/2026

## Phạm vi và trạng thái

Rà soát BiddingFlow trong `D:\Bidding`, bắt đầu từ HEAD
`bf72199e6b7a9f2e49174197e5e92d24cc02bb94` với working tree sạch.
HEAD chuyển sang `5b06123e06bd8986f4c35694d39b856beb434239` trong quá trình
rà soát, chứa các bản sửa đã kiểm chứng trước đó. Agent không thực hiện commit,
push hoặc triển khai. Bản sửa persona khi xuất, cache/hộp thoại địa chỉ,
fixture pairwise/lifecycle, làm ấm tab, kiểm thử responsive và báo cáo/ADR còn trong working tree;
identity cuối được ghi kèm artifact.
Kết quả được kiểm chứng bằng database và thư mục thử riêng.
Khi chuẩn bị lại gói phát hành, HEAD hiện hành là
`57551979db0565d9870067c496195370c175ba9a`; các commit phát sinh bên ngoài
agent. Các sửa đổi bổ sung về chờ tra cứu/nhập mở thầu và báo cáo vẫn cần
được chốt vào revision phát hành. Agent tiếp tục không commit/push/deploy.

**Đã hoàn tất rà soát, sửa các lỗi nguồn đã xác minh và kiểm chứng local. Chưa
đủ điều kiện phát hành production.** Luồng mở thầu trên bundle cuối đã lưu
PostgreSQL và dựng đánh giá sau đăng nhập lại; địa chỉ thật đạt trong lượt
cuối. Các gate revision/CI và host/staging bên dưới cần hoàn tất trước cutover.

## Lỗi đã xác định và khắc phục

| Nhóm | Nguyên nhân và bản sửa | Bằng chứng |
|---|---|---|
| Đồng bộ nhiều tab | Giữ base snapshot khi gộp IndexedDB, không hồi sinh xóa đã được xác nhận, gộp partial patch theo trường và giữ full import từ tab khác khi gặp stale patch | Tái hiện trước sửa; 61 kiểm thử outbox/transaction/serializer tập trung đạt |
| Đăng xuất | Máy chủ chỉ xác nhận sau commit thu hồi phiên/audit; lỗi trước commit trả 503 và giữ cookie. Giao diện chỉ discard/purge sau xác nhận; giữ hàng đợi, workspace và capability khi thất bại | Fault injection, kiểm thử handler thật và rà soát độc lập |
| Xác thực | Vô hiệu link reset/setup cũ khi đổi mật khẩu/email thực sự; kiểm tra lại phiên trong transaction. Khóa account trước session/token, kiểm tra expiry sau khi chờ khóa; lỗi websocket sau commit không làm mất kết quả đổi mật khẩu | 67 kiểm thử tập trung và 7 race PostgreSQL thực tế; các ca lỗi đã đỏ trước sửa |
| Thanh toán | Đồng nhất khóa owner → order; callback cũ không ghi đè lease đã được claim lại nhờ token riêng mỗi claim | 123 kiểm thử PostgreSQL tập trung, không skip |
| Tác vụ Word | Sửa kiểu trả về danh sách, tên khóa scope và chọn đủ policy/hash bất biến cho kiểm tra quyền | Kiểm thử route/service và quyền đọc tác vụ |
| Snapshot xuất Word | Sau save, push ACK/route bootstrap partial không nâng cursor. Trước xuất chờ complete workspace pull và kiểm tra lại workspace/persona/pending; giữ stale gate | Tái hiện cursor 38/ACK 42 và đổi persona trong cùng workspace token; 76 regression export/pull đạt; browser gửi 42 → 202/tải 200 và DOCX inspection đạt |
| Công thức Word | Thay vòng lặp theo từng ngày bằng số học tuần/ngày nghỉ và tìm nhị phân. Giữ quy ước chiều âm, ngày nghỉ, working weekend và lỗi vượt biên | 32 regression; 876 đối chiếu độc lập. Full-range difference 4,701 s → 0,000020 s trên máy thử |
| Phân công | Áp dụng quyết định chủ sản phẩm cho người nhận mới và người nhận đã lưu, qua single/batch/id-only delete; giữ ngoại lệ Super Admin và kế thừa nguyên trạng do máy chủ tạo | Xem ADR 0045 và kiểm thử seam phân công |
| URL PostgreSQL | Decode tên database trước encode URL dịch vụ hoặc truyền cho pg_dump/pg_restore | Regression tên có khoảng trắng, ký tự phần trăm và tiếng Việt |
| Backup/restore | Phân biệt cây rỗng/cây thiếu, khôi phục tài sản qua swap/rollback, dùng đúng storage ngoài release và kiểm tra completeness, rollback khi bị ngắt và bảo toàn identity target trên POSIX | 83 kiểm thử deployment tập trung và 25 package contracts đạt; pg_dump, signed drill và full restore schema 98 trên database thử đạt |
| Preflight triển khai | Tính ngân sách kết nối từ Environment mặc định của unit và các EnvironmentFile có thứ tự, phân tích ExecStart thực và từ chối cờ resource trùng | 43 kiểm thử owning preflight đạt; parser Uvicorn thực xác nhận override |
| Cache địa chỉ | HTTP 200 sai cấu trúc không được ghi thành danh sách phường/xã rỗng vĩnh viễn; trả lỗi 502 hiện hành và cho phép lấy lại. Danh sách rỗng hợp lệ và mọi trường hợp lệ được giữ | 7 ca lỗi đỏ trước sửa, 2 control hợp lệ; 10 kiểm thử address/lookup đạt. Chưa có bằng chứng lỗi cache này gây timeout hộp thoại |
| Hộp thoại đối tác | Không chờ danh mục tỉnh/xã trước khi mở; chuẩn bị trường đầy đủ rồi tải danh mục riêng. Giữ địa chỉ đã lưu, raw address, dữ liệu nhập mới, readonly và bỏ completion thuộc form/DOM cũ | Tái hiện promise pending khiến opens=0; 5 kiểm thử owning đạt, gồm 8 ca entry/navigation và 15 ca deferred catalog trên DOM thật. Validation/storage/quyền giữ nguyên |
| Kiểm thử menu quản trị | Chờ handler breakpoint 992 px hoàn tất trước khi đọc/toggle menu sau resize | Trace cũ chứng minh race của harness; owning WebKit responsive đạt 1/1, giữ timeout 10 giây và một lần click. Không sửa UI/CSS production |
| Fixture tổ chức | Fixture liên danh, pairwise và lifecycle ghi người tạo manager làm owner của tổ chức thử mới; tạo account trước organization để giữ FK. Lifecycle employee fixture giữ nguyên owner NULL | Red/green owning fixture; lifecycle + pairwise + liên danh 10 kiểm thử đạt. Không backfill tổ chức cũ; missing-owner deny production giữ nguyên |
| Làm ấm tab dữ liệu | Tham số warm query của Kế hoạch/Gói thầu/Hợp đồng khớp bộ lọc serialize của renderer; Gói thầu giữ dashboard alert hiện hành. Không đổi canonical cache key, scope hoặc invalidation | DOM renderer thật tái hiện 3 request trùng/skeleton sau warm; 47 kiểm thử warming/pagination tập trung đạt, gồm 6 ca empty/nonempty filters và alert. Browser cuối đạt: 6 warm requests, click không thêm request/skeleton, max 29,9 ms |
| Mở thầu chờ phản hồi | Chặn collect/stage khi workspace, gói, form hoặc số lượng/thứ tự/identity dòng thay đổi lúc tra cứu; ACK cũ không repaint/điều hướng gói mới. Giữ canonical repaint cùng gói. Cleanup nút nhập thuộc lượt cũ sau khi rời tab/đổi gói, không reset lượt mới | Các ca đỏ đã tái hiện; 103 regression tập trung và full JavaScript cuối đạt. Bundle thật qua hai thứ tự mount, sync/PostgreSQL và đăng nhập lại đều dựng đủ dữ liệu |

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
| Python cuối | Full suite 2.992 passed, 22 skipped, 1 deselected; coverage 66,68%; ratchet 16 module đạt. Rerun owning batch PostgreSQL 40 passed, 0 skipped, gồm đủ 20 ca trước đó thiếu URL thử | Full suite chạy ba database riêng schema 98; 11 ca lot scope và 9 ca webhook đã chạy lại trên database riêng mới. Chỉ còn hai ca symlink cần quyền Windows; browser marker được chạy qua gate riêng. Không cộng các ca SQLite chạy lại thành tổng full suite mới |
| JavaScript cuối | Full suite 2.335 passed, 0 failed/skipped; lines 58,36%, branches 68,27%, functions 70,53%; ratchet 14 module đạt | Chạy trên source cuối sau mọi sửa đổi mở thầu. Bao gồm sáu ca Chromium source/module thật, bảy ca save async và ba ca import retry/ownership. Log tại `release-prep-js-final.log` |
| Chromium/Firefox/WebKit | Lượt đầu 100 passed, 2 allowed skips. Lượt persona: 98 passed, 2 allowed skips, 2 failed. Bundle modal cuối: 99 passed, 2 allowed skips, 1 failed | Menu responsive WebKit đạt sau sửa harness. Lỗi cuối là Chromium specialist không có province option khi API trả 502/timeout. Targeted specialist cùng bundle đạt 1/1 nhưng không thay kết quả aggregate. Hai skip là kiểm tra CDP touch chỉ hỗ trợ Chromium; các bài admin/procurement có fixture/mock |
| Domain journeys | Auth, offline, multi-assignee, low-price, liên danh và 12 ca pairwise đã đạt; liên danh nguyên harness đạt trên bundle có guard persona, gồm Word/DOCX, hợp đồng, nhiều lô và hai túi hồ sơ. UI quality, authenticated UI matrix 320/375/414/768/1280 px và bidder goods đạt; offline soak 5/5, WebSocket missed-hint hội tụ đạt. Bundle modal cuối: specialist, auth-shell và CRUD đạt; một lượt lifecycle contract-only nguyên assertions/timeouts đạt đủ evaluation/award/complete-liquidate/rebid/2-envelope/2-lot/plan snapshot | Fixture creator thiếu owner và thứ tự insert FK đã sửa; missing-owner deny được giữ. Timeout navigation ban đầu và hai lỗi đọc response upload chưa giải thích, không gọi đã sửa. Lifecycle live dừng vì provinces 502; probe riêng có provinces 200/34 sau 6.893 ms, wards timeout/502. Lượt contract-only chỉ giả lập hai endpoint địa chỉ, không thay kết quả live hoặc xác nhận provider |
| Static / secure build | Lượt cuối đạt; 172 bundle obfuscated, route CSS và private symbols được kiểm tra | Bao gồm mọi sửa đổi mở thầu cuối; module graph, lint bảo mật, vendor và legal gate đạt |
| Dependencies | npm full/runtime và pip: không có lỗ hổng đã biết tại thời điểm kiểm tra | Không thay thế rà soát nguồn hoặc kiểm chứng runtime |
| SBOM | npm/Python đã tạo trong `release` | Công cụ cảnh báo thiếu cạnh dependency của root component; không coi dependency graph đã hoàn chỉnh |
| Legal pages | `LEGAL_READINESS_OK` | Kiểm tra nội dung trang, không phải kết luận pháp lý |
| PostgreSQL | Fresh schema 98, 216 FK không thiếu index; dry-run migration rollback đạt | Local database, không phải grants/TLS/migration trên host thực |
| Admin dữ liệu lớn | Budget truy vấn và kích thước response đạt trên 10.000 account, 1.000 tổ chức và các tập audit/invoice lớn | Dữ liệu tổng hợp, transaction rollback |
| Restore thực tế | pg_dump, verify, signed database drill và full restore đạt schema 98; không FK chưa validate; cây template rỗng được khôi phục | Local disposable database/storage; không phải diễn tập offhost production |
| Artifact cuối | 894 runtime files, 895 ZIP entries; extracted-runtime smoke đạt trên database riêng mới | ZIP khớp byte từng runtime file với workspace; SHA-256/manifest tại phần chuẩn bị phát hành cuối. Không có `.md`, `.map`, `.env` thật, cache hoặc private symbols |
| Mở thầu bundle cuối | Hai thứ tự mount đều đạt: nhập → lưu thật → đánh giá → mở lại → đóng browser → đăng nhập mới → đọc canonical. Đúng giá gốc/giảm giá, rowVersion 1 và trạng thái Đang chấm thầu; nháp gói ẩn được giữ | Nguồn prepare/apply được inject xác định; sync/commit PostgreSQL và reload thật. Không coi đó là live fetch Mua Sắm Công hoặc deployment production. Địa chỉ không mock: provinces 200/34 và wards Hà Nội 200/126; không page error hoặc API failure |
| Startup cuối | Bundle warming: 30 cold + 30 warm đạt; p95 cold 1.568 ms, warm 80 ms, max 1.603/311 ms; không ghi nhận long task từ 50 ms | Ngưỡng giữ nguyên 2.100/450/100 ms, chạy sau khi các gate nặng đã kết thúc; local route `/admin`, metadata đo releaseId=`unknown`, bundle phục vụ được xác nhận riêng là `05a9d75…`. Không suy ra hiệu năng mọi workspace/host |
| Mở tab đầu tiên cuối | Gate đạt trên bundle `05a9d75…`: sáu bảng mỗi bảng một warm request, toàn bộ first/repeat click không thêm pagination/skeleton, không lỗi runtime. Max first 29,9 ms, repeat 12,3/12,2 ms | Red ban đầu do exact-query mismatch; giữ cửa sổ warming 5 giây và ngưỡng 100 ms. Dữ liệu thử local, không suy ra mọi workspace/host |

## Các gate còn thiếu trước production

| Ưu tiên | Hạng mục | Trạng thái và bằng chứng cần có |
|---|---|---|
| P0 | Chốt release và CI | Candidate có hash ZIP/manifest và danh sách bản sửa chưa commit. Cần chốt revision phát hành và chạy CI đầy đủ trên đúng revision trước cutover; agent không tự commit/push |
| P0 | Linux document worker | Unit/coordinator/parser sandbox đã có trong repo; cần chạy bằng service identities thực, verify sandbox/IPC/mount/ACL và hoàn tất job Word trên staging Linux |
| P0 | Database dịch vụ | Cần runtime/migrator/backup/worker role thật, effective grants/ownership/search path, TLS verify-full và ngân sách kết nối theo max_connections của host |
| P0 | Storage và restore | Cần encrypted/private volumes, owner/group, shared storage khi nhiều instance, offhost retention và diễn tập restore/rollback với RPO/RTO thật |
| P0 | Ingress và phiên HTTPS | Cần DNS/TLS/public origin, trusted proxy/host/cookie, firewall/tunnel/NGINX và live/ready từ ingress thực |
| P0 | Deploy và rollback staging | Cần dùng đúng artifact cuối, smoke read-only/login/Word, asset compatibility và rollback có log từ Linux; local package smoke không thay thế |
| P0 | Danh mục tỉnh/xã trên host triển khai | Lượt cũ có 502/timeout; lượt cuối trên bundle hiện hành không mock đạt provinces 200/34, wards Hà Nội 200/126 ở cả hai journey. Probe allowlist HTTPS cũng đạt; chưa xác định thêm lỗi source gây timeout. Cần xác nhận đường mạng/upstream trên host thực; một lượt local đạt không chứng minh độ ổn định production. Bảo toàn cả [log cũ](../release/audit-20261003/address-runtime-evidence.json) và [journey cuối](../release/audit-20261003/release-prep-opening-bundle.json) |
| P1 | Provider ngoài còn lại | SMTP/OAuth/Turnstile/payOS và Mua Sắm Công cần chứng minh bằng cấu hình và luồng thật; fixture/mock chỉ chứng minh contract local |
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
46 đường dẫn được đọc đầy đủ, tổng inventory 1.776 file. [Báo cáo native](../release/audit-20261003/security-report.md),
[findings](../release/audit-20261003/security-findings.json),
[coverage](../release/audit-20261003/security-coverage.json),
[scan manifest](../release/audit-20261003/security-scan-manifest.json).
Telemetry native trả về measurement `complete`: tổng 90.663.348 token từ 11
thread, gồm 85.998.464 cached-input và 361.803 output. Đây là số tool ghi nhận,
không phải ước tính chi phí hoặc số token chỉ của lượt trả lời này.

## Identity của artifact thử phát hành trước bản sửa mở thầu

- HEAD nền: `bf72199e6b7a9f2e49174197e5e92d24cc02bb94`; HEAD hiện tại: `5b06123e06bd8986f4c35694d39b856beb434239`, kèm các bản sửa cuối chưa commit được liệt kê/hash trong receipt.
- ZIP: `release/biddingflow-production.zip` — SHA-256 `4f85a3a22b0a15a19f065065e5be2f9656d07e6af4865984433a9ec70f89f640`.
- Frontend release ID: `05a9d75be2b9d96d5e1d6110380515211f90902a4e98fc858ff31b09d8625785`. ID này chỉ bao phủ input frontend; backend được ràng buộc bởi ZIP và hash từng file trong manifest.
- Production manifest SHA-256: `25cffa35f1d682a1d4f9c06377d75a473c0913c332574a1904f8e5d2ec6d0de0`.
- Secure-build marker SHA-256: `859ba3cd1534464f3d0214c34d49d6d8bd4dd27240f30e0b8de340fef28ac264`.
- Vite manifest SHA-256: `36152bdbbc0fa9d4bfe8f818244a8c248d26a18a98f05591b445652837ea0a0d`.
- [Hash và inventory](../release/audit-20261003/artifact-identity.json), [bằng chứng restore](../release/audit-20261003/restore-evidence.json). Log local đã lọc thông tin kết nối thử nghiệm tại `release/audit-20261003`.

## Bổ sung: nhập/lưu mở thầu và báo cáo trắng ngày 03/10/2026

Theo báo lỗi của chủ sản phẩm, Chromium chạy loader/module thật đã tái hiện:
tab Mở thầu độc lập và Chi tiết gói cùng mounted làm nhập/đọc nhầm bảng ẩn;
form không còn dòng vẫn persist trạng thái Đang chấm thầu và báo thành công;
nguồn chỉ có pha tài chính xóa bảng kỹ thuật đang nhập. Đã sửa bằng resolver
thuộc tab active, đọc dòng đúng tbody, kiểm tra form rỗng trước mọi thay đổi
gói/xóa bản ghi và giữ nháp khi nguồn không có nhà thầu kỹ thuật. Contract,
compatibility và regression seams được bổ sung trong ADR 0048.

Giao dịch READ ONLY và mapper/child serializer thật xác nhận
`IB2600271932`: nguồn 1 nhà thầu, lưu 1; `IB2600267838`: nguồn 202 dòng,
lưu 202; liên kết nhà thầu hợp lệ toàn bộ. Không sửa/backfill dữ liệu developer.
Metadata đánh giá schema 1 hợp lệ; đối chứng trình duyệt dựng được 1 và 202
dòng, nên chưa xác nhận lỗi dữ liệu máy chủ của phiên bị báo trắng. Chưa nhận
mã TBMT từ chủ sản phẩm để đối chiếu chính xác phiên đó. Log 15:50–17:20 có
một lỗi lấy nguồn 502 và hai lần WebSocket reconnect; không đủ chứng minh
nguyên nhân khung báo cáo trắng vì lỗi refresh chỉ được ghi console.

Kiểm chứng bản sửa:

- 137 kiểm thử JavaScript tập trung đạt, gồm 6 ca Chromium: prepare/apply
  → nhập → lưu → đánh giá → mở lại biên bản; cả hai thứ tự mount; bảo toàn
  nháp gói khác; form mất dòng giữ nguyên bản ghi và không phát sinh xóa;
  nguồn tài chính giữ dòng, giá, thời gian và preview đang nhập.
- 48 kiểm thử backend opening/source/snapshot/serializer đạt; không thay
  backend trong bản sửa này. Browser dùng client nguồn/sync xác định, không
  coi đó là fetch upstream hay commit end-to-end trên production.
- Toàn bộ lint bảo mật, module graph, build secure, vendor, route CSS và
  legal production gate đạt. HTTP từ server developer source mode trả đúng
  byte của cả ba file sửa. Cần tải lại trang để nạp module mới.
- ZIP mới khớp byte mọi runtime file với workspace. Bản giải nén boot smoke
  đạt trên database mới riêng; database và thư mục thử được dọn sau kiểm tra.
  Các full-suite/CI/restore trước đó không được coi là đã chạy lại toàn bộ.

Candidate của lượt sửa mở thầu đầu, đã được thay thế trong lượt chuẩn bị phát hành cuối:

- ZIP `release/biddingflow-production.zip`, SHA-256
  `e42392de42986b2ad61194c45c284c53a0238a661e9fb630e3d59f0c37a93048`.
- Frontend release ID
  `03711e2b6b4fee4bb289b9fb96526be24797614c2ffaa879055eb30c6bf859be`.
- 893 runtime files / 894 ZIP entries; [identity và bằng chứng đối chiếu](../release/audit-20261003/opening-fix-artifact-identity.json).
- Chưa commit/push/deploy; các gate môi trường production còn mở ở trên giữ nguyên.

## Chuẩn bị phát hành cuối: chốt source và kiểm tra artifact

Đã tái hiện và sửa thêm các lỗi chờ phản hồi: đổi workspace/gói trong lúc
tra cứu có thể collect vào state mới; ACK có thể điều hướng lại gói cũ hoặc
bị bỏ qua khi canonical repaint cùng gói; thêm/reorder dòng trong lúc chờ
có thể lưu snapshot thiếu dòng; rời tab hoặc đổi gói khi nhập nguồn có thể
để nút bị khóa. Regression đỏ trước sửa và kiểm tra độc lập xác nhận các
fence/cleanup mới bảo toàn quyền, hiển thị và validation. Xem ADR 0048.

Bằng chứng trên source và bundle cuối:

- [Full JavaScript](../release/audit-20261003/release-prep-js-final.log):
  2.335 passed; [focused opening](../release/audit-20261003/release-prep-opening-focused.log):
  103 passed. Không lỗi/skip.
- [Full Python](../release/audit-20261003/release-prep-python-result.json):
  2.992 passed/22 skipped/1 deselected, coverage 66,68%, ratchet đạt;
  [PostgreSQL bổ sung](../release/audit-20261003/release-prep-postgres-extra.log)
  đạt 40/40, gồm đủ 20 ca skip do thiếu URL thử. Hai skip symlink Windows
  được giữ nguyên; không nới expectation hoặc quyền để hợp thức hóa.
- [Bundle journey](../release/audit-20261003/release-prep-opening-bundle.json)
  và [dữ liệu PostgreSQL](../release/audit-20261003/release-prep-opening-database.json):
  giá 1.250.000/1.350.000, sau giảm 1.125.000/1.215.000, rowVersion 1;
  sau đăng nhập mới cả hai bảng đánh giá vẫn có một nhà thầu. Nguồn import
  được inject; save/sync/canonical reload là thật. Danh mục địa chỉ là live.
- Harness được hiệu chỉnh đúng contract: chờ controller workspace sau
  auth reload, loại input phụ do thư viện select dựng, và đọc toast thành
  công hiện hành. Fixture OPENED được bổ sung hiệu lực HSDT bắt buộc và reset
  riêng trước journey. Các lỗi harness/fixture này không được tính là lỗi
  production hoặc đổi validation/UX để cho phép dữ liệu thiếu.
- [Static cuối](../release/audit-20261003/release-prep-static-final.log),
  [secure build](../release/audit-20261003/release-prep-build-final.log),
  [legal/package](../release/audit-20261003/release-prep-package.log) và
  [extracted-runtime smoke](../release/audit-20261003/release-prep-artifact.log)
  đạt. Smoke boot từ byte giải nén và database thử mới; không dùng developer DB.

Artifact cuối thay thế mọi candidate cũ:

- ZIP `release/biddingflow-production.zip`, SHA-256
  `d0d26447db43c53df0a174e32946ff9e6a73c463bcea9f7c98796acd9d2b1685`.
- Frontend release ID
  `75ae952e7c038f702b530ffce64a860e190b3405ddd251b8e603e24caa15d0c7`.
- 894 runtime files / 895 ZIP entries, 172 bundle obfuscated.
- [Identity và kiểm tra từng byte](../release/audit-20261003/release-prep-artifact-identity.json),
  [checksum ZIP](../release/biddingflow-production.zip.sha256).
- HEAD nền hiện hành `57551979db0565d9870067c496195370c175ba9a`; các sửa đổi
  cuối chưa được chốt vào revision CI. Không có migration/backfill mới.

## Kiểm tra và khắc phục CI GitHub tại HEAD 5755197

Đã đối chiếu API GitHub và log/artifact của đúng revision
`57551979db0565d9870067c496195370c175ba9a`. HEAD local và `main` GitHub
vẫn là revision này; các sửa đổi cuối chưa commit/push.

- [Full CI](https://github.com/newstar94/Bidding/actions/runs/37124151498)
  thất bại tại bước Cross-browser Playwright matrix: 99 passed, 1 failed,
  2 allowed skips. Python, JavaScript, static, secure build, schema/FK,
  package/dependency và startup performance đạt. Platform Admin budget,
  full role/workflow E2E và analytics journey chưa chạy do bước trước lỗi;
  job xuất artifact bị skip. CodeQL và N+1 query regressions đạt.
- Ca lỗi Chromium đọc thân phản hồi 409 qua CDP trả
  `Network.getResponseBody: No data found`; trace cho thấy ứng dụng vẫn
  xử lý đúng xung đột phiên bản. Firefox/WebKit của cùng ca đã đạt trên CI.
  Sửa riêng harness `e2e/specs/row-conflict-reload.spec.mjs`: đọc phản hồi
  máy chủ thật qua `route.fetch()` trước khi giao nguyên byte cho trình
  duyệt. Giữ barrier A chờ B commit, `waitForResponse` và budget 10 giây,
  so khớp status upstream/browser, cùng các assertion 409/error/id,
  editor/toast và canonical reload. Không đổi production, timeout, retry
  hoặc workflow. Rà soát độc lập không phát hiện vấn đề mới.
- [Supply-chain security](https://github.com/newstar94/Bidding/actions/runs/37124151497)
  đạt dependency audit nhưng secret scan báo hai false positive trong
  lời gọi helper giới hạn đổi mật khẩu ở commit `bf72199e…`, dòng
  1427/1430. Chỉ thêm hai fingerprint chính xác vào `.gitleaksignore`;
  không bỏ rule hoặc thu hẹp phạm vi quét. Gitleaks 8.30.1 cùng phiên bản
  CI đạt exit 0, không finding: 950 commit ancestry HEAD và 966 commit
  toàn bộ refs local. Dùng `GIT_ATTR_NOSYSTEM=1` riêng cho process thử để
  tránh Word textconv của máy developer; không sửa cấu hình Git người dùng.
- [Owning E2E trên bản sửa cuối](../release/audit-20261003/ci-row-conflict-three-browser.json)
  đạt 3/3 Chromium, Firefox, WebKit; 0 fail/skip/flaky, retries 0.
  Chạy bundle secure với server, tài khoản và PostgreSQL riêng; phản hồi
  xung đột và save/reload là thật. Database thử đã xóa, server 8045 đã dừng.
  Lượt đầu cũng đạt 3/3; sau đó bổ sung lại response-event budget nguyên
  bản và chạy lại cả ba trình duyệt để chốt đúng byte sửa cuối.
- [Đối chiếu artifact](../release/audit-20261003/ci-artifact-recheck.json):
  894 runtime files vẫn khớp từng byte workspace, SHA-256 ZIP vẫn là
  `d0d26447db43c53df0a174e32946ff9e6a73c463bcea9f7c98796acd9d2b1685`;
  không có Markdown, source map hoặc `.env` thật trong ZIP. Sửa CI chỉ
  ảnh hưởng harness/ignore/tài liệu nên không cần build lại runtime.

[Snapshot workflow](../release/audit-20261003/github-ci-current-snapshot.json),
[snapshot từng job/bước](../release/audit-20261003/github-ci-jobs-snapshot.json),
[log owning E2E](../release/audit-20261003/ci-row-conflict-three-browser.log),
[Gitleaks toàn bộ refs](../release/audit-20261003/gitleaks-full-history-after-ignore.log)
và [Gitleaks HEAD](../release/audit-20261003/gitleaks-ci-head-history-after-ignore.log)
được giữ làm bằng chứng. Hai nguyên nhân CI đã được sửa và xác minh local;
chưa có kết quả GitHub cho revision chứa bản sửa mới. Cần chốt/push revision
được chủ sản phẩm cho phép rồi theo dõi toàn bộ workflow đến kết quả cuối.

Hai database CI riêng đã xóa và port 8045 không còn listener; backend
developer 8000 và PostgreSQL 55432 vẫn hoạt động. Helper thử đã xóa.
Cơ chế phê duyệt tự động từ chối dọn đệ quy hai thư mục runtime CI trong
`scratch` với thông báo `blocked by policy`, không nêu lý do cụ thể.
Hai thư mục còn lại ngoài ZIP; không coi việc dọn thư mục đã hoàn tất.

## Kết luận

Các bản sửa nguồn đã xác minh được triển khai trong candidate local và có
bằng chứng regression. Gói ZIP khớp byte từng file trong manifest với workspace
hiện hành, có checksum, SBOM dependency và extracted-runtime smoke đạt. Báo
cáo giữ đầy đủ các lượt kiểm chứng thất bại và giới hạn của fixture/mock.

Chưa phát hành production: cần xác minh đường truy cập API địa chỉ trên host
thực và hoàn tất revision/CI, staging/host, dịch vụ ngoài và diễn tập rollback
đã liệt kê. Chưa commit, push hoặc triển khai bởi agent trong lượt này.

## Dọn tài nguyên thử

Lượt chuẩn bị phát hành cuối đã xóa năm database riêng (ba lane Python,
một database bổ sung/package smoke và một opening journey). Server bundle
8043 đã dừng, tệp fixture riêng và các thư mục runtime của lượt này đã xóa;
[receipt cleanup](../release/audit-20261003/release-prep-cleanup.json) được giữ.
Backend developer 8000 PID 18508 và PostgreSQL 55432 PID 35268 vẫn hoạt động.

Bốn database audit riêng đã được xóa sau khi tất cả process thử kết thúc;
port 8027 không còn listener. Log/metrics đã lọc thông tin kết nối được giữ
trong `release/audit-20261003`. Tệp context chứa thông tin kết nối được xóa
riêng bằng công cụ chỉnh sửa tệp.

Lệnh dọn đệ quy các thư mục TEMP của lượt này bị cơ chế phê duyệt tự động
từ chối với thông báo `blocked by policy`, không có lý do cụ thể hơn. Các thư
mục browser storage, hai restore probe, ba thư mục trace lỗi trong TEMP và
các artifact `test-results` từ lượt browser cuối còn lại; không nằm trong ZIP
phát hành. Không xóa tài nguyên database/process của developer.
