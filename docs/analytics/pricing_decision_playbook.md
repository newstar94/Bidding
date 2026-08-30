# Pricing Decision Playbook

Quan sát tối thiểu 60–90 ngày sau khi telemetry ổn định. Không thay catalog từ một tuần dữ liệu và không dùng một metric đơn lẻ.

## Team tier review

Theo commercial release và owner type, đọc P50/P75/P80/P90/P95 monthly active seats, histogram và tỷ lệ ≥80%/over quota tại tier 1/5/15/50. Chỉ đề xuất thay mốc khi nhiều cohort đủ mẫu lặp lại qua ít nhất hai monthly snapshots. Enterprise chỉ là evidence khi MAS >50 hoặc pressure gần 50 lặp lại; không tự tạo sản phẩm.

## Procurement quota review

Theo từng Connected tier, annualize successful unique fetches và so P25/P50/P70/P75/P80/P90/P95 với included quota. Cache hit/retry/failure không tính billable fetch. Kết hợp utilization, expiry unused, provider cost và retention; không nâng quota chỉ vì một outlier.

## Credit pack review

Đọc sales mix, repeat packs, unused/expired credits, pack switching và break-even. Pattern 20-pack ≥4 lần/45 ngày là evidence cho pack 100, không phải trigger upsell tự động. Luôn so top-up spend với price gap sang Connected cùng size/release.

## Price review

Quyết định cần đồng thời:

```text
revealed willingness to pay
+ retention/value
+ cost to serve
+ contribution margin
+ structured feedback
```

Association feature-retention/conversion không chứng minh causation. Không personalized dynamic pricing kiểu heavy user → higher price. Experiment tương lai phải cohort-random, versioned release, transparent và giữ offer ổn định.

## Plan-fit interpretation

- `UNDER_SIZED`: ≥2 pressure signals qua ≥2 snapshots, ví dụ seat/quota ≥80% hoặc top-up spend gần price gap.
- `OVER_SIZED`: seat <30%, quota <20% và workflow thấp qua ≥2 tháng.
- `CONNECTED_CANDIDATE`: Internal có procurement/top-up lặp lại và effective internal cost gần Connected cùng size.
- `TOPUP_HEAVY`: repeat pack/top-up spend signal đủ mạnh.
- `ENTERPRISE_CANDIDATE`: active seats >50 hoặc pressure enterprise-like lặp lại.
- `GOOD_FIT`: không có evidence đủ mạnh cho nhóm khác.

Tất cả là analysis-only; không tự nâng/hạ gói.
