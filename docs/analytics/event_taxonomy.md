# Analytics Event Taxonomy

## Meaningful feature keys

Feature keys do code sở hữu; client không gửi arbitrary key hoặc payload nghiệp vụ.

```text
planning.create
planning.import_excel
planning.update
package.create
package.update
package.issue
package.open
package.evaluate
package.award
contract.create
contract.update
procurement.lookup
procurement.fetch
procurement.import
contractor.lookup
contractor.violation_check
document.word_export
document.excel_export
document.award_export
collaboration.member_assign
collaboration.expert_assign
ai.request
ai.tool_call
```

Legacy navigation keys trong `product_usage_hourly` vẫn được đọc để giữ compatibility/coverage nhưng không được diễn giải là First Value nếu chỉ là mở tab.

## Commercial UI events

```text
pricing.viewed
pricing.size_selected
pricing.variant_compared
pricing.offer_selected
upgrade.prompt_shown
upgrade.prompt_clicked
quota.warning_shown
quota.topup_clicked
checkout.started
checkout.cancelled
subscription.cancel_intent
downgrade.started
```

Payload cho phép: `event`, `eventId`, `ownerKind`, `sizeBucket`, `skuCode`, `commercialReleaseId`, `source`, `occurredAt`. Server xác định authenticated actor, chuẩn hóa timestamp, HMAC user/workspace ID và từ chối trường ngoài contract. Không có JSON metadata tự do.

## Authoritative facts — không gửi từ frontend

```text
payment verified/refunded
subscription activated
procurement reserved/consumed/released
procurement source snapshot committed
document export completed
AI request/tokens/tool calls
quota allocated
```

Authoritative funnel outcome names projected by the aggregation job are:

```text
payment.verified
payment.failed
refund.succeeded
subscription.activated
subscription.activation_failed
first_paid_value
```

They are derived from stored billing/payment/subscription/value facts and cannot
be submitted through the frontend event collector.

## Structured feedback

Moments: `checkout_abandoned`, `second_topup`, `upgrade_completed`, `cancel_or_downgrade_intent`, `paid_day_45_60`.

Checkout reasons: `too_expensive`, `not_needed_yet`, `benefits_unclear`, `payment_method`, `need_internal_approval`, `technical_issue`, `other`. V1 không nhận hoặc lưu free text; payload có trường ngoài allowlist bị từ chối. Đây là quyết định data-minimization, không phải personalized pricing.
