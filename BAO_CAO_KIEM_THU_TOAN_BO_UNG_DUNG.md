# Báo cáo kiểm thử toàn bộ ứng dụng BiddingFlow

**Ngày cập nhật:** 03/08/2026

**Môi trường:** Development cục bộ

**URL kiểm thử:** `http://127.0.0.1:8000`

**Nguồn yêu cầu:** `PROMPT_KIEM_THU_TOAN_BO_UNG_DUNG.md`

## 1. Kết luận điều hành

Các lỗi phát hiện trong đợt kiểm thử đã được sửa và các cổng kiểm thử liên quan đều đã chạy lại thành công.

Các luồng trọng yếu đã đạt gồm: phân quyền theo vai trò, CRUD, các hình thức/phương thức lựa chọn nhà thầu được hệ thống hỗ trợ, không phân lô và phân lô, nhà thầu độc lập và liên danh, một giai đoạn một túi hồ sơ, một giai đoạn hai túi hồ sơ, mở thầu, đánh giá chi tiết, ưu đãi hàng hóa, phê duyệt từng đợt phân lô, hủy thầu, đấu thầu lại, hợp đồng, hoàn thành và thanh lý hợp đồng.

Không còn lỗi Critical, Blocker, High hoặc Medium đang mở trong phạm vi đã kiểm tra. Bản hiện tại đủ điều kiện chuyển sang UAT/release candidate. Việc phát hành production vẫn cần kiểm tra hạ tầng thực tế như public URL, TLS, reverse proxy, SMTP và đăng nhập Google thật.

## 2. Kết quả sửa lỗi

| Mã | Vấn đề | Trạng thái | Xác minh |
|---|---|---|---|
| QA-001 | Form đăng nhập không chuyển focus tới trường bắt buộc đầu tiên | ĐÃ SỬA | UI quality E2E đạt ở 320, 375, 414, 768 và 1280 px |
| QA-002 | Gate yêu cầu viền focus 2 px không khớp design contract 1 px + glow | ĐÃ SỬA GATE | Authenticated UI matrix đạt ở 5 viewport |
| QA-003 | Thiếu `docs/production-security-information.md` | ĐÃ SỬA | Kiểm thử biểu mẫu thông tin production và `npm test` đạt |
| QA-004 | Kịch bản vòng đời không chọn trạng thái thẩm định E-HSMT bắt buộc | ĐÃ SỬA | Cả bốn điểm phát hành chọn `NOT_REQUIRED`; full lifecycle đạt |
| QA-005 | Delta sync ghi đè gói thầu bằng bản ghi thiếu vòng đánh giá, làm giao diện sau phê duyệt phân lô quay lại biểu mẫu cũ | ĐÃ SỬA | Kiểm thử hồi quy delta sync 7/7 đạt; full lifecycle hiển thị đủ hai đợt kết quả |
| QA-006 | Trang hợp đồng không tải trước danh mục trạng thái của tổ chức | ĐÃ SỬA | Kiểm thử phụ thuộc tuyến đạt; tạo, hoàn thành và thanh lý hợp đồng đạt |
| QA-007 | Tab workflow dùng `aria-controls` trỏ tới panel không tồn tại | ĐÃ SỬA | Tất cả tab trỏ tới `detail-workflow-content-wrapper`; contract test đạt |
| QA-008 | Bộ chọn phiên bản gói/kế hoạch thiếu tên truy cập | ĐÃ SỬA | Kiểm thử accessibility cho version selector đạt |
| QA-009 | Màu amber trên dashboard chưa đủ tương phản | ĐÃ SỬA | Axe/authenticated responsive matrix đạt |

## 3. Vai trò và phân quyền

| Vai trò | Phạm vi đã kiểm tra | Kết quả |
|---|---|---|
| Super Admin | Tổng quan hệ thống, tài khoản, chuyển vai trò, giám sát đơn vị | PASS |
| Quản lý | Nghiệp vụ đơn vị, nhân sự, phân quyền, phân công, CRUD, cấu hình | PASS |
| Chuyên viên | Dữ liệu được tạo/được phân công, giới hạn sửa xóa và tài sản workspace | PASS |

Các đối tượng chủ đầu tư, nhà thầu, chuyên gia và thành viên liên danh là thực thể nghiệp vụ, không phải vai trò đăng nhập riêng trong phiên bản hiện tại.

Các kiểm tra đã đạt:

- Chặn trang/API khi chưa đăng nhập và từ chối thông tin đăng nhập sai.
- Menu đúng theo vai trò sau tải lại, Back/Forward và nhiều tab.
- Chặn CSRF, origin sai, mass assignment và stored XSS.
- Thu hồi quyền có hiệu lực ngay; workspace bị khóa không còn truy cập.
- Phiên đăng nhập hết hạn, thay thế, thu hồi, đổi/đặt lại mật khẩu và đăng xuất.
- Người ngoài nhận `404`, người bị thu hồi nhận `403`, người được phân công nhận `200`.

## 4. Ma trận hình thức, phương thức và lĩnh vực

Đã tạo và đối chiếu 15 tổ hợp pairwise:

| Phạm vi | Giá trị đã kiểm tra | Kết quả |
|---|---|---|
| Lĩnh vực | Hàng hóa, Xây lắp, Tư vấn, Phi tư vấn, Hỗn hợp | PASS |
| Hình thức | Đấu thầu rộng rãi, hạn chế, chào hàng cạnh tranh, chỉ định thầu, chỉ định thầu rút gọn, trường hợp đặc biệt | PASS |
| Phương thức | 1G1T, 1G2T, 2G1T, 2G2T và không áp dụng cho trường hợp đặc biệt/rút gọn | PASS |
| Phương pháp đánh giá | Giá thấp nhất, giá đánh giá, kết hợp kỹ thuật và giá, dựa trên kỹ thuật, giá cố định | PASS |
| Phân lô | Không phân lô; phân hai lô; dữ liệu hàng hóa nhiều lô | PASS |

Các hình thức “Mua sắm trực tiếp”, “Tự thực hiện”, “Tham gia thực hiện của cộng đồng” và “Đàm phán giá” không có trong giao diện hiện tại nên được phân loại `NOT SUPPORTED`, không phải `NOT TESTED`.

## 5. Phân lô, liên danh và vòng đời đầu-cuối

| Tình huống | Kết quả |
|---|---|
| Không phân lô, nhà thầu độc lập | PASS |
| Không phân lô, liên danh ba thành viên | PASS |
| Phân lô, một hàng hóa mỗi lô | PASS |
| Phân lô, nhiều hàng hóa trong một lô | PASS |
| 20 lô/20 phạm vi dự thầu | PASS |
| Liên danh tham dự hai lô | PASS |
| Liên danh thắng lô 1, nhà thầu độc lập thắng lô 2 | PASS |
| 1G2T với liên danh và nhà thầu độc lập | PASS |
| Chặn thành viên liên danh trùng | PASS |
| Thành viên đứng đầu và các thành viên còn lại được lưu/tải lại đúng | PASS |
| Thành viên liên danh xuất hiện đúng trong báo cáo, kết quả và hợp đồng | PASS |

Full lifecycle cuối cùng đã đạt với run ID `E2E-1785701816842`:

`Đăng nhập → chủ đầu tư → nhà thầu → chuyên gia → kế hoạch → gói thầu → hàng hóa → phát hành E-HSMT → mở thầu → đánh giá → phê duyệt → hợp đồng → hoàn thành → thanh lý → nhập Excel → gia hạn → hủy thầu → đấu thầu lại → 1G2T → hai đợt phân lô`

Kết quả phân lô cuối:

- Lô `PP01` được phê duyệt ở đợt 1; giao diện hiển thị “Còn 1 phần lô chưa có kết quả”.
- Lô `PP02` được phê duyệt ở đợt 2.
- Trạng thái cuối là “Đã có kết quả”.
- Có đúng hai `evaluation-round-card` chính thức.

## 6. Báo cáo đánh giá chi tiết

| Nội dung | Kết quả |
|---|---|
| Báo cáo tổng hợp và báo cáo chi tiết | PASS |
| Đánh giá kỹ thuật đạt/không đạt | PASS |
| Giá đánh giá và giá xếp hạng | PASS |
| Giới hạn điểm/ngưỡng và kết luận kỹ thuật | PASS |
| Báo cáo theo nhà thầu và phạm vi lô | PASS |
| Chấp nhận/từ chối giá đề nghị dưới 50% | PASS |
| Nhà thầu bị từ chối không được xếp hạng/trúng thầu | PASS |
| Đổi quyết định và xếp hạng lại | PASS |
| Biên đúng 50% không kích hoạt cảnh báo | PASS |
| Lưu, tải lại và đăng nhập lại vẫn giữ kết quả | PASS |
| Xuất Excel đánh giá và kết quả LCNT | PASS |
| Xuất Word báo cáo kết quả và đọc lại cấu trúc | PASS |

## 7. Kiểm thử ưu đãi

Hệ thống hỗ trợ mã ưu đãi hàng hóa 0–5 với hệ số 0%, 7,5%, 10%, 10%, 12% và 15%; tất cả đều đạt.

Đã xác minh:

- Tính theo thành tiền từng dòng và dùng đúng cơ sở sau giảm giá.
- Đơn giá/thành tiền sau ưu đãi là giá trị dẫn xuất, không sửa trực tiếp.
- Làm tròn `HALF_UP`, số nguyên lớn và dung sai 1 VNĐ chính xác.
- Mapping Mẫu 15A, tiêu đề động, alias, sheet và header nhiều dòng.
- Không tự gán khi trùng tên hàng hóa giữa các lô mà thiếu phạm vi.
- Cảnh báo mapping mơ hồ/không khớp và cập nhật ngay khi đổi mã ưu đãi.
- Lưu chính thức đồng bộ hàng hóa và hồ sơ mở thầu trong cùng batch.
- Xếp hạng dùng đúng giá sau ưu đãi và không làm rò trạng thái giữa các lô.
- Xuất Excel vô hiệu hóa formula injection.

Kết quả chuyên biệt: 19/19 kiểm thử Python và 58/58 kiểm thử JavaScript về ưu đãi, hàng hóa dự thầu, giá đánh giá và xuất hàng hóa trúng thầu đều đạt.

## 8. Responsive và khả năng truy cập

Đã đạt:

- UI quality tại 320, 375, 414, 768 và 1280 px.
- Authenticated/Axe matrix tại dashboard, danh sách gói, chi tiết gói, hàng hóa dự thầu, modal dài và media bị từ chối.
- Form không hợp lệ chuyển focus đồng bộ tới trường lỗi đầu tiên.
- Tab hỗ trợ Arrow, Home, End, roving focus và `aria-controls` hợp lệ.
- Version selector có accessible name.
- Màu amber dashboard đủ tương phản.
- Focus ring theo design contract: viền solid 1 px kèm soft glow.
- Mobile CRUD không tràn ngang; bảng chuyển sang card; touch target đạt.

Phát hiện cũ về “viền focus phải dày 2 px” được đóng là lỗi hợp đồng kiểm thử: design contract của repository quy định 1 px + glow, không phải 2 px.

## 9. Tổng hợp lệnh kiểm tra cuối

| Bộ kiểm tra | Kết quả |
|---|---|
| `npm test` | PASS — 312 Python, 272 JavaScript, 0 fail |
| Critical coverage ratchet | PASS — 11 module |
| Tổng coverage | PASS — 33,89%, ngưỡng 28% |
| Delta sync regression với PostgreSQL test DB | PASS — 7/7 |
| `npm run lint:security` | PASS |
| `npm run test:lifecycle` | PASS — chạy sạch sau khi xóa instrumentation |
| `npm run test:ui-quality-e2e` | PASS — 5 viewport |
| `npm run test:authenticated-ui-matrix` | PASS — 5 viewport |
| Auth roles, pairwise, joint venture, bidder goods/preference | PASS |
| CRUD, multi-assignee, offline sync, auth shell, Turnstile matrix | PASS |

## 10. Phạm vi không hỗ trợ/chưa kiểm tra

### NOT SUPPORTED

- Mua sắm trực tiếp, tự thực hiện, tham gia thực hiện của cộng đồng, đàm phán giá.
- Vai trò đăng nhập riêng cho chủ đầu tư, nhà thầu hoặc thành viên liên danh.
- Ký số, thanh toán hoặc phát hành thông báo ra hệ thống bên ngoài.

### NOT TESTED

- Safari và Firefox thật; E2E dùng Chromium.
- Gửi email thật qua SMTP bên ngoài.
- Đăng nhập Google bằng tài khoản thật.
- Production public URL, reverse proxy và TLS thực tế.
- Soak/load test kéo dài nhiều giờ.
- Đối chiếu pháp lý trực tiếp với toàn bộ văn bản quy phạm hiện hành.

## 11. Khuyến nghị phát hành

**Kết luận kỹ thuật:** các gate trong phạm vi repository đã xanh; có thể chuyển bản này sang UAT/release candidate.

Trước production cần hoàn tất kiểm tra hạ tầng bên ngoài, sao lưu/khôi phục, giám sát, SMTP/Google thật và phê duyệt nghiệp vụ/pháp lý. Báo cáo này xác minh logic mà ứng dụng đang triển khai, không thay thế xác nhận tuân thủ pháp luật.
