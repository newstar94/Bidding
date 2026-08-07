# ĐỀ XUẤT TÍNH NĂNG MỚI VÀ NÂNG CẤP BIDDINGFLOW
**Ngày:** 2026-08-08

> Tài liệu này **không nằm trong phạm vi sửa lỗi/refactor trước mắt**.
>
> Đây là backlog sản phẩm để lựa chọn triển khai sau khi nền tảng BiddingFlow đã ổn định hơn.

---

# 1. Nguyên tắc phân loại

Mỗi đề xuất được phân thành:

```text
NEW
```

= tính năng mới đáng kể.

```text
UPGRADE
```

= nâng cấp một capability BiddingFlow đã có.

```text
EXISTING FOUNDATION
```

= nền tảng đã tồn tại, không được xây lại.

---

# 2. Bảng tổng quan

| Đề xuất | Loại | Nền tảng hiện có | Ưu tiên gợi ý |
|---|---|---|---:|
| Version Diff + Impact Analysis | UPGRADE/NEW layer | Versioning đã có | ⭐⭐⭐⭐⭐ |
| Conflict Resolution Center | UPGRADE | Conflict detection đã có | ⭐⭐⭐⭐⭐ |
| Procurement Compliance Copilot | UPGRADE | AI Assistant đã có | ⭐⭐⭐⭐⭐ |
| Risk/SLA Intelligence | UPGRADE | Dashboard Alerts đã có | ⭐⭐⭐⭐ |
| Contractor 360 | UPGRADE | Contractor detail/version đã có | ⭐⭐⭐⭐ |
| Data Quality Center | UPGRADE | Validators/integrity checks đã có | ⭐⭐⭐⭐ |
| What-if Evaluation Simulator | NEW | Evaluation engine đã có | ⭐⭐⭐⭐ |
| Word Template Designer Evolution | UPGRADE | Template Designer core đã có | ⭐⭐⭐ |
| Multi-level Approval Workflow | NEW/PARTIAL | Một số approval state đã có | ⭐⭐⭐ |
| Calendar/SLA Integration | NEW | Deadline data đã có | ⭐⭐⭐ |
| Bulk Operation Center | NEW/PARTIAL | Một số bulk action có thể đã có rời rạc | ⭐⭐⭐ |
| Integration Hub | NEW architecture | Có integration riêng lẻ | ⭐⭐⭐⭐ |
| Safe Undo | NEW UX | Outbox/transaction có thể hỗ trợ | ⭐⭐ |

---

# 3. Version Diff + Change Impact Analysis

## Trạng thái hiện tại

BiddingFlow đã có:

- `rootId`;
- `phienBan`;
- `isLatest`;
- version selector;
- plan/package snapshot;
- contractor version;
- contract version ở một số luồng.

Do đó không tạo version engine mới.

## Đề xuất

### Version Diff

So sánh:

```text
-00
-01
-02
```

Hiển thị:

```text
Before
After
```

Phân loại:

```text
added
removed
modified
unchanged
```

### Ví dụ

```text
Thời gian đóng thầu
10/08 09:00 → 12/08 09:00

Giá gói thầu
Không đổi

Phân công
Nguyễn A → Nguyễn A, Trần B

Hàng hóa
+2
-1
~3
```

### Impact Analysis

Khi thay đổi một field, xác định object có thể bị ảnh hưởng:

- deadline;
- timeline;
- assignment;
- document;
- evaluation;
- contract;
- notification.

## Giá trị

Rất cao vì BiddingFlow đã có versioning mạnh.

---

# 4. Conflict Resolution Center

## Trạng thái hiện tại

Đã có:

- rowVersion;
- 409 conflict;
- conflict state;
- server record recovery;
- một số auto-resolution.

## Đề xuất

UI field-by-field:

```text
                 Local              Server
Thời gian đóng   12/08 10:00        12/08 09:00
Người phụ trách  Nguyễn A           Trần B
```

Action:

```text
Dùng dữ liệu server
Giữ dữ liệu của tôi
Chọn từng field
```

Merge phải tạo mutation mới trên latest rowVersion.

## Giá trị

Rất cao cho multi-user/offline.

---

# 5. Procurement Compliance Copilot

## Trạng thái hiện tại

AI Assistant đã có:

- config;
- conversations;
- streaming;
- history;
- suggested questions;
- feedback.

Không xây chatbot thứ hai.

## Đề xuất

Nâng cấp:

```text
AI Assistant
+
permission-filtered facts
+
deterministic compliance rules
+
workflow context
+
AI explanation
```

## Ví dụ

> Gói GT-023 chưa đủ điều kiện hoàn thành đánh giá vì Nhà thầu A chưa có điểm kỹ thuật.

> Phương pháp là Kết hợp kỹ thuật và giá nhưng 2 nhà thầu còn giá trị Đạt/Không đạt.

> Phiên bản -02 đã đổi thời gian đóng thầu nhưng tài liệu X vẫn chứa thời gian cũ.

> Có 3 gói sắp quá SLA đánh giá.

## Nguyên tắc

AI:

- giải thích;
- tổng hợp;
- đề xuất.

Backend rule engine:

- quyết định đúng/sai;
- enforce permission;
- enforce validation.

---

# 6. Risk / SLA Intelligence

## Trạng thái hiện tại

Dashboard đã có alert:

- đóng thầu hôm nay;
- sắp đóng;
- quá hạn mở;
- chậm đánh giá;
- hợp đồng sắp hết hạn;
- hợp đồng hết hạn;
- cần đăng kế hoạch;
- quá hạn đăng kế hoạch.

## Đề xuất nâng cấp

Thêm:

- severity;
- owner;
- acknowledgement;
- blocker;
- SLA;
- overdue duration;
- risk trend;
- configurable threshold;
- grouping theo phòng/nhân sự/gói;
- drill-down;
- action link.

## Không tạo

Không tạo một alert engine hoàn toàn thứ hai nếu logic hiện tại có thể mở rộng.

---

# 7. Contractor 360

## Trạng thái hiện tại

Contractor đã có:

- detail;
- version;
- JV members;
- contact;
- bank;
- stamp;
- identity data.

## Đề xuất

Một trang intelligence:

### Bid history

- số lần dự thầu;
- số lần trúng;
- số lần trượt;
- tỷ lệ trúng.

### Contract history

- số hợp đồng;
- tổng giá trị;
- đang thực hiện;
- đã thanh lý;
- đúng hạn/chậm.

### Price intelligence

- lịch sử giá dự thầu;
- lịch sử giá trúng;
- low-price cases.

### JV network

- từng liên danh với ai;
- vai trò trưởng/thành viên;
- frequency.

### Clarification / evaluation

- lịch sử làm rõ;
- kỹ thuật;
- tài chính;
- reasons for rejection.

---

# 8. Data Quality Center

## Trạng thái hiện tại

BiddingFlow đã có nhiều validator/integrity guard ở backend/test/script.

## Đề xuất

UI tổng hợp anomaly:

```text
Detected
Reviewed
Fixed
Ignored with reason
```

### Loại lỗi

- duplicate;
- orphan;
- broken root/version;
- multiple latest;
- missing latest;
- invalid metadata;
- legacy method alias;
- missing rowVersion;
- child mismatch;
- stale assignment;
- duplicate contractor tax code;
- broken document reference.

### Auto-fix

Chỉ cho case deterministic.

Mọi auto-fix phải audit.

---

# 9. What-if Evaluation Simulator

## Loại

**NEW**

## Mục tiêu

Cho phép mô phỏng mà không sửa official data.

Ví dụ:

```text
Trọng số kỹ thuật:
30% → 40%
```

xem ranking thay đổi.

Hoặc:

- điều chỉnh technical score scenario;
- simulated price;
- low-price acceptance scenario;
- comparison across lots.

## Bắt buộc

UI ghi rõ:

```text
MÔ PHỎNG
KHÔNG PHẢI KẾT QUẢ CHÍNH THỨC
```

Không persist vào official result.

---

# 10. Word Template Designer Evolution

## Trạng thái hiện tại

Core Template Designer đã có:

- upload;
- list;
- view;
- active;
- replace;
- rename;
- delete;
- validation;
- variable dictionary;
- mappings;
- lists;
- computed variables;
- column/list expansion;
- permission.

## KHÔNG xây lại

Chỉ bổ sung phần chưa có sau khi xác minh.

## Đề xuất nâng cấp

### 10.1. Template Version History

```text
templateId
version
checksum
createdBy
createdAt
```

### 10.2. Draft / Publish

Cho sửa template mà chưa ảnh hưởng ngay tài liệu official.

### 10.3. Rollback

Chọn version cũ và rollback.

### 10.4. Rendered Preview

Preview bằng context thật/mẫu.

Không chỉ mở raw `.docx`.

### 10.5. Usage References

Biết template đang được workflow nào sử dụng.

### 10.6. Compatibility Validation

Khi replace:

- missing mapped variable;
- loop invalid;
- unsupported expression;
- required context missing.

### 10.7. Audit

Ai:

- upload;
- edit;
- replace;
- publish;
- rollback.

---

# 11. Multi-level Approval Workflow

## Loại

**NEW/PARTIAL**

## Chỉ làm nếu nghiệp vụ xác nhận cần

Generic flow:

```text
Draft
→ Review
→ Approve
→ Sign
→ Final
```

Có:

- role;
- permission;
- reject reason;
- comment;
- delegation;
- SLA;
- audit.

## Không được

Không thay thế bừa các workflow pháp lý hiện có bằng generic engine nếu không phù hợp.

---

# 12. Calendar / SLA Integration

## Loại

**NEW**

## Giai đoạn 1

ICS export.

## Giai đoạn sau

- Google Calendar;
- Outlook.

## Event

- đăng tải;
- đóng thầu;
- mở thầu;
- đánh giá;
- approval;
- contract milestone;
- expiry.

## Privacy

Không tự động đẩy confidential data ra external calendar.

---

# 13. Bulk Operation Center

## Loại

**NEW/PARTIAL**

## Use case

- bulk assign;
- reassign;
- export;
- archive;
- selected workflow actions;
- selected document generation nếu hợp lệ.

## Bắt buộc

```text
Preview affected records
↓
Permission
↓
Validation
↓
Confirmation
↓
Execution
↓
Audit
```

Không bulk force invalid status transition.

---

# 14. Integration Hub

## Loại

**NEW architecture**

## Trạng thái hiện tại

Ứng dụng đã có integration riêng lẻ:

- public procurement lookup/import;
- AI;
- document;
- Excel;
- các service khác.

## Đề xuất

Một connector boundary cho integration mới:

```text
Connector
Mapping
Validation
Idempotency
Retry
Dead-letter
Audit
Observability
```

## Có thể phục vụ

- muasamcong/e-GP;
- ERP;
- accounting;
- DMS;
- HR;
- digital signature;
- email/SMS;
- BI.

Không rewrite integration đang chạy chỉ để đẹp kiến trúc.

---

# 15. Safe Undo

## Loại

**NEW UX**

Cho action reversible như:

- xóa assignment;
- xóa note;
- xóa row chưa final.

Toast:

```text
Đã xóa · Hoàn tác
```

## Không dùng cho

- approval;
- award final;
- signed contract;
- irreversible official action;

trừ khi domain có cơ chế revert chính thức.

---

# 16. Gợi ý thứ tự nếu triển khai sau này

Sau khi refactor nền tảng xong, thứ tự có giá trị cao nhất:

```text
1. Version Diff + Impact Analysis
2. Conflict Resolution Center
3. Compliance Copilot
4. Risk/SLA Intelligence
5. Contractor 360
6. Data Quality Center
7. What-if Simulator
8. Word Template Designer Evolution
9. Calendar/SLA
10. Bulk Operations
11. Approval Workflow
12. Integration Hub
```

Thứ tự thực tế còn phụ thuộc nhu cầu nghiệp vụ.

---

# 17. Tiêu chí chọn feature để làm

Trước khi chọn, chấm mỗi feature theo:

| Tiêu chí | Điểm 1–5 |
|---|---:|
| Giảm lỗi nghiệp vụ | |
| Tiết kiệm thời gian người dùng | |
| Tần suất sử dụng | |
| Độ khó kỹ thuật | |
| Rủi ro regression | |
| Cần thay DB schema | |
| Cần external integration | |
| Tác động quyền/bảo mật | |
| Giá trị báo cáo/quản trị | |

Có thể tính:

```text
Priority Score
=
Business Value
-
Technical Risk
```

---

# 18. Nguyên tắc khi triển khai feature sau này

Mỗi feature phải:

1. inventory capability hiện có;
2. tái sử dụng abstraction hiện có;
3. không tạo duplicate module;
4. permission-aware;
5. organization-scoped;
6. audit được;
7. test E2E;
8. không phá offline/sync;
9. không phá performance budget;
10. không hạ security.

---

# 19. Kết luận

BiddingFlow đã có nhiều nền tảng tốt.

Vì vậy roadmap feature đúng không phải:

```text
càng nhiều module càng tốt
```

mà là:

```text
tận dụng capability hiện có
+
bổ sung intelligence
+
tăng khả năng ra quyết định
+
giảm thao tác thủ công
```

Tài liệu này chỉ là backlog đề xuất.

**Không triển khai tự động cho đến khi người dùng chọn feature cụ thể.**
