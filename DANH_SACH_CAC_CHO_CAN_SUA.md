# Danh sách các chỗ cần sửa theo mức độ nghiêm trọng và ảnh hưởng

**Nguồn:** [Báo cáo rà soát toàn bộ hệ thống](./BAO_CAO_RA_SOAT_TOAN_BO_HE_THONG.md)  
**Mục đích:** dùng trực tiếp như backlog sửa code cho clean first-run baseline.  
**Phạm vi:** chỉ liệt kê việc cần sửa; không yêu cầu tương thích dữ liệu cũ nhưng phải giữ migration, API cập nhật và versioning cho các lần nâng cấp sau.

---

## 1. Cách đọc và nguyên tắc ưu tiên

### Mức độ nghiêm trọng

- **P1 – Cao:** phải sửa trước pilot/nghiệm thu với người dùng thật.
- **P2 – Trung bình:** sửa sau khi invariant P0/P1 ổn định, nhưng phải đưa vào kế hoạch phát hành.

### Phạm vi ảnh hưởng

- **S4 – Toàn hệ thống:** ảnh hưởng ranh giới bảo mật, nhiều tổ chức, toàn bộ dữ liệu hoặc khả năng vận hành.
- **S3 – Nhiều module/nghiệp vụ lõi:** ảnh hưởng đồng bộ, dữ liệu tài chính, subscription hoặc nhiều workflow.
- **S2 – Một luồng/module:** ảnh hưởng một nhóm người dùng hoặc tính năng xác định.
- **S1 – Cục bộ/bảo trì:** ít ảnh hưởng trực tiếp tới dữ liệu nhưng làm tăng chi phí và nguy cơ regression.

Trong từng mức P1/P2, các mục dưới đây đã được xếp theo phạm vi và mức ảnh hưởng giảm dần. Thứ tự triển khai kỹ thuật có thể điều chỉnh theo dependency ở mục 5.

### Tổng hợp

| Mức | Số nhóm còn lại | Điều kiện |
|---|---:|---|
| P1 | 0 | Đã đóng toàn bộ |
| P2 | 0 | Đã đóng toàn bộ |
| **Tổng** | **0** | Không còn hạng mục chưa hoàn thành |

---

## 2. P1 – Mức cao

Không còn hạng mục P1 chưa hoàn thành.

## 3. P2 – Mức trung bình

Không còn hạng mục P2 chưa hoàn thành.

---

## 4. Các thay đổi xuyên suốt phải áp dụng cho mọi mục

- Mọi API write: authentication, active-org binding, authorization, typed validation, concurrency và idempotency phù hợp.
- Mọi bảng tenant: `organization_id NOT NULL`, composite FK và index bắt đầu bằng organization ID khi phù hợp query.
- Mọi thao tác nhạy cảm: audit event có actor, org, action, target, before/after tối thiểu và request ID.
- Mọi timestamp: UTC; mọi amount: integer minor unit/decimal-safe.
- Mọi lỗi client-facing: error code ổn định, không có raw exception.
- Mọi UI render dữ liệu người dùng/server: context-safe output, không nối HTML tùy ý.
- Mọi thay đổi schema: migration forward có checksum và test; không thêm runtime backfill mơ hồ.
- Mỗi bug sửa xong phải có regression test tái hiện đúng failure ban đầu.

---

## 5. Thứ tự triển khai tránh làm lại

Danh sách còn lại nên được triển khai theo dependency để hạn chế sửa đi sửa lại:

### Đợt A – Chốt nền dữ liệu và quyền

Không còn hạng mục chưa hoàn thành trong đợt A.

### Đợt D – Hardening, vận hành, hiệu năng và UX

Không còn hạng mục chưa hoàn thành trong đợt D.

Các mục P1 phải được ưu tiên trước pilot; nếu dependency lớn chưa hoàn tất, cần vá an toàn/fail-closed trước rồi mới thay bằng thiết kế cuối.

---

## 6. Definition of Done chung

Một hạng mục chỉ được xác nhận hoàn thành khi:

- Code đã sửa ở cả server, client và DB nếu vấn đề đi xuyên tầng.
- Có test tái hiện lỗi cũ và test đường thành công mới.
- Authorization được test cả allow lẫn deny, bao gồm gọi API trực tiếp.
- Test multi-org dùng ít nhất hai user, hai organization và role khác nhau.
- Migration trên DB trắng thành công; FK/integrity/invariant checks sạch.
- Không phát sinh raw exception, secret/PII log hoặc regression DOM sink.
- Unit, API, isolated E2E, lint/type/schema-contract và production build đều đạt.
- Tài liệu `.env.example`, README/runbook được cập nhật nếu hành vi vận hành thay đổi.
- Với thay đổi P0/P1, có người review độc lập và ghi bằng chứng nghiệm thu.
