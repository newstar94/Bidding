# Kế hoạch kiểm thử còn lại cho BiddingFlow

- Ngày lập: 16/07/2026
- Môi trường hiện tại: `http://127.0.0.1:8000`
- Kết quả kiểm thử đã hoàn thành: xem `BAO_CAO_KIEM_THU_TRINH_DUYET.md`
- Mục tiêu: xác nhận các tích hợp bên ngoài, tình huống đồng thời, dữ liệu thực tế và điều kiện vận hành production.

## P0 — Cần hoàn thành trước khi đưa vào production

| Hạng mục | Trường hợp cần kiểm tra | Tiêu chí đạt | Bằng chứng cần lưu |
|---|---|---|---|
| Google Login thực tế | Cho phép chính xác origin `http://127.0.0.1:8000`/domain production trong Google Cloud; đăng nhập thành công; người dùng hủy; tài khoản chưa đăng ký; callback hết hạn; đăng xuất rồi đăng ký tài khoản Google thứ hai; trình duyệt chặn popup | Không còn `GSI_LOGGER origin is not allowed`; không tạo phiên sai, không lộ thông tin xác thực, modal đặt username luôn dùng lại được, thông báo lỗi rõ ràng | Ảnh màn hình, HTTP status của iframe/callback và log đã che dữ liệu nhạy cảm |
| Email OTP thực tế | Nhận mã; gửi lại; mã sai; mã hết hạn; dùng lại mã; giới hạn gửi và nhập sai | Chỉ mã mới nhất còn hiệu lực, giới hạn tốc độ hoạt động, email đến đúng người nhận | Thời gian gửi/nhận, mã phản hồi API, ảnh email đã che mã |
| Ma trận quyền đầy đủ | Với từng phân hệ: `không quyền`, `chỉ xem`, `sửa`; kiểm tra thêm/sửa/xóa/nhập Excel/xem chi tiết | Giao diện ẩn hoặc khóa đúng thao tác và API vẫn từ chối mọi yêu cầu vượt quyền | Bảng kết quả theo vai trò và phân hệ |
| Xung đột đồng thời | Hai người cùng sửa một bản ghi; sửa trong khi người khác xóa; hai thẻ cùng gửi mutation; mất mạng rồi kết nối lại | Không mất dữ liệu âm thầm; có cảnh báo xung đột; hàng đợi không gửi lặp vô hạn | Log hai phiên, dữ liệu cuối trong SQLite |
| Sao lưu và khôi phục | Sao lưu khi hệ thống đang hoạt động; khôi phục sang máy mới; kiểm tra tệp hỏng; kiểm tra quyền truy cập tệp | Khôi phục đủ tài khoản, tổ chức, nghiệp vụ và tệp đính kèm; có lỗi rõ ràng với bản sao hỏng | Hash tệp sao lưu, biên bản khôi phục |
| Nâng cấp cơ sở dữ liệu | Chạy hàm nâng cấp trong `backend/db/upgrades.py` trên bản sao dữ liệu production; chạy lại; khởi động bằng schema cũ/thiếu | Nâng cấp chạy một lần, không mất dữ liệu, có phương án quay lui | Bản sao trước/sau và kết quả kiểm tra số lượng bản ghi |

## P1 — Kiểm tra dữ liệu và tích hợp thực tế

| Hạng mục | Trường hợp cần kiểm tra | Tiêu chí đạt |
|---|---|---|
| Excel thực tế | Tệp lớn; sai tên cột; thiếu cột; trùng mã; công thức; Unicode; ngày/tiền nhiều định dạng; nhiều sheet | Không treo trình duyệt, chỉ nhập dữ liệu hợp lệ, báo đúng dòng/cột lỗi và không tạo bản ghi trùng |
| Tra cứu mã số thuế | Thành công; không tìm thấy; `404`; `429`; timeout; phản hồi sai cấu trúc; mất mạng | Form vẫn dùng được khi dịch vụ ngoài lỗi, không ghi đè dữ liệu người dùng và có thông báo phù hợp |
| Word thực tế | Mẫu lớn; trường thiếu; bảng lặp; ảnh/chữ ký; Unicode; tên tệp dài; mở bằng các phiên bản Word phổ biến | Tệp xuất mở được, không hỏng bố cục nghiêm trọng và không chèn dữ liệu sai tổ chức |
| Tệp đính kèm | Ảnh hợp lệ; sai định dạng; quá dung lượng; tệp giả phần mở rộng; tên tệp đặc biệt | Máy chủ kiểm tra lại loại và kích thước, không thực thi nội dung tải lên, URL chỉ truy cập đúng phạm vi |
| Tải đồng thời | Nhiều người đăng nhập, phân trang, đồng bộ, nhập Excel và xuất Word cùng lúc | Không tăng lỗi `5xx`, không khóa SQLite kéo dài, thời gian phản hồi nằm trong ngưỡng đã thống nhất |

## P2 — Tương thích và chất lượng vận hành

| Hạng mục | Phạm vi | Tiêu chí đạt |
|---|---|---|
| Trình duyệt | Chrome, Edge, Firefox và Safari phiên bản được hỗ trợ | Luồng chính, tải tệp, hộp thoại và ngày giờ hoạt động thống nhất |
| Thiết bị | Desktop, tablet, điện thoại; màn hình nhỏ và zoom 200% | Không mất nút thao tác, bảng vẫn sử dụng được và hộp thoại không tràn màn hình |
| Khả năng tiếp cận | Bàn phím, focus, screen reader, tương phản, thông báo động | Hoàn thành luồng chính không cần chuột; trạng thái lỗi/đồng bộ được đọc đúng |
| Mạng không ổn định | Mạng chậm, ngắt giữa yêu cầu, reconnect nhiều lần | Không báo lưu thành công khi chưa được máy chủ xác nhận; không nhân đôi dữ liệu |
| Quan sát hệ thống | Log rotation, dung lượng đĩa, cảnh báo lỗi, request ID | Có thể truy vết lỗi mà không ghi mật khẩu, OTP, cookie hoặc dữ liệu nhạy cảm |
| Bảo mật triển khai | HTTPS, cookie production, CSP, CSRF, giới hạn tốc độ, quyền thư mục dữ liệu | Cấu hình production bật đầy đủ và vượt qua kiểm tra bảo mật trước phát hành |

## Timeline gói thầu và xuất Word

| Mức | Trường hợp cần kiểm tra | Tiêu chí đạt |
|---|---|---|
| P0 | Nâng database từ phiên bản đã phát hành lên phiên bản kế tiếp trên bản sao production; khởi động lại lần hai; `PRAGMA foreign_key_check`; thử khôi phục backup | Không sửa hàm nâng cấp đã phát hành, không mất dữ liệu, bảng/index mới chỉ tạo một lần |
| P0 | Manager, chuyên viên được phân công, chuyên viên không được phân công và quyền `none/view/edit` | Menu, dữ liệu, nút lưu và endpoint xuất Word tuân thủ đúng quyền `goithau`; không đọc chéo tổ chức |
| P0 | Hai người cùng sửa timeline; mất mạng khi lưu; reconnect; payload thiếu `timelineItems`; payload `timelineItems: []` | Có xung đột `409` khi cần, không nhân đôi hoặc mất timeline ngoài ý muốn |
| P0 | Xuất Word không có snapshot, snapshot cũ và dữ liệu đổi trong lúc render | Lần lượt trả `428`, `409`, `409`; không trả tệp từ snapshot không nhất quán |
| P1 | Khởi tạo đủ 5 nhóm/48 mốc, Unicode, ngày dự kiến/thực tế, Auto/Manual, khôi phục nguồn, mốc không áp dụng và quá hạn | Thứ tự ổn định; `OVERDUE` chỉ được suy ra; dữ liệu thủ công không bị nguồn tự động ghi đè |
| P1 | Tìm gói khi bật server-side pagination; đổi kế hoạch, phiên bản; sao chép phiên bản trước | Chỉ tải gói cần thiết; timeline tách theo `goi_thau.id`; các mốc E-HSMT/kết quả được đặt lại khi sao chép |
| P1 | Word với chuỗi dài, ghi chú dài, bảng nhiều trang và ngày dự kiến | DOCX mở được, header bảng lặp, không cắt hàng, ngày `dd/MM/yyyy`, ngày dự kiến màu đỏ và có chú thích |
| P2 | Desktop, tablet, điện thoại, zoom 200%, bàn phím và screen reader | Không mất nút lưu/xuất, bảng cuộn ngang, focus rõ và trạng thái không phụ thuộc riêng vào màu |

## Quy trình ghi nhận

1. Mỗi trường hợp phải ghi vai trò, tổ chức/workspace, dữ liệu đầu vào và thời điểm kiểm tra.
2. Lỗi mới được ghi vào `BAO_CAO_KIEM_THU_TRINH_DUYET.md` kèm bước tái hiện, kết quả thực tế và kết quả mong đợi.
3. Sau khi sửa, chạy lại đúng trường hợp, kiểm thử hồi quy và xóa lỗi đã đạt khỏi báo cáo.
4. Không đưa mật khẩu, OTP, cookie, token hoặc dữ liệu cá nhân thật vào ảnh chụp và log chia sẻ.

## Điều kiện hoàn tất

- Tất cả mục P0 đạt.
- Không còn lỗi mức nghiêm trọng hoặc cao.
- Các lỗi trung bình còn lại có phương án xử lý và người chịu trách nhiệm.
- Kiểm thử tự động, secure build và kiểm tra gói production đều đạt trên bản phát hành cuối.
- Bản sao lưu đã được khôi phục thử thành công trước ngày phát hành.
