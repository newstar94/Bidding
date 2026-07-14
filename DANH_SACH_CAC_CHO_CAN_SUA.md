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
| P2 | 3 | Hoàn thành theo các đợt tối ưu sau baseline |
| **Tổng** | **3** | Mỗi mục cần code, test regression và bằng chứng nghiệm thu |

---

## 2. P1 – Mức cao

Không còn hạng mục P1 chưa hoàn thành.

## 3. P2 – Mức trung bình

### [ ] P2-09 / R-24 – S3: Thay chuỗi tổ chức phân tách dấu phẩy bằng DTO có ID

**Ảnh hưởng:** tên tổ chức có dấu phẩy làm vỡ danh sách và active workspace.

**Chỗ cần sửa:** `backend/auth/auth_service.py`, session/auth responses, `frontend/admin/SystemUserView.js`, `frontend/admin/AdminUserController.js`.

- [ ] API trả `organizations: [{id, name, role, status}]`.
- [ ] `activeOrganizationId` là ID duy nhất; không dùng name để định danh.
- [ ] Loại bỏ mọi `split(',')` và logic chấp nhận ID/name lẫn lộn.
- [ ] Quyết định loại bỏ hoặc formalize `to_chuc.quan_ly_id` để tránh hai nguồn owner.

**Hoàn thành khi:** tên chứa dấu phẩy/Unicode hoạt động và toàn bộ request dùng organization ID.

### [ ] P2-10 / R-28 – S2: Nâng UX sync, conflict, form và accessibility

**Ảnh hưởng:** người dùng không biết dữ liệu đang local, đã sync hay đang conflict; lỗi form khó xử lý.

**Chỗ cần sửa:** controller/view/workflow frontend và error response API.

- [ ] Hiển thị trạng thái local/sync/success/conflict/offline và pending count theo workspace.
- [ ] Có retry, diff, resolve conflict và dirty-state guard.
- [ ] Optimistic update có rollback; thao tác nhạy cảm chỉ báo thành công sau response server.
- [ ] Field error focus đúng input; có error summary và `aria-live`.
- [ ] Dialog có focus trap/Escape/restore focus; bảo đảm keyboard/contrast.
- [ ] Pagination/virtualization cho bảng lớn; undo/impact cho thao tác phá hủy.

**Hoàn thành khi:** usability/accessibility test bao phủ keyboard, screen reader state và conflict workflow.

### [ ] P2-11 / R-29 – S1: Chia nhỏ các file lớn và loại logic trùng

**Ảnh hưởng:** khó review/test, tăng regression và làm code splitting khó thực hiện.

**Chỗ cần sửa ưu tiên:**

- `frontend/documents/schemaContract.js`
- `frontend/packages/BidProcessWorkflow.js`
- `frontend/packages/BidEvaluationWorkflow.js`
- `frontend/packages/detail/AwardResultDetailsPanel.js`
- `frontend/auth/AuthController.js`
- `frontend/packages/GoiThauWorkflow.js`
- `frontend/app/BiddingController.js`
- `frontend/app/BiddingModel.js`
- `frontend/documents/WordIntegration.js`

**Việc phải làm:**

- [ ] Tách domain rule thuần khỏi DOM và I/O.
- [ ] Tách IndexedDB adapter, mutation queue, sync cursor và entity store.
- [ ] Tách auth theo login/register/Google/reset/session/profile.
- [ ] Tách workflow theo state machine, validator, calculator và renderer.
- [ ] Loại global singleton/window assignment mới.
- [ ] Chỉ refactor sau khi có regression test cho hành vi hiện tại/đã sửa.

**Hoàn thành khi:** dependency direction rõ, module có trách nhiệm đơn và domain rule được unit test độc lập.

---

## 4. Các thay đổi xuyên suốt phải áp dụng cho mọi mục

- [ ] Mọi API write: authentication, active-org binding, authorization, typed validation, concurrency và idempotency phù hợp.
- [ ] Mọi bảng tenant: `organization_id NOT NULL`, composite FK và index bắt đầu bằng organization ID khi phù hợp query.
- [ ] Mọi thao tác nhạy cảm: audit event có actor, org, action, target, before/after tối thiểu và request ID.
- [ ] Mọi timestamp: UTC; mọi amount: integer minor unit/decimal-safe.
- [ ] Mọi lỗi client-facing: error code ổn định, không có raw exception.
- [ ] Mọi UI render dữ liệu người dùng/server: context-safe output, không nối HTML tùy ý.
- [ ] Mọi thay đổi schema: migration forward có checksum và test; không thêm runtime backfill mơ hồ.
- [ ] Mỗi bug sửa xong phải có regression test tái hiện đúng failure ban đầu.

---

## 5. Thứ tự triển khai tránh làm lại

Danh sách còn lại nên được triển khai theo dependency để hạn chế sửa đi sửa lại:

### Đợt A – Chốt nền dữ liệu và quyền

1. R-22/R-23/R-24 canonical field và API contract.

### Đợt D – Hardening, vận hành, hiệu năng và UX

1. R-25/R-27/R-28/R-29 bundle, offline, UX và refactor.

Các mục P1 phải được ưu tiên trước pilot; nếu dependency lớn chưa hoàn tất, cần vá an toàn/fail-closed trước rồi mới thay bằng thiết kế cuối.

---

## 6. Definition of Done chung

Một checkbox chỉ được đánh dấu hoàn thành khi:

- [ ] Code đã sửa ở cả server, client và DB nếu vấn đề đi xuyên tầng.
- [ ] Có test tái hiện lỗi cũ và test đường thành công mới.
- [ ] Authorization được test cả allow lẫn deny, bao gồm gọi API trực tiếp.
- [ ] Test multi-org dùng ít nhất hai user, hai organization và role khác nhau.
- [ ] Migration trên DB trắng thành công; FK/integrity/invariant checks sạch.
- [ ] Không phát sinh raw exception, secret/PII log hoặc regression DOM sink.
- [ ] Unit, API, isolated E2E, lint/type/schema-contract và production build đều đạt.
- [ ] Tài liệu `.env.example`, README/runbook được cập nhật nếu hành vi vận hành thay đổi.
- [ ] Với thay đổi P0/P1, có người review độc lập và ghi bằng chứng nghiệm thu.
