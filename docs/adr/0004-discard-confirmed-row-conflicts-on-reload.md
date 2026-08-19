---
status: accepted
date: 2026-08-19
supersedes: 0003-quarantine-row-conflicts-as-recovery-drafts
---

# Bỏ batch xung đột phiên bản khi tải lại

Khi `/api/sync` trả `409 ROW_VERSION_CONFLICT`, BiddingFlow cách ly đúng receipt/batch đã bị từ chối khỏi active outbox và giữ checkpoint đó tạm thời như conflict marker. Ứng dụng không tự merge, không retry, không force overwrite, không pull đè dữ liệu người dùng đang nhìn và không hỏi Apply/Later/Keep. UI chỉ thông báo dữ liệu máy chủ đã thay đổi và yêu cầu F5.

Trong startup sau F5, workspace hiện tại tự xóa conflict marker đã xác nhận, không restore checkpoint, full pull server state, chuẩn hóa lựa chọn plan/package version rồi mới replay mutation không liên quan còn trong active outbox. Nếu không ghi được marker trước lúc cách ly hoặc không xóa bền vững marker lúc startup, outbox không bị dọn thêm và reconciliation dừng với lỗi storage. Network timeout, HTTP 500, validation rejection, offline state và `IDEMPOTENCY_KEY_REUSED` không dùng policy discard này.

Plan breakdown là một edit session cho cả `create` và `edit`: package, child, expert và assignment save chỉ stage trong memory; nút Lưu kế hoạch tạo một logical sync payload chỉ gồm physical plan hiện tại và record thực sự thay đổi/xóa. Delta của record khác hoặc delta chỉ đổi server metadata không phá draft; nếu server đổi bất kỳ business field nào trên cùng record thì client không tự merge và giữ expected version cũ để server trả conflict thật.

Hydration package/child/assignment chạy sau khi mở breakdown cũng đi qua cùng phép rebase ba chiều. Record server mới được đưa vào baseline của draft; local business edit không bị pagination pull trước lúc commit ghi đè. Assignment đã được aggregate-version command clone sang physical package mới giữ nguyên `id`/`rowVersion` khi lựa chọn nhân sự không đổi; chỉ assignment thêm/xóa thực sự mới xuất hiện trong diff, tránh trùng business key `(targetId, type, empId)`.

## Compatibility impact

Không thay đổi tenant isolation, module permission, assignment/record scope, role, entitlement hoặc dữ liệu người dùng được phép xem. Historical plan/package và child snapshot vẫn bất biến, chỉ xem. Optimistic locking và rollback toàn transaction backend được giữ nguyên. Thay đổi UX duy nhất là conflict đã xác nhận không còn recovery choice và local batch bị conflict bị loại bỏ khi F5; mutation khác không thuộc receipt đó vẫn tồn tại.

## Migration strategy

Không đổi schema server hoặc IndexedDB. Storage key `bf_conflict_recovery_drafts_v1` được đọc tương thích như conflict marker; startup mới xóa marker trong đúng workspace thay vì cung cấp thao tác apply. Lựa chọn package bổ sung intent in-memory `latest|historical`; dữ liệu cũ không có intent được xem là stale selection và normalize về snapshot của latest plan.

## Regression seams

- Edit plan hiện hữu tạo draft và child save không gọi sync.
- Commit draft diff không chứa historical plan/package hoặc record không đổi.
- Push thành công cập nhật rowVersion canonical/local DB/outbox kế tiếp.
- `ROW_VERSION_CONFLICT` không mở dialog; F5 xóa marker trước full pull và giữ unrelated outbox.
- Force/delta sync normalize stale package ID về latest, nhưng giữ historical selection có chủ ý.
- Delta record khác hoặc chỉ đổi rowVersion rebase draft; concurrent business edit cùng record vẫn tạo conflict thật.
- Breakdown hydration không ghi đè package edit và không biến assignment clone không đổi thành upsert mới.
- Backend stale CAS trả 409, correct CAS tăng rowVersion, historical parent mutation bị từ chối và aggregate clone remap assignment đúng physical package mới.
