---
status: accepted
---

# Cho phép code cũ chạy với database schema mới hơn

Ứng dụng được phép khởi động khi schema database mới hơn phiên bản schema mà code yêu cầu, nhằm duy trì khả năng vận hành giữa các lần triển khai. Không được hạ schema metadata hoặc sửa migration đã áp dụng; đội triển khai chấp nhận rủi ro tương thích và phải ưu tiên triển khai code mới khi xuất hiện lỗi thực tế.
