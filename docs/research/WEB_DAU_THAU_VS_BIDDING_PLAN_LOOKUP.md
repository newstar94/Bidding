# Đối chiếu tra cứu `PL2600150284`: WEB_DAU_THAU và Bidding

- Ngày kiểm tra: 2026-08-16
- Phạm vi: chỉ nghiên cứu, không sửa production code, schema, test hoặc cấu hình.
- Mã nguồn WEB_DAU_THAU được kiểm tra tại commit [`0ccebd94a7819413730778ee9dec517a016cfbd0`](https://github.com/newstar94/WEB_DAU_THAU/tree/0ccebd94a7819413730778ee9dec517a016cfbd0), ngày 2026-08-11.
- Mã nguồn Bidding được kiểm tra tại commit `1e2f6e7f03b9be9fe0019f62cb6ef64979d01df3` và working tree hiện tại; các file được dẫn dưới đây là phiên bản đang chạy trong workspace.

## Kết luận

Hai hệ thống dùng cùng họ endpoint Mua Sắm Công cho bước tìm mã kế hoạch, nhưng không thực hiện cùng một khối lượng công việc sau khi tìm thấy mã.

WEB_DAU_THAU:

- tìm kiếm một lần;
- lấy danh sách phiên bản;
- lấy một `PLAN_DETAIL` cho mỗi phiên bản;
- hiển thị danh sách gói đã nằm trong `PLAN_DETAIL`.

Bidding khi mở luồng nhập kế hoạch mặc định:

- chọn `ALL` phiên bản;
- lấy `PLAN_DETAIL` cho từng phiên bản;
- lấy thêm `PLAN_PACKAGE_DETAIL` cho từng gói trong từng phiên bản;
- vì `includeLinkedNotices: true`, tiếp tục tra cứu đầy đủ từng TBMT được liên kết trong các gói, theo thứ tự.

Với dữ liệu thực tế đã lưu của `PL2600150284`, riêng phần kế hoạch là 116 nguồn (1 search + 1 version-list + 3 plan detail + 111 package detail). Revision `02` còn có 35 số TBMT liên kết khác nhau. Raw snapshot của chính wave đó ghi thêm 623 source thuộc 35 TBMT (588 thành công, 35 lỗi version-list loại `OTHER`), tức đồ thị đã quan sát là 739 source/envelope. Vì vậy, lượt nhập Bidding có thể chuyển từ vài request của WEB_DAU_THAU thành hơn một trăm request kế hoạch rồi thêm 35 chuỗi tra cứu TBMT nhiều request. Đây là lời giải thích phù hợp với hiện tượng WEB_DAU_THAU trả được còn Bidding báo quá thời gian.

Không có bằng chứng cho thấy mã `PL2600150284` bị sai hoặc endpoint tìm kiếm ban đầu khác nhau. Bằng chứng raw snapshot còn cho thấy một lượt thu thập toàn bộ phần kế hoạch đã hoàn tất 116/116 nguồn; điểm nghẽn có khả năng nằm ở đồ thị mở rộng và hạn thời gian của Bidding, không phải ở việc MSC không trả được kế hoạch.

## 1. Đồ thị request của WEB_DAU_THAU

### Tìm kiếm và chi tiết kế hoạch

Trong [`src/server.js`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js):

- `/api/search` tạo payload `smart/search`, lọc `type = es-plan-project-p`, rồi gọi đúng một lần (`:471-515`).
- `fetchPlanVersions()` gọi `.../get-version-list` (`:132-144`).
- `fetchPlanDetail()` chỉ gọi `.../get-by-id` với `{ id }` (`:146-148`).
- `collectVersionedDetails()` lặp qua các phiên bản và gọi một `PLAN_DETAIL` cho mỗi phiên bản (`:199-235`).
- `collectPlanCompleteBundle()` chỉ cấu hình version-list và plan-detail; không có bước plan-package-detail (`:238-250`).
- `/api/detail/complete` chỉ chọn collector của kế hoạch (`:537-566`).

Vì vậy, nếu MSC trả về ba phiên bản cho mã này, đồ thị của WEB_DAU_THAU là một search + một version-list + ba plan-detail. `PLAN_DETAIL` vốn đã chứa danh sách gói để giao diện hiển thị; phần render dùng `bidpPlanDetailToProjectList` (`src/public/index.html:1608-1617`).

### Không mở rộng sang TBMT liên kết

Trong code WEB_DAU_THAU không có bước tương đương `_enrich_linked_notices()` của Bidding trong luồng kế hoạch. Bundle kế hoạch chỉ lưu các source được thu thập ở collector kế hoạch và kết thúc bằng `finalizeCompleteBundle()` (`src/server.js:167-196`, `:238-250`).

### Chính sách chờ và lỗi

- Các `fetch()` API của WEB_DAU_THAU không gắn `AbortSignal.timeout`; helper `callProtectedMscApi()` chỉ thêm token/cookie và gọi fetch (`src/server.js:93-115`).
- Frontend WEB cũng gọi `/api/detail/complete` mà không truyền timeout/abort option riêng (`src/public/index.html:887-920`).
- Một source lỗi được ghi vào bundle rồi trả `null`; `captureBundleSource()` không làm hỏng toàn bộ bundle (`src/server.js:167-186`).
- Các chi tiết phiên bản trong endpoint `/api/detail/khlcnt/versions` cũng được thử tuần tự, nhưng lỗi một phiên bản chỉ ghi `success: false` cho phiên bản đó và vẫn trả các phiên bản còn lại (`src/server.js:594-647`).
- Timeout có giới hạn rõ ràng trong WEB_DAU_THAU chủ yếu nằm ở bước lấy token/browser: reachability 8 giây, navigation 20 giây và các bước reCAPTCHA 15–20 giây (`src/services/mscTokenProvider.js:19-29`, `:54-63`, `:109-175`). Đây không phải timeout cho toàn bộ chuỗi lấy chi tiết kế hoạch.

## 2. Đồ thị request của Bidding

### Luồng người dùng mặc định gọi `ALL` và bật TBMT liên kết

- Plan Import Wizard mặc định mode `ALL` (`frontend/procurement/PlanImportWizard.js:487-491`).
- Khi chuẩn bị preview, wizard gửi `revisionMode` và `includeLinkedNotices: true` (`frontend/procurement/PlanImportWizard.js:335-355`).
- Luồng tra cứu inline cũng ép `revisionMode: "ALL"` và `includeLinkedNotices: true` khi mã là `PLAN` (`frontend/procurement/ProcurementInlineLookup.js:125-136`).
- Client gửi request đến `/api/procurement/imports/plan/prepare` mà không thay đổi timeout mặc định (`frontend/procurement/ProcurementImportClient.js:28-40`).
- Server `prepare_plan()` với mode `ALL` gọi `_lookup_complete_bundle(..., kind="PLAN")`, sau đó gọi `_enrich_linked_notices()` cho từng revision (`backend/procurement_import/service.py:416-472`).

### Khối lượng của một bundle kế hoạch

`lookup_with_options()` luôn gọi search trước rồi gọi `collect_complete_bundle()` cho `COMPLETE` (`backend/integrations/muasamcong_browser/procurement_source.py:1017-1095`). Collector kế hoạch:

1. gọi `PLAN_VERSION_LIST` (`collectors.mjs:711-716`);
2. chọn revision theo `ALL`/`LATEST` (`collectors.mjs:168-179`, `:717-747`);
3. với mỗi revision gọi `PLAN_DETAIL` (`collectors.mjs:749-765`);
4. với từng package row gọi `PLAN_PACKAGE_DETAIL` (`collectors.mjs:766-803`).

Concurrency tồn tại nhưng không làm giảm số request: collector dùng tối đa 4 worker cho revision/package (`collectors.mjs:219-235`, `:749-767`), còn API client có tối đa 6 request đồng thời, queue 5 giây và circuit breaker (`api_client.mjs:40-75`, `:122-147`). Khi upstream chậm, các giới hạn queue/circuit này có thể làm lượt thu thập thất bại sớm hơn WEB_DAU_THAU.

### Bước mở rộng TBMT là khác biệt lớn nhất

`_enrich_linked_notices()` duyệt từng package theo từng revision. Với mỗi `noticeNo` mới, nó gọi một `COMPLETE` package lookup và chỉ cache theo số TBMT trong lượt hiện tại (`backend/procurement_import/service.py:214-230`). Không có thao tác này trong collector kế hoạch của WEB_DAU_THAU.

Một `COMPLETE` notice lookup của Bidding không phải một request đơn. Collector notice còn có thể gọi:

- hai version-list TBMT (`NOTICE_LDT_VERSION_LIST`, `NOTICE_OTHER_VERSION_LIST`);
- detail TBMT;
- tender info/HSMT và các sidecar tùy loại;
- version-list/detail kế hoạch liên kết;
- `PLAN_PACKAGE_DETAIL`;
- opening/result/technical sidecar khi dữ liệu có trạng thái tương ứng.

Đồ thị này thể hiện trực tiếp trong [`collectors.mjs:840-949`](../../backend/integrations/muasamcong_browser/collectors.mjs#L840), [`:949-1075`](../../backend/integrations/muasamcong_browser/collectors.mjs#L949) và [`:1080-1168`](../../backend/integrations/muasamcong_browser/collectors.mjs#L1080).

## 3. Bằng chứng riêng của `PL2600150284`

Đã đọc raw snapshot bất biến trong PostgreSQL của workspace, không sửa dữ liệu. Kết quả:

| Revision | `PLAN_DETAIL` | `PLAN_PACKAGE_DETAIL` | TBMT liên kết sau mapping |
|---|---:|---:|---:|
| `00` | 1 | 37 | 0 |
| `01` | 1 | 37 | 0 |
| `02` | 1 | 37 | 35 |
| Tổng | 3 | 111 | 35 số duy nhất |

Đối với 35 notice này, snapshot ghi thêm `623` source/envelope: `588` thành công và `35` lỗi (đều là nhánh `OTHER_VERSION_LIST`). Cộng với 116 source của plan, wave đã quan sát có `739` envelope; đây là số liệu thực tế của workspace, không phải ước lượng từ số package.

Manifest snapshot ghi:

```text
sourceCount = 116
successCount = 116
failedCount = 0
revisions = 00, 01, 02
packages = 111
operations = PLAN_VERSION_LIST, SEARCH, PLAN_DETAIL, PLAN_PACKAGE_DETAIL
```

Các source của lượt này được ghi từ `2026-08-15T16:51:30.135Z` đến `2026-08-15T16:51:44.294Z`; request cuối bắt đầu sau khoảng 14,2 giây. Kích thước JSON raw bundle dựng lại khoảng 1,95 MB. Do repository deduplicate theo source, các lần thử sau có thể không tạo thêm dòng; số liệu này chứng minh một lượt plan bundle đã chạy thành công, nhưng không tái dựng được chính xác lần demo nào đã trả lỗi timeout.

Điểm cần phân biệt:

- **Đã xác nhận:** phần plan graph (116 source) có thể hoàn tất và snapshot hiện có đầy đủ.
- **Đã xác nhận:** revision `02` có 35 package link khác nhau; prepare import sẽ đi qua `_enrich_linked_notices()`.
- **Đã xác nhận ở cấp route; nguyên nhân child-level có cơ sở cao:** hai request `prepare_plan_import` trả 504 đúng mốc 60 giây trong khi wave 35 TBMT còn tiếp tục. Điều này đặt timeout sau/in lúc mở rộng linked notices; chưa có trace để xác định child request cuối cùng.
- **Giới hạn còn lại:** log xác nhận route và deadline 504, nhưng không ghi source/envelope cuối cùng của từng request. Vì vậy chưa thể chỉ ra TBMT hoặc endpoint cụ thể nào là request cuối cùng của wave bị cắt; không nên khẳng định chi tiết đó nếu không có trace sâu hơn.

### Log 504 của đúng luồng prepare

[`data/logs/runtime.jsonl`](../../data/logs/runtime.jsonl) có hai bản ghi `POST prepare_plan_import` trả `504` sau gần đúng 60 giây (dòng `2764` và `2784`):

| Dòng log | Thời điểm UTC | Thời lượng |
|---:|---|---:|
| 2764 | `2026-08-15T16:52:26.644Z` | `60012.847 ms` |
| 2784 | `2026-08-15T16:54:43.743Z` | `60006.510 ms` |

Các bản ghi này xác nhận đây là timeout ở ranh giới HTTP `prepare_plan_import`, không phải thông báo `PROCUREMENT_NOT_FOUND`. Raw snapshot plan được ghi trong khoảng `16:51:30–16:51:44Z`; snapshot của 35 notice được ghi từ `16:51:45.572Z` đến `16:55:06.856Z`. Như vậy wave tra cứu notice còn tiếp tục ghi dữ liệu sau response 504 thứ hai khoảng 23 giây. Đây là bằng chứng trực tiếp rằng request HTTP đã hết hạn trong lúc công việc nền vẫn đang mở rộng linked notices.

## 4. Hạn thời gian của Bidding

Có nhiều lớp cùng tạo một deadline khoảng một phút:

- Mỗi request MSC bị abort sau 15 giây; mặc định có retry 1 lần cho lỗi mạng/429/5xx, nhưng `AbortError` do timeout bị ném ngay và không đi qua retry (`backend/integrations/muasamcong_browser/api_client.mjs:184-223`).
- Worker JSON-lines mặc định chờ tối đa 60 giây (`backend/integrations/muasamcong_browser/procurement_source.py:181-184`; áp vào `launchers.py:31-38`, `:121-135`).
- `/api/procurement/imports/plan/prepare` dùng `MUASAMCONG_REQUEST_TIMEOUT_SECONDS`, mặc định 60 giây và bị chặn trong khoảng 20–120 giây (`backend/procurement_import/routes.py:109-122`, `:1540-1559`).
- Transport trình duyệt cũng có timeout mặc định 60 giây (`frontend/shared/apiClient.js:35`, `:197-227`).

WEB_DAU_THAU không đặt deadline tương đương cho chuỗi plan detail. Vì vậy cùng một upstream chậm, WEB có thể tiếp tục chờ và trả bundle kế hoạch, còn Bidding có thể bị cắt khi vẫn đang xử lý package detail hoặc linked notice.

## 5. Những phần không khác đáng kể

- Hai repo đều dùng host `muasamcong.mpi.gov.vn`, index `es-contractor-selection`, keyword mã kế hoạch và filter loại kế hoạch.
- Payload search của Bidding (`collectors.mjs:92-109`) và WEB_DAU_THAU (`src/server.js:471-493`) có cùng nhóm field tìm kiếm chính.
- Cả hai đều dùng version-list công khai và plan detail có token cho endpoint chi tiết. Bidding chỉ thêm endpoint `PLAN_PACKAGE_DETAIL` (`endpoint_catalog.mjs:7-20`) và các chuỗi sidecar phục vụ import đầy đủ.

Do đó, khác biệt không nằm ở quy tắc nhận diện `PL2600150284` ở bước search; nó nằm ở mức “đầy đủ” của dữ liệu được yêu cầu, số lượng request phát sinh sau search, việc mở rộng TBMT liên kết và deadline tổng thể.

## Tài liệu nguồn

- [WEB_DAU_THAU `src/server.js`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js)
- [WEB_DAU_THAU `src/services/mscTokenProvider.js`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/services/mscTokenProvider.js)
- [Bidding `collectors.mjs`](../../backend/integrations/muasamcong_browser/collectors.mjs)
- [Bidding `procurement_source.py`](../../backend/integrations/muasamcong_browser/procurement_source.py)
- [Bidding import service](../../backend/procurement_import/service.py)
- [Bidding import routes](../../backend/procurement_import/routes.py)
- [Bidding API client](../../backend/integrations/muasamcong_browser/api_client.mjs)
- [Bidding frontend API transport](../../frontend/shared/apiClient.js)
- [Bidding raw snapshot repository](../../backend/procurement_raw.py)
- [Observed runtime records](../../data/logs/runtime.jsonl)
