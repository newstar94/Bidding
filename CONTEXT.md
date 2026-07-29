# Quản lý hồ sơ dự thầu

Hệ thống quản lý dữ liệu hồ sơ theo không gian cá nhân hoặc tổ chức. Mỗi thao tác chỉ sử dụng dữ liệu và cấu hình thuộc không gian đang hoạt động.

## Ngôn ngữ

**Không gian làm việc**:
Phạm vi sở hữu dữ liệu và cấu hình, là không gian cá nhân của một tài khoản hoặc không gian dùng chung của một tổ chức.
_Tránh_: Phạm vi tài khoản, tenant

**Không gian đang hoạt động**:
Không gian làm việc duy nhất quyết định dữ liệu và bộ biến Word được đọc hoặc thay đổi trong phiên làm việc hiện tại.
_Tránh_: Tổ chức hiện tại, ngữ cảnh hiện tại

**Bộ biến Word**:
Tập cấu hình biến Word chỉ thuộc về đúng một không gian làm việc.
_Tránh_: Biến toàn cục, biến của người dùng

**Bộ biến Word cá nhân**:
Bộ biến Word thuộc không gian cá nhân của một tài khoản và được dùng khi tài khoản làm việc trong không gian cá nhân.
_Tránh_: Biến Word riêng, biến dự phòng

**Bộ biến Word tổ chức**:
Bộ biến Word dùng chung thuộc một tổ chức, do Quản lý của tổ chức thiết lập và bắt buộc áp dụng cho mọi thành viên khi làm việc trong tổ chức đó.
_Tránh_: Biến Word của Quản lý, biến Word mặc định

**Quản lý**:
Thành viên quản trị một tổ chức và là người có quyền thiết lập các tài nguyên dùng chung của tổ chức.
_Tránh_: Chủ tài khoản, chuyên viên quản trị
