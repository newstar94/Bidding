# ADR 0009 — Ràng buộc pháp lý lịch sử và AI chỉ giải thích finding xác định

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 8 và 12

Kế hoạch dùng ngày phê duyệt, gói thầu dùng ngày phát hành/đăng tải E-HSMT làm anchor. Phase 1 chỉ có catalog `SYSTEM` do super-admin quản trị; không organization override. Applicability policy có version và không fallback “latest”: thiếu fact, overlap hoặc transition chưa phân giải tạo `UNRESOLVED`, `AMBIGUOUS` hoặc `MANUAL_REVIEW_REQUIRED`. Binding pin exact immutable source profile; business version mới tự resolve theo facts của nó, legacy không auto-backfill luật hiện tại. Compliance bundle v1 chỉ tạo deadline/timeline-readiness finding `PASS/FAIL/NEEDS_REVIEW/NOT_EVALUATED`; AI assistant hiện hữu fresh-authorize snapshot rồi chỉ giải thích/cite, không tạo finding hoặc mutation. Legal conclusion giữ `NOT_EVALUATED` cho tới khi legal reviewer duyệt citation fixtures.

## Compatibility impact

Historical record không tự nhận luật hiện hành và RAG current/retired không trở thành legal authority. Không thêm sensitive-read capability, không đổi record fields hoặc Word entitlement. Một số target sẽ hiển thị unresolved thay vì một luật được đoán.

## Migration và rollback

Thêm immutable system catalog/profile/policy/binding history và typed plan/package relation. Legacy chạy shadow inventory/review, không backfill tự động. Rollback bỏ projection mới nhưng giữ append-only history; kill switch đưa legal/compliance impact về `NOT_EVALUATED`.

## Regression seams

Before/on/after anchor, transition/overlap, no-latest fallback, immutable exact source/hash, tenant-safe typed binding, version re-resolve, legacy unresolved, AI no-hallucination, fresh auth/revocation, citation trace và no-write tool.
