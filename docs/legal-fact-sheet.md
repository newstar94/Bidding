# Phiếu xác nhận thông tin pháp lý và vận hành

Phiếu này là nguồn bằng chứng cho nội dung công khai tại `views/legal/terms.html`,
`views/legal/privacy.html` và `views/legal/security.html`. Không ghi secret, credential,
token hoặc dữ liệu cá nhân không cần thiết vào repository.

Chỉ chuyển trạng thái một dòng từ `missing` sang `approved` khi:

1. nội dung đã được đơn vị vận hành xác nhận;
2. có bằng chứng hoặc tài liệu nguồn có thể kiểm tra;
3. người có thẩm quyền đã duyệt và ngày duyệt được ghi nhận;
4. placeholder tương ứng trong `views/legal/` đã được thay bằng nội dung công khai đã duyệt.

| ID | Nội dung cần xác nhận | Phạm vi | Bằng chứng/nguồn | Trạng thái | Ngày duyệt | Người duyệt |
|---|---|---|---|---|---|---|
| LEGAL-01 | Cơ sở xử lý áp dụng cho từng nhóm dữ liệu | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-02 | Nhà cung cấp, khu vực và mô hình lưu trữ thực tế | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-03 | Danh sách nhà cung cấp dịch vụ bên thứ ba và thỏa thuận xử lý dữ liệu | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-04 | Thời gian lưu trữ dữ liệu theo từng nhóm | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-05 | Email liên hệ về quyền riêng tư | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-06 | Email tiếp nhận yêu cầu xuất dữ liệu | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-07 | Khu vực xử lý và cơ chế chuyển dữ liệu quốc tế, nếu có | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-08 | Cách thông báo thay đổi ảnh hưởng đáng kể đến quyền riêng tư | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-09 | Tên đơn vị vận hành công bố trong chính sách quyền riêng tư | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-10 | Email quyền riêng tư công bố tại phần liên hệ | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-11 | Địa chỉ liên hệ công bố trong chính sách quyền riêng tư | Privacy | Chưa cung cấp | missing | — | — |
| LEGAL-12 | Chứng chỉ, phiên bản TLS tối thiểu và cấu hình hạ tầng production | Security | Chưa cung cấp | missing | — | — |
| LEGAL-13 | Mã hóa ổ đĩa, cơ sở dữ liệu, file và bản sao lưu | Security | Chưa cung cấp | missing | — | — |
| LEGAL-14 | Lịch sao lưu, vị trí lưu, thời gian giữ và kết quả diễn tập khôi phục | Security | Chưa cung cấp | missing | — | — |
| LEGAL-15 | Chu kỳ rà soát dependency, quét lỗ hổng và thời hạn khắc phục | Security | Chưa cung cấp | missing | — | — |
| LEGAL-16 | Quy trình ứng phó sự cố, đầu mối và thời hạn thông báo | Security | Chưa cung cấp | missing | — | — |
| LEGAL-17 | Email tiếp nhận báo cáo bảo mật | Security | Chưa cung cấp | missing | — | — |
| LEGAL-18 | Chu kỳ rà soát chính sách bảo mật | Security | Chưa cung cấp | missing | — | — |
| LEGAL-19 | Tên đơn vị vận hành công bố trong chính sách bảo mật | Security | Chưa cung cấp | missing | — | — |
| LEGAL-20 | Email bảo mật công bố tại phần liên hệ | Security | Chưa cung cấp | missing | — | — |
| LEGAL-21 | Bộ phận hoặc chức danh phụ trách xử lý sự cố | Security | Chưa cung cấp | missing | — | — |
| LEGAL-22 | Tên đơn vị vận hành hoặc chủ sở hữu phần mềm | Terms | Chưa cung cấp | missing | — | — |
| LEGAL-23 | Cách thức và thời hạn thông báo thay đổi quan trọng | Terms | Chưa cung cấp | missing | — | — |
| LEGAL-24 | Luật áp dụng và cơ quan hoặc cơ chế giải quyết tranh chấp | Terms | Chưa cung cấp | missing | — | — |
| LEGAL-25 | Tên đơn vị vận hành công bố trong điều khoản | Terms | Chưa cung cấp | missing | — | — |
| LEGAL-26 | Địa chỉ liên hệ công bố trong điều khoản | Terms | Chưa cung cấp | missing | — | — |
| LEGAL-27 | Email liên hệ pháp lý | Terms | Chưa cung cấp | missing | — | — |

## Quy ước bằng chứng

Cột **Bằng chứng/nguồn** nên trỏ tới hồ sơ có quyền truy cập phù hợp, ví dụ mã ticket
nội bộ, mã chính sách, hợp đồng với nhà cung cấp hoặc biên bản phê duyệt. Không đưa nội
dung bí mật của tài liệu nguồn vào file này.
