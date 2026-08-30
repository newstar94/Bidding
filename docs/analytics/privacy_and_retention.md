# Privacy, Security and Retention

## Data minimization

Analytics pricing không dùng email, họ tên, IP, user-agent đầy đủ, fingerprint, AI/document content, tender/contractor/investor identity, địa chỉ hoặc inferred sensitive attributes. Aggregate export không chứa raw account/workspace ID.

Raw commercial UI events dùng `analytics_user_id` và `analytics_workspace_id` từ HMAC-SHA256 bằng `ANALYTICS_HMAC_KEY`. Key phải khác session/CSRF/encryption keys, cài qua secret manager, không log và không lưu DB. Unsalted SHA không được dùng.

`product_usage_hourly` là legacy internal fact có raw IDs để giữ FK và exact distinct semantics; dashboard mới chỉ đọc aggregate/pseudonymous projection. Support drilldown, nếu được yêu cầu sau này, phải là use case/API riêng và không được trộn vào analytics aggregate.

## Authorization

- API dashboard/refresh: `verify_session(..., "super_admin")` server-side; không dựa vào menu.
- Collector: authenticated session, strict allowlist, CSRF/origin và request-limit middleware hiện hữu, idempotency theo event ID.
- Cache key (nếu bật): toàn bộ filters + release + authorization class; không cache tenant response như global response.
- Không tạo role/capability/entitlement mới và không đổi quyền đọc dữ liệu hiện hữu.

## Small cohort policy

- `workspace_count < 10`: suppress measures và exact sample count, trả `insufficient_sample`.
- Pricing recommendation: ưu tiên `workspace_count >= 20`; dưới ngưỡng chỉ hiển thị evidence tổng hợp, không khuyến nghị.
- Không dùng suppression này để che dữ liệu nghiệp vụ người dùng vốn được phép xem; nó chỉ áp dụng báo cáo cohort pricing.

## Retention

| Data | Retention target | Treatment |
| --- | --- | --- |
| Raw commercial UI events | 180 days | scheduled delete, then aggregate remains |
| Structured commercial feedback | 180 days | scheduled delete; no free text is stored |
| `product_usage_hourly` | 12 months | scheduled delete after daily aggregation |
| Daily aggregates | 36 months | delete older aggregate |
| Exact range-funnel workspace daily fact | 36 months | delete with other daily aggregates; identifier is HMAC only |
| Weekly cohort/monthly plan fit | 36 months | delete older snapshot |
| Billing/accounting/audit | financial/legal policy | never deleted by analytics cleanup |

Maintenance is explicit and idempotent. It must never cascade into billing, payment, audit, subscription or usage-credit accounting facts.

Scheduler command:

```text
python scripts/refresh_product_analytics.py --days 90 --diagnostics
```

Retention deletion is opt-in for the scheduled maintenance run:

```text
python scripts/refresh_product_analytics.py --days 90 --prune-raw-events --prune-expired-analytics
```

The command only deletes the analytics inbox/hourly/read-model tables listed above; it does not delete billing, accounting, audit or authorization data.
