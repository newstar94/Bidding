# Decision packet mục 19 — WorkCalendar và `.ics`

**Trạng thái:** DG-19 đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0011  
**Production route/download/connector:** chưa có

## Phần đã thực hiện không cần business default

`backend/work_calendar/rfc5545.py` serialize canonical `CalendarEvent` do caller
cung cấp, không tự đọc record hay chọn field:

- UTF-8, CRLF, content-line folding tối đa 75 octets không tách multibyte;
- TEXT escape backslash, comma, semicolon và newline;
- persistent UID/explicit SEQUENCE/explicit UTC DTSTAMP từ input;
- `DATE` all-day và UTC-aware `DATE-TIME` duy nhất;
- `DTEND` cùng value type, later-than-start và non-inclusive;
- từ chối floating/non-UTC datetime cho tới khi timezone policy được duyệt.

Regression dùng parser test độc lập với serializer để unfold/parse component và
kiểm tra required properties; có golden vectors cho Unicode/long-line, all-day
exclusive end, Asia/Ho_Chi_Minh và DST zone rejection, đồng thời chứng minh dấu
`/` và `:` không bị TEXT-escape và snapshot không tự thêm `METHOD`.

Không có DB/schema, filesystem write, HTTP, provider/OAuth hoặc outbound data.
Targeted tests: `python -m pytest tests/test_rfc5545_serializer.py -q`.

Nguồn primary: [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545), nhất
là sections 3.1, 3.3.11, 3.6.1, 3.8.2.2, 3.8.4.7 và 3.8.7.4.

## DG-19-01 cần product điền trước `.ics` production

| Contract | Quyết định bắt buộc |
|---|---|
| Source facts | Exact milestone/deadline types nào được export; case facts chỉ sau 20/21 |
| Text projection | Title/description/location field nào; full/summary values; data classification |
| Time semantics | Asia/Ho_Chi_Minh local + VTIMEZONE, UTC, hay all-day; DST/ambiguous/nonexistent handling |
| All-day | Inclusive business date và exclusive `DTEND` derivation |
| UID | Stable namespace/domain + target lineage/version/milestone/instance identity; không dùng download time |
| SEQUENCE | Significant-change fields/revision source; không dùng broad rowVersion nếu unrelated field đổi |
| DTSTAMP | Canonical server event-revision timestamp; không dùng download time |
| Cancellation | Remove/STATUS:CANCELLED/new sequence behavior |
| Authorization | Download unit: one record, selected events, calendar range; denied/mixed selection behavior |
| Limits | Max events/bytes/range, filename/cache/content-disposition |

## Interface dự kiến sau duyệt

```text
WorkCalendar.project(actorContext, approved CalendarQuery)
  -> Canonical CalendarEvent[]

WorkCalendar.exportIcs(actorContext, approved CalendarQuery)
  -> text/calendar UTF-8 artifact
```

Projector owns source adapters, stable identity/revision and authorization;
serializer chỉ owns RFC encoding. HTTP là adapter và không tự assemble fields.

## DG-19-02 cho Google/Outlook connectors

Chỉ sau `.ics` acceptance và integration ADR: explicit consent, OAuth scopes,
calendar target, one/two-way sync, create/update/delete/revoke, token storage,
outbound allowlist, provider ID mapping, delta/cursor recovery, retry/idempotency,
authorization revocation và cleanup. Không auto-push trước decision.

## Compatibility/rollback

- `.ics` phase có thể không cần migration nếu UID/sequence được derive từ
  authoritative facts; nếu cần event-head table thì append-only migration sau DG.
- Feature flag route/UI; kill switch bỏ download nhưng không đổi timeline facts.
- Connector rollback dừng enqueue/send mới, revoke token theo ADR, giữ reconciliation
  metadata; không xóa business milestone.
- Calendar export không phải masking của record API và không dùng Word entitlement.
