# ADR 0012 — Shared ProcurementCase cho làm rõ và kiến nghị

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 20/21

CLARIFICATION và PETITION dùng chung một ProcurementCase module. Case thuộc package lineage, còn mỗi response revision/transition pin exact package version; version mới share case, không clone history. Case kế thừa canonical parent read/write scope; responsibility chỉ metadata và external party không có workspace access. CLARIFICATION dùng direction INBOUND/OUTBOUND và state `DRAFT → UNDER_REVIEW → APPROVED → ISSUED → CLOSED`, với RETURNED/WITHDRAWN/reopen audited; edit sau approve tạo revision mới, làm approval stale và quay DRAFT. PETITION taxonomy v1 là `E_HSMT`, `CONTRACTOR_SELECTION_RESULT`, `OTHER`, state `RECEIVED → ASSIGNED → UNDER_REVIEW → DRAFT_RESPONSE → APPROVED → ISSUED → CLOSED`, có RETURNED/WITHDRAWN/REJECTED/reopen. Legal conclusion cần exact binding; thiếu SLA/binding trả NOT_EVALUATED. External revision chỉ tạo SourceObservation, không auto-create hoặc overwrite official case.

## Compatibility impact

Legacy clarification lists tiếp tục đọc đầy đủ trong shadow phase. Không pair theo index/time/content; ambiguity cần manual preview/link. Không thêm module/capability hoặc dùng responsibility để cấp quyền.

## Migration và rollback

Thêm typed tenant-safe case target, case head, immutable response revisions, transitions, attachments và source observations. Chạy legacy inventory/shadow parity, rồi new-create và cutover write authority. Rollback giữ legacy và case history readable, không xóa hoặc ghi ngược lists cũ.

## Regression seams

Lineage/exact-version ownership, parent authorization/revocation/full data, responsibility no-access, state matrices, stale approval, response immutability, SLA NOT_EVALUATED, attachment scope, audit atomicity, legacy ambiguity và source reconciliation/idempotency/no-overwrite.
