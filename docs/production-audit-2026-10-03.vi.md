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

**Đã hoàn tất rà soát, sửa các lỗi nguồn đã xác minh và kiểm chứng local. Chưa
đủ điều kiện phát hành production.** API địa chỉ thật còn timeout/502; các gate
revision/CI và host/staging bên dưới cần được hoàn tất trước cutover.

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
| Python cuối | 3.012 passed, 2 skipped, 1 deselected; coverage 66,67%; ratchet 16 module đạt | Hai skip vì Windows không cấp quyền tạo symlink; một ca browser chạy qua gate riêng. Bản sửa fixture lifecycle sau khi khởi chạy full suite có owning batch 10 passed riêng. Deployment 83 passed; package contracts 25 passed |
| JavaScript | Full suite 2.318 passed, 0 failed/skipped; lines 58,16%, branches 68,23%, functions 70,38%; ratchet 14 module đạt. Bản sửa warming sau đó có 47 kiểm thử seam tập trung đạt | Full suite bao gồm persona/modal/address, chạy trước thay đổi 12 dòng tạo warm query. Warming có regression DOM/cache thật, empty/nonempty filter/alert, scope/deduplication và đo browser riêng; không gọi full suite đã chạy trên bản sửa warming |
| Chromium/Firefox/WebKit | Lượt đầu 100 passed, 2 allowed skips. Lượt persona: 98 passed, 2 allowed skips, 2 failed. Bundle modal cuối: 99 passed, 2 allowed skips, 1 failed | Menu responsive WebKit đạt sau sửa harness. Lỗi cuối là Chromium specialist không có province option khi API trả 502/timeout. Targeted specialist cùng bundle đạt 1/1 nhưng không thay kết quả aggregate. Hai skip là kiểm tra CDP touch chỉ hỗ trợ Chromium; các bài admin/procurement có fixture/mock |
| Domain journeys | Auth, offline, multi-assignee, low-price, liên danh và 12 ca pairwise đã đạt; liên danh nguyên harness đạt trên bundle có guard persona, gồm Word/DOCX, hợp đồng, nhiều lô và hai túi hồ sơ. UI quality, authenticated UI matrix 320/375/414/768/1280 px và bidder goods đạt; offline soak 5/5, WebSocket missed-hint hội tụ đạt. Bundle modal cuối: specialist, auth-shell và CRUD đạt; một lượt lifecycle contract-only nguyên assertions/timeouts đạt đủ evaluation/award/complete-liquidate/rebid/2-envelope/2-lot/plan snapshot | Fixture creator thiếu owner và thứ tự insert FK đã sửa; missing-owner deny được giữ. Timeout navigation ban đầu và hai lỗi đọc response upload chưa giải thích, không gọi đã sửa. Lifecycle live dừng vì provinces 502; probe riêng có provinces 200/34 sau 6.893 ms, wards timeout/502. Lượt contract-only chỉ giả lập hai endpoint địa chỉ, không thay kết quả live hoặc xác nhận provider |
| Static / secure build | Lượt cuối đạt; 171 bundle obfuscated, route CSS và private symbols được kiểm tra | Bao gồm các bản sửa persona/modal/address/fixture/warming cuối |
| Dependencies | npm full/runtime và pip: không có lỗ hổng đã biết tại thời điểm kiểm tra | Không thay thế rà soát nguồn hoặc kiểm chứng runtime |
| SBOM | npm/Python đã tạo trong `release` | Công cụ cảnh báo thiếu cạnh dependency của root component; không coi dependency graph đã hoàn chỉnh |
| Legal pages | `LEGAL_READINESS_OK` | Kiểm tra nội dung trang, không phải kết luận pháp lý |
| PostgreSQL | Fresh schema 98, 216 FK không thiếu index; dry-run migration rollback đạt | Local database, không phải grants/TLS/migration trên host thực |
| Admin dữ liệu lớn | Budget truy vấn và kích thước response đạt trên 10.000 account, 1.000 tổ chức và các tập audit/invoice lớn | Dữ liệu tổng hợp, transaction rollback |
| Restore thực tế | pg_dump, verify, signed database drill và full restore đạt schema 98; không FK chưa validate; cây template rỗng được khôi phục | Local disposable database/storage; không phải diễn tập offhost production |
| Artifact cuối | 893 runtime files, 894 ZIP entries sau bản sửa mở thầu; extracted-runtime smoke đạt | SHA-256 và manifest cập nhật ở phần bổ sung; không có `.md`, `.map`, `.env` thật, cache hoặc private symbols |
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
| P0 | Danh mục tỉnh/xã thật | Đã quan sát provinces/wards trả 502 với `BlockingIOTimeoutError`, thời gian request 10.096–10.322 ms; một probe khác trả 200/34 tỉnh sau 6.893 ms. [Log runtime đã lọc](../release/audit-20261003/address-runtime-evidence.json). Cần xác nhận upstream/network ở môi trường triển khai và chạy lại luồng thật; contract-only fixture không thay kết quả này |
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

Artifact hiện hành thay thế candidate có SHA `4f85a3a22b0a15a19f065065e5be2f9656d07e6af4865984433a9ec70f89f640`:

- ZIP `release/biddingflow-production.zip`, SHA-256
  `e42392de42986b2ad61194c45c284c53a0238a661e9fb630e3d59f0c37a93048`.
- Frontend release ID
  `03711e2b6b4fee4bb289b9fb96526be24797614c2ffaa879055eb30c6bf859be`.
- 893 runtime files / 894 ZIP entries; [identity và bằng chứng đối chiếu](../release/audit-20261003/opening-fix-artifact-identity.json).
- Chưa commit/push/deploy; các gate môi trường production còn mở ở trên giữ nguyên.

## Kết luận

Các bản sửa nguồn đã xác minh được triển khai trong candidate local và có
bằng chứng regression. Gói ZIP khớp byte từng file trong manifest với workspace
hiện hành, có checksum, SBOM dependency và extracted-runtime smoke đạt. Báo
cáo giữ đầy đủ các lượt kiểm chứng thất bại và giới hạn của fixture/mock.

Chưa phát hành production: cần khắc phục/xác minh đường truy cập API địa chỉ
thật và hoàn tất revision/CI, staging/host, dịch vụ ngoài và diễn tập rollback
đã liệt kê. Chưa commit, push hoặc triển khai bởi agent trong lượt này.

## Dọn tài nguyên thử

Bốn database audit riêng đã được xóa sau khi tất cả process thử kết thúc;
port 8027 không còn listener. Log/metrics đã lọc thông tin kết nối được giữ
trong `release/audit-20261003`. Tệp context chứa thông tin kết nối được xóa
riêng bằng công cụ chỉnh sửa tệp.

Lệnh dọn đệ quy các thư mục TEMP của lượt này bị cơ chế phê duyệt tự động
từ chối với thông báo `blocked by policy`, không có lý do cụ thể hơn. Các thư
mục browser storage, hai restore probe, ba thư mục trace lỗi trong TEMP và
các artifact `test-results` từ lượt browser cuối còn lại; không nằm trong ZIP
phát hành. Không xóa tài nguyên database/process của developer.
