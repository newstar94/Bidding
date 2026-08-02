# Báo cáo kiểm thử toàn bộ ứng dụng BiddingFlow

**Ngày kiểm thử:** 02/08/2026  
**Môi trường:** Development cục bộ  
**URL:** `http://127.0.0.1:8000`  
**Nguồn yêu cầu:** `PROMPT_KIEM_THU_TOAN_BO_UNG_DUNG.md`

## 1. Kết luận điều hành

Các logic nghiệp vụ cốt lõi đã kiểm tra có độ ổn định tốt. Các luồng phân quyền, CRUD, hình thức/phương thức lựa chọn nhà thầu, phân lô, liên danh, mở thầu, đánh giá, báo cáo chi tiết, ưu đãi hàng hóa, phê duyệt kết quả, hợp đồng và đồng bộ ngoại tuyến đều đạt trong phạm vi được hệ thống hỗ trợ.

Chưa nên coi bản hiện tại là sẵn sàng phát hành production vì còn ba gate chưa đạt:

1. Hai lỗi khả năng truy cập bằng bàn phím trên giao diện đăng nhập/dashboard.
2. Bộ kiểm tra production bị lỗi do thiếu tệp `docs/production-security-information.md`.
3. Kịch bản vòng đời cũ chưa được cập nhật để chọn trường bắt buộc “Yêu cầu thẩm định HSMT”. Thao tác thật trên giao diện với trường này được chọn đã phát hành thành công.

Không phát hiện lỗi Critical/Blocker trong logic đấu thầu, phân lô, liên danh, báo cáo đánh giá chi tiết hoặc tính ưu đãi đã kiểm tra.

## 2. Cách kiểm thử

- Điều khiển trực tiếp giao diện bằng trình duyệt tại localhost.
- Chạy tuần tự các kịch bản trình duyệt E2E có sẵn trong dự án.
- Đối chiếu dữ liệu giao diện với dữ liệu PostgreSQL trong các fixture E2E.
- Kiểm tra độc lập công thức ưu đãi ở backend và frontend.
- Kiểm tra xuất Word/Excel và đọc lại cấu trúc tệp xuất.
- Chạy toàn bộ kiểm thử Python và JavaScript.
- Kiểm tra mobile, bàn phím, responsive, lỗi console, tệp tải lên và đồng bộ ngoại tuyến.

Cơ chế Turnstile trên máy chủ kiểm thử chính được tắt tạm thời ở cấp tiến trình để các kịch bản đăng nhập tự động không bị chặn. Tệp `.env` không bị sửa. Turnstile được kiểm tra riêng trên môi trường cô lập với đầy đủ các tình huống pass, fail, interactive, slow, script-failure và auto-pending; tất cả đều đạt.

## 3. Vai trò và phân quyền

Ứng dụng hiện có ba vai trò nền tảng thực tế:

| Vai trò | Phạm vi đã kiểm tra | Kết quả |
|---|---|---|
| Super Admin | Tổng quan hệ thống, quản lý tài khoản, chuyển vai trò, giám sát đơn vị | PASS |
| Quản lý | Toàn bộ nghiệp vụ đơn vị, nhân sự, phân quyền, phân công, CRUD, cấu hình | PASS |
| Chuyên viên | Dữ liệu được tạo hoặc được phân công, giới hạn sửa/xóa và tài sản workspace | PASS |

Các đối tượng chủ đầu tư, nhà thầu, chuyên gia, thành viên liên danh và thành viên đứng đầu liên danh là thực thể nghiệp vụ, không phải vai trò đăng nhập riêng trong phiên bản hiện tại.

Các kiểm tra phân quyền đã đạt:

- Chặn trang và API khi chưa đăng nhập.
- Từ chối thông tin đăng nhập sai.
- Menu đúng theo vai trò sau tải lại, Back/Forward và nhiều tab.
- Quản lý thêm, sửa, xóa chuyên viên.
- Chuyển workspace và lưu đúng phiên phía máy chủ.
- Chặn CSRF, origin sai và mass assignment.
- Stored XSS được hiển thị như văn bản.
- Thu hồi quyền chuyên viên có hiệu lực ngay.
- Thành viên rời đơn vị và workspace bị khóa không còn truy cập.
- Thay thế, hết hạn và thu hồi phiên đăng nhập.
- Đổi mật khẩu, đặt lại mật khẩu một lần và đăng xuất.
- Người ngoài nhận `404`; người bị thu hồi nhận `403`; người còn được phân công nhận `200`.

## 4. Ma trận hình thức, phương thức và lĩnh vực gói thầu

Đã tạo và đối chiếu PostgreSQL 15 tổ hợp pairwise:

| Phạm vi | Giá trị đã kiểm tra | Kết quả |
|---|---|---|
| Lĩnh vực | Hàng hóa, Xây lắp, Tư vấn, Phi tư vấn, Hỗn hợp | PASS |
| Hình thức | Đấu thầu rộng rãi, Đấu thầu hạn chế, Chào hàng cạnh tranh, Chỉ định thầu, Chỉ định thầu rút gọn, Lựa chọn nhà thầu trong trường hợp đặc biệt | PASS |
| Phương thức | Một giai đoạn một túi, Một giai đoạn hai túi, Hai giai đoạn một túi, Hai giai đoạn hai túi, Không áp dụng cho hình thức đặc biệt/rút gọn | PASS |
| Phương pháp đánh giá | Giá thấp nhất, Giá đánh giá, Kết hợp kỹ thuật và giá, Dựa trên kỹ thuật, Giá cố định | PASS |
| Phân lô | Không phân lô; phân 2 lô | PASS |

Các hình thức “Mua sắm trực tiếp”, “Tự thực hiện”, “Tham gia thực hiện của cộng đồng” và “Đàm phán giá” không có trong danh sách lựa chọn của giao diện hiện tại nên được phân loại `NOT SUPPORTED`, không phải `NOT TESTED`.

## 5. Phân lô, không phân lô, độc lập và liên danh

| Tình huống | Kết quả |
|---|---|
| Không phân lô, nhà thầu độc lập | PASS |
| Không phân lô, liên danh 3 thành viên | PASS |
| Phân lô, một hàng hóa mỗi lô | PASS |
| Phân lô, nhiều hàng hóa trong một lô | PASS |
| 20 lô/20 phạm vi dự thầu | PASS |
| Liên danh tham dự hai lô | PASS |
| Liên danh thắng lô 1, nhà thầu độc lập thắng lô 2 | PASS |
| Dữ liệu và kết quả độc lập theo lô | PASS |
| Một giai đoạn hai túi với liên danh và nhà thầu độc lập | PASS |
| Chặn thành viên liên danh trùng | PASS |
| Một thành viên đứng đầu, ba thành viên được lưu và tải lại | PASS |
| Thành viên liên danh được đưa đúng vào báo cáo/kết quả/hợp đồng | PASS |

Kết quả đối chiếu fixture liên danh:

- 2 dòng mở thầu, 3 thành viên, đúng 1 thành viên đứng đầu ở gói không phân lô.
- 3 dòng mở thầu trên 2 lô; mỗi phạm vi liên danh có đủ 3 thành viên.
- Lô `JV-L1` thuộc liên danh; lô `JV-L2` thuộc nhà thầu độc lập.
- Gói một giai đoạn hai túi chỉ đưa nhà thầu đạt kỹ thuật vào mở tài chính.

## 6. Vòng đời đầu-cuối

Các bước đã được kiểm tra qua thao tác trực tiếp hoặc E2E:

`Đăng nhập → tạo chủ đầu tư → tạo nhà thầu → tạo chuyên gia → tạo kế hoạch → tạo gói thầu → thêm hàng hóa → phát hành HSMT → mở thầu → đánh giá → xử lý giá thấp bất thường → báo cáo chi tiết → phê duyệt kết quả → xuất báo cáo → tạo hợp đồng → tải lại và xác minh`

Kịch bản tự động `test:lifecycle` dừng tại phát hành vì không chọn trường “Yêu cầu thẩm định HSMT”. Mã ứng dụng hiện yêu cầu trường này có một trong ba trạng thái rõ ràng. Kiểm tra trực tiếp đã chọn “Không”, điền dữ liệu hợp lệ, xác nhận phát hành và nhận kết quả:

- Trạng thái chuyển từ `Chuẩn bị` sang `Đang mời thầu`.
- Thời gian đăng tải và đóng thầu được lưu đúng.
- Số/ngày tờ trình và quyết định được lưu đúng.
- Giá trị bảo đảm dự thầu và hiệu lực HSDT được chấp nhận.
- Không có lỗi console.

Phần từ mở thầu đến hợp đồng được chạy đầy đủ trong kịch bản liên danh và đạt.

## 7. Báo cáo đánh giá chi tiết

| Nội dung | Kết quả |
|---|---|
| Báo cáo tổng hợp và báo cáo chi tiết | PASS |
| Đánh giá kỹ thuật đạt/không đạt | PASS |
| Hai cột giá đánh giá và giá xếp hạng | PASS |
| Giới hạn điểm/ngưỡng và kết luận kỹ thuật | PASS |
| Báo cáo theo nhà thầu và phạm vi lô | PASS |
| Quyết định chấp nhận/từ chối giá dưới 50% | PASS |
| Nhà thầu bị từ chối không được xếp hạng/trúng thầu | PASS |
| Thay đổi từ từ chối sang chấp nhận và xếp hạng lại | PASS |
| Biên đúng 50% không kích hoạt cảnh báo | PASS |
| Lưu, tải lại, đăng nhập lại vẫn giữ kết quả | PASS |
| Xuất Excel báo cáo đánh giá | PASS |
| Xuất Excel kết quả lựa chọn nhà thầu | PASS |
| Xuất Word báo cáo kết quả và đọc lại cấu trúc | PASS |

Tệp Word xuất thực tế có 18 đoạn, font Arial, kích thước 35.674 byte. Tệp Excel đánh giá có hai sheet `Danh gia HSDT` và `Dropdowns`; tệp kết quả có hai sheet `Ket Qua LCNT` và `Dropdowns`.

## 8. Kiểm thử ưu đãi hàng hóa

Hệ thống hiện hỗ trợ mã ưu đãi hàng hóa từ 0 đến 5 với hệ số gốc:

| Mã | Hệ số gốc | Kết quả |
|---|---:|---|
| 0 | 0% | PASS |
| 1 | 7,5% | PASS |
| 2 | 10% | PASS |
| 3 | 10% | PASS |
| 4 | 12% | PASS |
| 5 | 15% | PASS |

Đã kiểm tra:

- Tính chênh lệch so với mức ưu đãi cao nhất trong phạm vi.
- Tính theo thành tiền của từng dòng, không dùng nhầm tổng giá mở thầu.
- Đơn giá và thành tiền sau ưu đãi được dẫn xuất, không cho sửa trực tiếp.
- Làm tròn `HALF_UP`.
- Số nguyên vượt giới hạn an toàn của JavaScript vẫn tính chính xác.
- Áp dụng sau giảm giá và dùng đúng cơ sở sau giảm giá.
- Sai lệch tổng trong dung sai 1 VNĐ được chấp nhận; ngoài dung sai bị từ chối.
- Nhập Mẫu 15A, tiêu đề động, alias, sheet không phân biệt hoa/thường và header nhiều dòng.
- Không tự gán khi trùng tên hàng hóa giữa các lô mà thiếu phạm vi lô.
- Cảnh báo mapping mơ hồ hoặc không khớp.
- Thay đổi mã ưu đãi cập nhật ngay kết quả và xóa cảnh báo cũ.
- Lưu chính thức đồng bộ hàng hóa và dòng mở thầu trong cùng batch.
- Thất bại khi lưu khôi phục snapshot trước nhập.
- Xếp hạng dùng đúng giá sau ưu đãi/giá xếp hạng theo quy tắc hệ thống.
- Không để trạng thái tính ưu đãi của lô này ảnh hưởng lô khác.
- Xuất Excel trung hòa formula injection.

Kết quả kiểm tra độc lập: 19/19 kiểm thử Python và 58/58 kiểm thử JavaScript chuyên biệt về ưu đãi, hàng hóa dự thầu, giá đánh giá và xuất hàng hóa trúng thầu đều đạt. Các kiểm thử này cũng nằm trong tổng kiểm thử logic bên dưới.

## 9. CRUD, tệp, phân công và đồng bộ

| Phạm vi | Kết quả |
|---|---|
| Chủ đầu tư: tạo/sửa/validation/xóa | PASS |
| Nhà thầu: tạo/sửa/tải lại/xóa | PASS |
| Chuyên gia: tạo/sửa/tìm kiếm/phân trang/xóa | PASS |
| Kế hoạch: tạo/sửa/xóa mọi phiên bản | PASS |
| Gói thầu: tạo/sửa/tải lại/xóa mọi phiên bản | PASS |
| Hợp đồng: tạo/sửa/tải lại/xóa | PASS |
| PDF hợp lệ: tải lên/tải xuống/xóa | PASS |
| Tệp giả mạo/quá dung lượng | PASS — bị từ chối |
| Tên tệp được làm sạch | PASS |
| Phân công nhiều người, thêm/bớt và kế thừa phiên bản | PASS |
| Nhật ký và thông báo phân công | PASS |
| Hai người sửa cùng bản ghi, `row_version` xung đột | PASS — trả `409` |
| Mất mạng, kết nối lại, gửi lại không tạo trùng | PASS |

## 10. Responsive và khả năng truy cập

Đạt:

- CRUD mobile ở 390×844 không tràn ngang.
- Bảng chuyển sang dạng card trên mobile.
- Nút thêm vẫn hiển thị.
- Touch target đăng nhập và Google đạt kích thước tối thiểu của kịch bản.
- Tab hỗ trợ Arrow, Home, End và roving focus.
- Bảng hàng hóa, báo cáo chi tiết và các vùng cuộn không gây tràn ngang trong các kiểm thử chuyên biệt.

Không đạt:

- Nhấn Enter tại trường mật khẩu khi tên đăng nhập đang trống không chuyển focus về trường tên đăng nhập đầu tiên bị lỗi.
- Skip-link trên dashboard authenticated có viền focus 1px, thấp hơn tiêu chuẩn 2px được kịch bản accessibility yêu cầu.

## 11. Tổng hợp kết quả chạy

| Bộ kiểm tra | Kết quả |
|---|---|
| Auth roles E2E | PASS |
| Package pairwise E2E — 15 tổ hợp | PASS |
| Joint venture E2E | PASS |
| Bidder goods & preference E2E | PASS |
| Low-price conflict E2E | PASS |
| CRUD modules E2E | PASS |
| Multi-assignee E2E | PASS |
| Offline sync E2E | PASS |
| Auth shell E2E | PASS |
| Turnstile local matrix | PASS |
| Full lifecycle E2E | FAIL do kịch bản thiếu lựa chọn thẩm định; thao tác thật tương ứng PASS |
| UI quality E2E | FAIL — lỗi focus đăng nhập |
| Authenticated UI matrix | FAIL — viền focus skip-link 1px |
| Python suite | 310 PASS, 1 FAIL do thiếu tệp tài liệu production |
| JavaScript suite | 270 PASS, 0 FAIL |

## 12. Danh sách lỗi

### QA-001 — Không focus trường tên đăng nhập bị thiếu

- **Mức độ:** Medium
- **Vai trò:** Chưa đăng nhập
- **Màn hình:** `/dang-nhap`
- **Thiết bị:** Mobile 320×720; kịch bản kiểm tra cũng tái hiện ở `mobile-320`
- **Bước tái hiện:**
  1. Mở màn hình đăng nhập.
  2. Để trống tên đăng nhập và mật khẩu.
  3. Focus trường mật khẩu.
  4. Nhấn Enter.
- **Thực tế:** Form không hợp lệ nhưng focus vẫn ở `#login-password`.
- **Mong đợi:** Focus chuyển tới `#login-username`, là trường bắt buộc bị thiếu đầu tiên.
- **Ảnh hưởng:** Người dùng bàn phím và công nghệ hỗ trợ khó xác định trường cần sửa.
- **Bằng chứng:** `test-results/qa-evidence/login-invalid-focus-mobile-320.png` và lỗi `test:ui-quality-e2e`.

### QA-002 — Viền focus skip-link chỉ dày 1px

- **Mức độ:** Low
- **Vai trò:** Người dùng đã đăng nhập
- **Màn hình:** Dashboard tại viewport 320px
- **Bước tái hiện:**
  1. Đăng nhập.
  2. Bỏ focus hiện tại.
  3. Nhấn Tab đầu tiên.
  4. Kiểm tra computed style của `.skip-link.workspace-skip-link`.
- **Thực tế:** `outline-width: 1px`, `outline-style: solid`.
- **Mong đợi:** Chỉ báo focus đã duyệt có độ dày tối thiểu 2px.
- **Ảnh hưởng:** Chỉ báo focus khó nhìn hơn với người dùng bàn phím.
- **Bằng chứng:** Lỗi `test:authenticated-ui-matrix` tại `320:dashboard`.

### QA-003 — Thiếu biểu mẫu thông tin bảo mật production

- **Mức độ:** High đối với quy trình phát hành; không ảnh hưởng runtime development
- **Phạm vi:** Release/production readiness
- **Thực tế:** `npm test` lỗi vì không có `docs/production-security-information.md`.
- **Mong đợi:** Tệp tồn tại và bao phủ mọi input triển khai bên ngoài mà không chứa secret.
- **Ảnh hưởng:** CI/release gate không xanh; chưa chứng minh đủ thông tin triển khai production.
- **Bằng chứng:** 310 kiểm thử Python đạt, 1 kiểm thử `test_production_information_form_covers_every_external_input_without_secrets` lỗi `FileNotFoundError`.

### QA-004 — Kịch bản vòng đời chưa chọn trường thẩm định bắt buộc

- **Mức độ:** Medium đối với độ tin cậy của QA automation; không phải lỗi runtime
- **Phạm vi:** `scripts/verify_full_lifecycle.mjs`
- **Thực tế:** Kịch bản điền các trường phát hành nhưng không chọn radio `phathanh-yeucauthamdinh`; modal không đóng và hết thời gian chờ.
- **Mong đợi:** Kịch bản chọn `REQUIRED` hoặc `NOT_REQUIRED` trước khi xác nhận.
- **Kiểm tra đối chứng:** Chọn “Không” trên giao diện thật đã phát hành thành công và chuyển trạng thái đúng.

## 13. Phạm vi chưa kiểm tra hoặc không được hỗ trợ

### NOT SUPPORTED

- Mua sắm trực tiếp.
- Tự thực hiện.
- Tham gia thực hiện của cộng đồng.
- Đàm phán giá.
- Vai trò đăng nhập riêng cho chủ đầu tư, nhà thầu hoặc thành viên liên danh.
- Ký số, thanh toán hoặc phát hành thông báo ra hệ thống bên ngoài.

### NOT TESTED

- Trình duyệt Safari và Firefox thật; các kịch bản E2E dùng Chromium.
- Gửi email thật qua SMTP bên ngoài.
- Đăng nhập Google với tài khoản thật.
- Production public URL, reverse proxy và TLS thực tế.
- Tải lớn kéo dài hoặc soak test nhiều giờ.
- Kiểm thử pháp lý đối chiếu trực tiếp với văn bản quy phạm hiện hành; báo cáo này xác minh logic mà ứng dụng đang triển khai, không xác nhận tính tuân thủ pháp luật.

## 14. Dữ liệu và bằng chứng

Các fixture E2E thành công đã tự dọn dẹp. Còn lại một bộ dữ liệu từ kịch bản vòng đời bị dừng, sau đó được dùng để kiểm tra phát hành trực tiếp:

- Run ID: `E2E-1785682224808`
- Gói thầu: `E2E-1785682224808-GT`
- Trạng thái hiện tại: `Đang mời thầu`
- Các thực thể liên quan: chủ đầu tư, nhà thầu, hai chuyên gia, kế hoạch và hàng hóa có cùng run ID.

Có thể tìm theo chuỗi `E2E-1785682224808` và xóa sau khi không còn cần đối chứng.

Bằng chứng lưu tại:

- `test-results/qa-evidence/publish-success.png`
- `test-results/qa-evidence/login-invalid-focus-mobile-320.png`
- `test-results/e2e-artifacts/jv_result_export_jv-e2e-1785682499726.docx`

## 15. Khuyến nghị phát hành

**Kết luận: Chưa phát hành production ở trạng thái hiện tại.**

Điều kiện tối thiểu để chạy lại gate:

1. Bổ sung tệp thông tin bảo mật production còn thiếu.
2. Sửa hai lỗi focus/accessibility.
3. Cập nhật kịch bản vòng đời để chọn trạng thái thẩm định HSMT.
4. Chạy lại `npm test`, `test:ui-quality-e2e`, `test:authenticated-ui-matrix` và `test:lifecycle` cho đến khi tất cả đạt.

Các logic đấu thầu trọng yếu đã kiểm tra — đặc biệt phân lô, liên danh, báo cáo đánh giá chi tiết và ưu đãi — đủ ổn định để tiếp tục UAT sau khi xử lý các gate trên.
