# BiddingFlow legal fact sheet

Tài liệu này là nguồn kiểm kê facts cần được chủ sản phẩm, vận hành và tư vấn pháp lý xác minh trước khi cung cấp production ra bên ngoài. Không thay nội dung `missing` bằng suy đoán từ mã nguồn hoặc cấu hình local.

Trạng thái hợp lệ: `missing` → `verified` → `approved`. Chỉ `approved` mới mở production-public gate.

| ID | Fact cần xác nhận | Owner | Evidence/liên kết nội bộ | Trạng thái | Ngày xác nhận | Người phê duyệt |
|---|---|---|---|---|---|---|
| LEGAL-01 | Đơn vị vận hành/chủ sở hữu quyền phần mềm | Product + Legal | — | missing | — | — |
| LEGAL-02 | Cách thức và thời hạn thông báo thay đổi điều khoản | Legal | — | missing | — | — |
| LEGAL-03 | Luật áp dụng và cơ chế giải quyết tranh chấp | Legal | — | missing | — | — |
| LEGAL-04 | Tên đơn vị vận hành trên trang Điều khoản | Legal | — | missing | — | — |
| LEGAL-05 | Địa chỉ liên hệ pháp lý | Legal | — | missing | — | — |
| LEGAL-06 | Email liên hệ pháp lý | Legal | — | missing | — | — |
| LEGAL-07 | Chứng chỉ, phiên bản TLS tối thiểu và cấu hình reverse proxy production | Security + Operations | — | missing | — | — |
| LEGAL-08 | Mã hóa ổ đĩa, cơ sở dữ liệu, file và backup | Security + Operations | — | missing | — | — |
| LEGAL-09 | Lịch, vị trí, retention và bằng chứng restore drill | Operations | — | missing | — | — |
| LEGAL-10 | Chu kỳ dependency/vulnerability scan và SLA khắc phục | Security | — | missing | — | — |
| LEGAL-11 | Quy trình ứng phó sự cố và thời hạn thông báo | Security + Legal | — | missing | — | — |
| LEGAL-12 | Email tiếp nhận báo cáo bảo mật | Security | — | missing | — | — |
| LEGAL-13 | Chu kỳ rà soát chính sách bảo mật | Security + Legal | — | missing | — | — |
| LEGAL-14 | Tên đơn vị vận hành trên trang Bảo mật | Legal | — | missing | — | — |
| LEGAL-15 | Email bảo mật công khai | Security | — | missing | — | — |
| LEGAL-16 | Bộ phận/chức danh phụ trách sự cố | Security + Operations | — | missing | — | — |
| LEGAL-17 | Cơ sở xử lý cho từng nhóm dữ liệu | Privacy + Legal | — | missing | — | — |
| LEGAL-18 | Nhà cung cấp, khu vực và mô hình lưu trữ thực tế | Operations + Privacy | — | missing | — | — |
| LEGAL-19 | Danh sách bên thứ ba và thỏa thuận xử lý dữ liệu | Privacy + Legal | — | missing | — | — |
| LEGAL-20 | Retention theo nhóm dữ liệu, file, log và backup | Privacy + Operations | — | missing | — | — |
| LEGAL-21 | Email tiếp nhận yêu cầu quyền riêng tư | Privacy | — | missing | — | — |
| LEGAL-22 | Email tiếp nhận yêu cầu xuất dữ liệu | Privacy | — | missing | — | — |
| LEGAL-23 | Khu vực xử lý và cơ chế chuyển dữ liệu quốc tế | Privacy + Legal | — | missing | — | — |
| LEGAL-24 | Cách thông báo thay đổi chính sách quyền riêng tư | Privacy + Legal | — | missing | — | — |
| LEGAL-25 | Tên đơn vị kiểm soát/vận hành dữ liệu | Privacy + Legal | — | missing | — | — |
| LEGAL-26 | Email quyền riêng tư công khai | Privacy | — | missing | — | — |
| LEGAL-27 | Địa chỉ liên hệ quyền riêng tư | Privacy + Legal | — | missing | — | — |

## Quy trình phê duyệt

1. Owner gắn evidence vận hành hoặc tài liệu pháp lý có thể kiểm chứng.
2. Người xác minh chuyển trạng thái sang `verified` và ghi ngày.
3. Người có thẩm quyền phê duyệt nội dung public, ghi tên và chuyển sang `approved`.
4. Chỉ sau đó mới thay placeholder tương ứng trong `views/legal/` và chạy `npm run check:legal:production`.
