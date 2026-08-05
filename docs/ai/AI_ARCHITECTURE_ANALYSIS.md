# Phân tích kiến trúc tích hợp AI

## Kiến trúc hiện tại

- Backend là Starlette, route tập trung ở `backend/app.py`, logic nghiệp vụ nằm trong các module backend.
- Database runtime là PostgreSQL qua `backend/db/db_helper.py`; qmark SQL được chuyển sang placeholder PostgreSQL.
- Migration tuần tự dùng `backend/db/upgrades.py`; schema fresh được sinh từ `SCHEMA_DINH_NGHIA`.
- Session được xác thực bởi `verify_session`; workspace được resolve từ session + `X-Active-Org` qua `get_active_org`.
- Quyền module/bản ghi nằm ở `backend/shared/access_policy.py`, gồm manager, employee, personal workspace và assignment scope.
- Frontend là JavaScript module thuần, không thêm framework; API dùng `frontend/shared/apiClient.js`, workspace lưu theo scope.

## Điểm tích hợp

- `backend/ai/routes.py` chỉ làm HTTP validation và chuyển quyền cho service.
- `backend/ai/permission_context.py` tạo context server-owned gồm user, workspace, role và permission.
- `backend/analytics/semantic_registry.py` là registry metric/date/group allowlist dùng chung cho aggregation.
- `backend/ai/tools/` là catalog tool đọc; `query_scope.py` áp record scope trước query.
- `frontend/assistant/AssistantController.js` mount lazy sau workspace bootstrap; khi flag tắt không tạo trigger/panel.

## Entity nguồn

| Năng lực | Entity/trường chính | Ghi chú |
|---|---|---|
| Gói thầu | `goi_thau.gia_goi_thau`, `trang_thai`, `thoi_gian_*` | Có assignment scope cho employee |
| Kế hoạch | `ke_hoach_lcnt.tong_muc_dau_tu`, `phe_duyet`, `ngay_phe_duyet` | Có scope trực tiếp hoặc qua gói được giao |
| Hợp đồng | `hop_dong.gia_tri`, `ngay_ky`, `ngay_thanh_ly`, `trang_thai_hop_dong` | Thanh lý dùng `ngay_thanh_ly`, không thay bằng `updated_at` |
| Giao việc | `phan_cong_nhan_su` | Chỉ current user với tool assignment |

## Giả định cần xác nhận

- “Giá trị hợp đồng” mặc định là `gia_tri` theo `ngay_ky`; câu hỏi thanh lý dùng `ngay_thanh_ly`.
- Chậm tiến độ chỉ được tính khi bảng mốc `goi_thau_moc_tien_do` có ngày dự kiến và trạng thái hoàn tất rõ ràng.
- Kho tài liệu pháp luật/RAG chưa được bật; mode tư vấn phải nói rõ khi chưa có citation.

## File dự kiến/thực tế

Backend: `backend/ai/`, `backend/analytics/`, `backend/db/schema.py`, `backend/db/upgrades.py`, `backend/db/postgres_schema.py`, `backend/app.py`.

Frontend: `frontend/assistant/`, `frontend/app/workspaceBootstrap.js`, `frontend/app/BiddingController.js`.

Tests/docs: `tests/ai/`, `docs/ai/`.
