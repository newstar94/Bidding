# Changelog review/refactor

## 2026-07-26 — Giai đoạn review và đề xuất

### Phạm vi

Đã review repository tại HEAD `1fb76ad` và diff từ merge-base `abeca2ac4d47d978b1363aa542474216e274a679` với `origin/main`.

### File đã tạo

- `CODE_REVIEW_REPORT.md`
- `DEAD_CODE_REPORT.md`
- `REFACTOR_PLAN.md`
- `PERFORMANCE_REPORT.md`
- `CHANGELOG_REFACTOR.md`

### Mã nguồn đã sửa

**Không có.** Giai đoạn này chỉ tạo tài liệu review/đề xuất theo yêu cầu:

- không sửa frontend/backend;
- không sửa database schema;
- không chỉnh migration đã áp dụng;
- không đổi dependency/lockfile;
- không đổi cấu hình deploy/CI;
- không ghi dữ liệu ứng dụng.

Workspace đã có sẵn trạng thái xóa `ke-hoach-bao-cao-danh-gia-chi-tiet.md` trước khi tạo các artifact review; lượt review không tạo, khôi phục hay chỉnh sửa thay đổi đó.

### Code đã xóa

Không có. `DEAD_CODE_REPORT.md` ghi 21 import binding `SAFE_TO_REMOVE` và các candidate cần xác nhận cho PR implementation riêng.

### Module đã tách

Không có. `REFACTOR_PLAN.md` mô tả seam/interface/module mục tiêu và thứ tự PR.

### Public interface được giữ nguyên

Toàn bộ public behavior/interface hiện tại được giữ nguyên vì không sửa source.

### Public interface đã thay đổi

Không có.

### Test đã thêm

Không có.

### Kiểm tra đã chạy

| Lệnh/nhóm | Kết quả |
|---|---|
| Full Python suite | 985 đạt, 1 bỏ qua, 1 lỗi |
| `node --test tests/js/*.test.mjs` | 130/130 đạt |
| `node --test tests/js/detailed_evaluation.test.mjs` | 40/40 đạt |
| `npm run build:secure` | Đạt |
| `python scripts/package_production.py --check` | Đạt |
| Coverage backend | 72%, coverage gate hiện tại đạt |
| `pip-audit` | Không có vulnerability Python đã biết |
| Bandit | Đạt |
| `npm run lint:security` | Đạt |
| `python scripts/security_static_gate.py` | Lỗi: 10 dynamic-SQL fingerprint cần review |
| `npm audit --audit-level=high` | Lỗi: 5 High |
| Linux document sandbox probe | Không chạy được trên Windows |

Lỗi Python còn lại:

- `tests/test_frontend_navigation_stability_policy.py::test_focus_indicators_share_one_compact_width_token`
- Nguyên nhân: `views/css/views.css:3924` dùng outline 3px thay vì token 1px.

### Benchmark

- Secure build: 6,25 giây ở lần warm hiện tại; lượt trước 8,84 giây.
- Bundle: 39 JS chunk, 1.745.238 byte raw, 379.856 byte gzip.
- PostgreSQL local seeded snapshot: 17.10; hot query mẫu dùng index và không sequential scan.
- Worker snapshot: 71.113 poll, 71.112 poll rỗng, khoảng 3,77 giây DB execution cộng dồn.
- Audit-chain snapshot: 425 full verification, 113 audit row hiện tại.
- Không có số “sau tối ưu” vì chưa triển khai tối ưu.

### Vấn đề còn lại

Ưu tiên P0/P1:

1. Schema mới hơn đang được code cũ chấp nhận vô điều kiện.
2. Migration v11 không bảo toàn trạng thái hồ sơ giấy.
3. Mutation batch có thể bị discard và mất dữ liệu.
4. Image path chưa namespace theo tenant.
5. Backend detail report vẫn bắt buộc “lý do không đạt” dù UI đã bỏ.
6. Excel import cũ có race target package.
7. Contract chưa ràng winner/lot.
8. Sparse evaluation update có thể xóa field cũ.
9. Failed document job behavior trái runbook.
10. Release gate CSS, dynamic SQL và npm audit đang đỏ.

Yêu cầu đối chiếu tên nhà thầu trong workbook muasamcong hiện đã có test và đang đạt; hardening identity/import context được lập kế hoạch ở PR 6A/6B trong `REFACTOR_PLAN.md`.
