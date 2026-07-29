# BÁO CÁO KIỂM THỬ LUỒNG NGƯỜI DÙNG VÀ SỬA LỖI BIDDINGFLOW

> Nguồn sự thật duy nhất cho phiên kiểm thử bắt đầu ngày 29/07/2026. Không xóa lịch sử hợp lệ; mọi kết quả phải kèm bằng chứng.

## 1. Thông tin chung

| Thuộc tính | Giá trị |
|---|---|
| Thời gian bắt đầu | 2026-07-29 05:21:18 +07:00 |
| Trạng thái | ĐANG KIỂM THỬ |
| Branch | `main` |
| Commit ban đầu | `516f9d9` |
| Working tree ban đầu | Đang có thay đổi chưa commit của chức năng hàng hóa dự thầu; phải bảo toàn |
| Môi trường | Windows, workspace `D:\Bidding` |
| Node | v24.18.0 |
| npm | 11.16.0 |
| Python | 3.14.5 |
| Playwright | 1.62.0 |
| Trình duyệt | In-app Browser (iab) theo yêu cầu người dùng; chưa khởi tạo được do sandbox helper |
| Plugin/MCP/skill | Browser plugin + Node REPL MCP; skill control-in-app-browser, diagnosing-bugs |
| URL frontend/backend | `http://127.0.0.1:8000` |
| Database | PostgreSQL local theo `DATABASE_URL`; không ghi secret |
| Lệnh khởi động | Đang khảo sát |
| Lệnh build/test | Đang khảo sát từ `package.json`, README và script repo |

### 1.1. Sự kiện hạ tầng

| ID | Thời điểm | Sự kiện | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| INFRA-01 | 2026-07-29 | Browser MCP bootstrap thất bại ba lần, lần cuối gọi trực tiếp in-app Browser theo yêu cầu người dùng | BỊ CHẶN | Kernel thoát trước khi thực thi với windows sandbox failed: helper_unknown_error: setup refresh had errors; không thay bằng Playwright khi Browser plugin đã được chọn rõ |

## 2. Tài khoản và vai trò

| ID | Loại tài khoản/vai trò | Phạm vi dữ liệu | Quyền chính | Tài khoản test | Trạng thái |
|---|---|---|---|---|---|
| ROLE-TBD | Đang khảo sát từ auth/policy/seed | Đang khảo sát | Đang khảo sát | Không ghi mật khẩu | CHƯA KIỂM THỬ |

## 3. Ma trận chức năng

| ID | Module | Chức năng | Vai trò | Trường hợp | Kết quả | Lỗi liên quan |
|---|---|---|---|---|---|---|
| F-001 | Auth | Đăng ký/điều khoản | Chưa xác định | Happy path + validation + reload | CHƯA KIỂM THỬ | — |
| F-002 | Auth | Đăng nhập/đăng xuất/session | Chưa xác định | Đúng/sai/khóa/URL bảo vệ/multi-tab | CHƯA KIỂM THỬ | — |
| F-003 | Workspace | Chuyển tổ chức và cách ly dữ liệu | Chưa xác định | Quyền cho phép/từ chối/IDOR | CHƯA KIỂM THỬ | — |
| F-004 | Quản trị | Người dùng, vai trò, phân quyền | Chưa xác định | CRUD/thu hồi quyền/reload | CHƯA KIỂM THỬ | — |
| F-005 | Danh mục | Nhân viên/chủ đầu tư/nhà thầu/chuyên gia | Chưa xác định | CRUD/import/export/pagination | CHƯA KIỂM THỬ | — |
| F-006 | Kế hoạch | Kế hoạch lựa chọn nhà thầu | Chưa xác định | CRUD/giá trị/tham chiếu | CHƯA KIỂM THỬ | — |
| F-007 | Gói thầu | Tạo/sửa/xóa/phân lô/hàng hóa | Chưa xác định | Mọi option thực tế + validation | CHƯA KIỂM THỬ | — |
| F-008 | Vòng đời | HSMT/phát hành/gia hạn/mở thầu | Chưa xác định | Trạng thái/quyền/tài liệu | CHƯA KIỂM THỬ | — |
| F-009 | Đánh giá | 1G1T tổng quát/chi tiết | Chưa xác định | Nhiều nhà thầu/lô/giá | CHƯA KIỂM THỬ | — |
| F-010 | Đánh giá | 1G2T kỹ thuật/tài chính | Chưa xác định | Gate kỹ thuật/không lộ tài chính | CHƯA KIỂM THỬ | — |
| F-011 | Giá thấp | Quyết định dưới 50% | Chưa xác định | LP-01 đến LP-30 | CHƯA KIỂM THỬ | — |
| F-012 | Liên danh | Thành viên/mở thầu/đánh giá/kết quả | Chưa xác định | JV-01 đến JV-22 | CHƯA KIỂM THỬ | — |
| F-013 | Kết quả | Thẩm định/phê duyệt/hủy/đấu thầu lại | Chưa xác định | Vòng đời và quyền | CHƯA KIỂM THỬ | — |
| F-014 | Hợp đồng | Tạo/thực hiện/hoàn thành/thanh lý | Chưa xác định | Độc lập/liên danh/lô/quyền | CHƯA KIỂM THỬ | — |
| F-015 | Tài liệu | Word/Excel/PDF/import/export | Chưa xác định | Mở file, Unicode, giá, liên danh | CHƯA KIỂM THỬ | — |
| F-016 | Sync | Offline/retry/conflict/multi-tab | Chưa xác định | IndexedDB/outbox/PostgreSQL | CHƯA KIỂM THỬ | — |
| F-017 | UI/UX | Responsive/a11y/error/loading | Tất cả | Desktop/hẹp/keyboard/console/network | CHƯA KIỂM THỬ | — |
| F-018 | Bảo mật | AuthZ/IDOR/CSRF/XSS/upload | Tất cả | UI + API xác minh backend | CHƯA KIỂM THỬ | — |
| F-019 | Hiệu năng | Dữ liệu lớn/N+1/reload | Tất cả | Đo lường, không suy đoán | CHƯA KIỂM THỬ | — |

## 4. Ma trận tổ hợp gói thầu (pairwise)

Chiến lược: bao phủ mọi option thực tế sau khi khảo sát, dùng pairwise cho lĩnh vực × hình thức × phương thức × phương pháp × phân lô × kiểu nhà thầu; bổ sung riêng các tương tác rủi ro cao (1G2T, nhiều lô, liên danh, dưới 50%, hủy, đấu thầu lại, hợp đồng).

| ID | Lĩnh vực | Hình thức | Phương thức | Phương pháp | Phân lô | Kiểu nhà thầu | Nhánh nghiệp vụ | Kết quả |
|---|---|---|---|---|---|---|---|---|
| PKG-01 | Hàng hóa | Đang khảo sát | 1G1T | Giá thấp nhất | Không | Độc lập | Vòng đời đầy đủ, giá bình thường | CHƯA KIỂM THỬ |
| PKG-02 | Hàng hóa | Đang khảo sát | 1G1T | Giá đánh giá | Có, nhiều lô | Liên danh | Dưới 50%, chấp thuận/không chấp thuận | CHƯA KIỂM THỬ |
| PKG-03 | Hàng hóa | Đang khảo sát | 1G2T | Đang khảo sát | Không | Độc lập | Gate kỹ thuật → tài chính | CHƯA KIỂM THỬ |
| PKG-04 | Hàng hóa | Đang khảo sát | 1G2T | Đang khảo sát | Có | Liên danh | Nhiều lô, giá bằng 50% | CHƯA KIỂM THỬ |
| PKG-05 | Xây lắp | Đang khảo sát | Đang khảo sát | Đang khảo sát | Không | Độc lập | Vòng đời, hợp đồng | CHƯA KIỂM THỬ |
| PKG-06 | Tư vấn | Đang khảo sát | Đang khảo sát | Kết hợp kỹ thuật và giá | Không | Liên danh | Đánh giá, kết quả | CHƯA KIỂM THỬ |
| PKG-07 | Phi tư vấn | Đang khảo sát | Đang khảo sát | Đang khảo sát | Có | Độc lập | Hủy và đấu thầu lại | CHƯA KIỂM THỬ |
| PKG-08 | Hỗn hợp/khác nếu có | Đang khảo sát | Đang khảo sát | Đang khảo sát | Có | Liên danh | Phê duyệt và hợp đồng | CHƯA KIỂM THỬ |

## 5. Ma trận giá đề nghị trúng thầu dưới 50%

| ID | Trường hợp | Kết quả mong đợi | Kết quả | Bằng chứng/Lỗi |
|---|---|---|---|---|
| LP-01..LP-30 | Chi tiết giữ nguyên theo mục 13 của prompt kiểm thử | Đúng biên, quyết định, xếp hạng, persistence, report, multi-user | CHƯA KIỂM THỬ | Sẽ tách thành 30 dòng sau khảo sát rule thực tế |

## 6. Ma trận liên danh

| ID | Trường hợp | Kết quả mong đợi | Kết quả | Bằng chứng/Lỗi |
|---|---|---|---|---|
| JV-01..JV-22 | Chi tiết giữ nguyên theo mục 14 của prompt kiểm thử | Đúng rule thực tế, không tự áp đặt | CHƯA KIỂM THỬ | Sẽ tách thành 22 dòng sau khảo sát model thực tế |

## 7. Nhật ký lỗi

Chưa có lỗi sản phẩm được xác nhận. Mọi lỗi mới phải được ghi trước khi sửa.

## 8. Nhật ký bằng chứng

| Thời điểm | Test case | Hành động/Bằng chứng | Kết quả |
|---|---|---|---|
| 2026-07-29 05:21 | BOOT-01 | Đọc đầy đủ prompt 1.777 dòng; đọc skill Browser và Diagnosing Bugs | ĐẠT |
| 2026-07-29 05:22 | BOOT-02 | Browser MCP bootstrap thử 2 lần qua URL inference | BỊ CHẶN bởi sandbox helper |
| 2026-07-29 05:30 | BOOT-03 | Người dùng yêu cầu Browser plugin; gọi trực tiếp in-app Browser lần thứ 3 | BỊ CHẶN bởi cùng sandbox helper trước khi runtime khởi tạo |

## 9. TỔNG KẾT

- Branch: `main`
- Commit ban đầu: `516f9d9`
- Commit sau sửa: Chưa có
- Plugin/MCP/skill: Browser plugin, Node REPL MCP; control-in-app-browser, diagnosing-bugs
- Số vai trò: Đang khảo sát
- Số module: Đang khảo sát
- Số test case: Đang lập
- Đạt: 1 bước khảo sát
- Không đạt: 0 test case sản phẩm
- Bị chặn: Browser plugin không thể bootstrap do sandbox helper; không dùng fallback sau khi người dùng chọn rõ Browser plugin
- Tổng lỗi: 0 lỗi sản phẩm đã xác nhận
- Blocker/Critical/High/Medium/Low: 0/0/0/0/0
- Lỗi đã sửa: 0
- Lỗi chưa thể sửa: 0
- Test tự động bổ sung: 0 trong phiên này
- Kết quả pytest/frontend/E2E/build: CHƯA KIỂM THỬ trong phiên này
- Kết quả kiểm thử liên danh: CHƯA KIỂM THỬ
- Kết quả kiểm thử giá dưới 50%: CHƯA KIỂM THỬ
- Rủi ro còn lại: Toàn bộ ma trận nghiệp vụ đang chờ khảo sát và chạy.
