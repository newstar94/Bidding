# Kế hoạch Thực hiện Refactor Toàn diện - Dự án Bidding

Kế hoạch này bao gồm toàn bộ lộ trình phân tách và tối ưu hóa các file mã nguồn có độ dài vượt quá 500 dòng ở cả Backend (Python/Starlette) và Frontend (JavaScript/HTML/CSS).

---

## User Review Required

> [!WARNING]
> - Việc refactor toàn diện sẽ làm thay đổi cấu trúc thư mục của dự án và cách import/export các module.
> - Cần thực hiện kiểm thử thủ công và tự động (nếu có) sau mỗi pha để đảm bảo không làm gián đoạn luồng nghiệp vụ hiện tại.

---

## Các Pha Thực hiện Chi tiết

### Pha 1: Tối ưu hóa CSS & Tách các hàm Helper dùng chung (Rủi ro thấp)
*Mục tiêu: Dọn dẹp stylesheet và trích xuất các hàm tiện ích định dạng dữ liệu.*

- **Tách CSS**:
  - Tạo thư mục `views/css/`.
  - Phân tách [style.css](file:///F:/Bidding/views/style.css) thành:
    - `variables.css` (CSS variables, màu sắc, font).
    - `base.css` (Layout chung, reset).
    - `components.css` (Table, buttons, inputs, modals).
    - `views.css` (Style riêng cho GoiThau, Partner, SystemUser).
  - Cập nhật `style.css` gốc để `@import` các module này.
- **Tách Helper JS**:
  - Tạo [formatters.js](file:///F:/Bidding/views/utils/formatters.js) và chuyển các hàm định dạng (`formatVND`, `formatForDateInput`, v.v.) từ [BiddingModel.js](file:///F:/Bidding/models/BiddingModel.js) sang đây.
  - Cập nhật các nơi sử dụng.

---

### Pha 2: Tái cấu trúc Backend Service & Routes (Rủi ro trung bình)
*Mục tiêu: Giải phóng logic nghiệp vụ và SQL queries ra khỏi các API route handlers.*

- **Tách Service Layer**:
  - Tạo thư mục `backend/services/`.
  - Tạo các file service mới để xử lý nghiệp vụ & truy vấn CSDL:
    - `auth_service.py`: Xử lý lưu phiên đăng nhập, OTP, kiểm tra tổ chức.
    - `excel_service.py` & `docx_service.py`: Xử lý sinh file và import dữ liệu Excel/Word.
- **Chia nhỏ Route Files**:
  - Chia nhỏ [auth_routes.py](file:///F:/Bidding/backend/routes/auth_routes.py) thành:
    - `otp_routes.py`: Routes gửi/nhận OTP, rate limit.
    - `org_routes.py`: Routes quản lý tổ chức & thành viên.
    - `auth_routes.py` (tinh gọn): Chỉ xử lý Login, Logout, Session.
  - Tách logic phân tích Excel trong [routes_excel.py](file:///F:/Bidding/backend/routes/routes_excel.py) sang `backend/helpers_py/excel_handler.py`.

---

### Pha 3: Chia nhỏ các Subviews & Modals lớn (Rủi ro trung bình)
*Mục tiêu: Giảm thiểu độ phức tạp của giao diện lớn (hơn 3800 dòng ở GoiThauView.js).*

- **Tách biệt Component trong [GoiThauView.js](file:///F:/Bidding/views/subviews/GoiThauView.js)**:
  - Tạo thư mục `views/subviews/goithau/`.
  - Tách thành các module nhỏ:
    - `GoiThauTable.js`: Quản lý render bảng & sự kiện click dòng.
    - `GoiThauFilters.js`: Quản lý các bộ lọc tìm kiếm, dropdown năm/tháng.
    - `GoiThauDetail.js`: Quản lý tab chi tiết gói thầu.
- **Tách biệt [PartnerView.js](file:///F:/Bidding/views/subviews/PartnerView.js)** thành các sub-component tương tự.

---

### Pha 4: Phân tách DOM Manipulation khỏi Workflows (Rủi ro cao)
*Mục tiêu: Đảm bảo các workflow nghiệp vụ chỉ xử lý dữ liệu và state, không tương tác trực tiếp với DOM.*

- **Decoupling ở Controllers/Workflows**:
  - Cập nhật [BidProcessWorkflow.js](file:///F:/Bidding/controllers/workflows/BidProcessWorkflow.js), [BidEvaluationWorkflow.js](file:///F:/Bidding/controllers/workflows/BidEvaluationWorkflow.js) và [GoiThauWorkflow.js](file:///F:/Bidding/controllers/workflows/GoiThauWorkflow.js).
  - Thay vì Workflow tự gọi `document.getElementById(...)` để lấy giá trị form, hãy viết các hàm thu thập dữ liệu form trong lớp View (ví dụ: `GoiThauView.getFormData()`) rồi truyền kết quả dạng JS Object vào hàm của Workflow.

---

## Verification Plan

### Automated Tests
- Chạy toàn bộ test suite của backend và kiểm tra cú pháp JS sau mỗi pha refactor.

### Manual Verification
1. Xác nhận giao diện hiển thị chính xác (sau Pha 1 & Pha 3).
2. Kiểm tra luồng Đăng nhập, Gửi OTP và Phân quyền tổ chức (sau Pha 2).
3. Kiểm tra các quy trình thầu: Phát hành HSMT, Mở thầu, Đánh giá thầu (sau Pha 4).
