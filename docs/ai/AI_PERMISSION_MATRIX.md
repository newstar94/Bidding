# Ma trận quyền AI

| Capability/tool | Manager | Employee | Personal owner | Nguồn quyết định |
|---|---:|---:|---:|---|
| `ai.chat` | Có khi `AI_ENABLED` | Có khi `AI_ENABLED` | Có khi `AI_ENABLED` | Session + workspace |
| `aggregate_packages` | Toàn workspace | Chỉ bản ghi được giao nếu policy hiện tại giới hạn | Workspace cá nhân | `visibility_clause` + `goithau` |
| `aggregate_plans` | Toàn workspace | Giao trực tiếp hoặc qua gói được giao | Workspace cá nhân | `visibility_clause` + `kehoach` |
| `aggregate_contracts` | Toàn workspace | Chỉ hợp đồng được giao nếu bị giới hạn | Workspace cá nhân | `visibility_clause` + `hopdong` |
| `get_my_assignments` | Chỉ assignment của user hiện tại | Chỉ assignment của user hiện tại | Không rò workspace khác | `user_id` từ session |
| `get_organization_dashboard` | Snapshot workspace | Snapshot theo scope hợp lệ | Snapshot cá nhân | Tool gọi lại semantic scope |
| Tool ghi dữ liệu | Không có trong MVP | Không có trong MVP | Không có trong MVP | Registry từ chối |

Frontend không gửi `organizationId`, `role` hoặc permission làm nguồn sự thật. `X-Active-Org` chỉ là lựa chọn workspace; backend đối chiếu membership/session lại.
