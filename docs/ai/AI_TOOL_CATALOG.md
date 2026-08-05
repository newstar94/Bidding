# Catalog tool đọc

| Tool | Permission | Input chính | Output | Giới hạn |
|---|---|---|---|---|
| `aggregate_packages` | `goithau.view` | metric/date/status/group/limit | summary + group records + sources | limit 20, date range 5 năm |
| `list_packages` | `goithau.view` | date/status/limit | tối đa 20 record | record scope bắt buộc |
| `aggregate_plans` | `kehoach.view` | metric/date/status/group/limit | summary + sources | limit 20, date range 5 năm |
| `list_plans` | `kehoach.view` | date/status/limit | tối đa 20 record | record scope bắt buộc |
| `aggregate_contracts` | `hopdong.view` | metric/date/status/group/limit | Decimal summary + sources | limit 20, date range 5 năm |
| `list_contracts` | `hopdong.view` | date/status/limit | tối đa 20 record | record scope bắt buộc |
| `get_my_assignments` | `assignments` | limit | assignment của user hiện tại | limit 20 |
| `get_overdue_assignments` | `assignments` | limit | việc quá hạn đã có mốc | limit 20 |
| `get_organization_dashboard` | các module cần thiết | year | widget summary | không raw rows |

Không có tool SQL, tool nhận `organization_id`, tool export hay tool ghi dữ liệu.
