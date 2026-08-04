# Báo cáo sửa lỗi và cải thiện BiddingFlow

## A. Mốc code

- Branch: `main`.
- Commit ban đầu: `e2196fb1e9e116fa11fa6de62843c361c3497cf2`.
- Commit cuối: chưa tạo commit; thay đổi đang ở working tree.
- Môi trường: Windows, Python 3.14.5, Node.js 24.18.0, npm 12.0.2.
- Báo cáo rà soát được prompt nhắc tới không tồn tại trong working tree hoặc lịch sử Git hiện có. Việc xác minh dùng prompt, code tại commit trên và test thực chạy.

## B. Lỗi đã xác minh

| ID | Trạng thái | Nguyên nhân/xác minh | Thay đổi | Test |
|---|---|---|---|---|
| BF-001 | Một phần; repo gate xanh, public-release còn block | `npm run check` ban đầu fail vì commit hiện tại xóa `docs/production-security-information.md`. Sau đó dependency audit phát hiện `cryptography 49.0.0` có CVE. | Khôi phục tài liệu bắt buộc, nâng `cryptography` 50.0.0, tách CI thành step, thêm diagnostic artifact. | `npm run check`: PASS; audit: PASS. `npm run package:production`: BLOCKED bởi legal facts bên ngoài. |
| BF-002 | Đã sửa | Award writer ghi text DB trực tiếp; `=1+1` được openpyxl lưu như formula. | Helper `safe_spreadsheet_text()` dùng chung, xử lý whitespace/control/NFKC/full-width, áp dụng cho workbook builder và award writer. | Parametrize `= + - @ TAB CR LF`, leading space, full-width; reopen workbook và kiểm tra `data_type != f`. |
| BF-003 | Đã sửa trong contract hiện có | Outcome không-award bị gom thành chuỗi mặc định. | Enum/mapping tập trung cho 8 outcome; mỗi no-award outcome có lý do riêng và không có award fields. Giá trị status ngoài dùng đúng tập data validation hiện có. | Test từng outcome, winner/non-winner, unknown không fallback. |
| BF-004 | Đã sửa hướng A; thiếu fixture muasamcong thật | openpyxl ghi lại toàn workbook nên không chứng minh ZIP preservation. | Patch trực tiếp worksheet XML; manifest gồm SHA-256/content type/relationships; mọi ZIP entry ngoài worksheet giữ nguyên hash; kiểm tra row/cell allowlist. | Entry set bằng nhau; chỉ `xl/worksheets/sheet1.xml` đổi; A–F/order/style/validation/formula/hidden sheet giữ nguyên. |
| BF-005 | Đã sửa | Service trước đây thu gọn dữ liệu ở cấp bidder/lô và chặn khi có nhiều goods. Dữ liệu chính thức đã có `stt_nguon` liên kết `goi_thau_hang_hoa_id`. | Dataset thuốc ở cấp package + lot + bidder + goods; match bằng lô + bidder/tax + STT nguồn, không dùng tên hoạt chất làm khóa; tổng item dùng `Decimal`. | Hai item cùng bidder/lô, hai bidder cùng goods, trùng STT, thiếu ID/STT, sai đơn vị, tái dùng item, lệch tổng, bảo toàn row order. |
| BF-006 | Đã sửa | Validation chỉ xét blocking structure, không xét dòng thực sự ghi. | Thêm `matchedRows`, `approvedRows`, `writableRows`, `updatedRows`; diff old/new; `NO_APPROVED_RESULT_TO_EXPORT`; defense ở route và writer. | None-approved, identical values, partial/normal write, frontend disable khi 0. |
| BF-007 | Đã sửa phần bắt buộc và hardening | Artifact tạo vô điều kiện; cleanup chỉ quét 128 entry đầu; write không atomic; không quota/claim. | Không tạo artifact khi block; cleanup sort theo expiry và xử lý metadata hỏng; quota user/org/global bytes/count; atomic fsync+rename; export lease; cancel endpoint; janitor; metrics. | Starvation >128, corrupt metadata, quota 3 scope, partial publish, concurrent claim/cleanup, tampered token. |
| BF-008 | Đã sửa các nguồn hiện có | `danh_gia_ket_luan` được select nhưng bỏ; outcome lý do phân tán. | Map kết luận sang `other_content`; duration lấy từ kết quả phê duyệt package/lot; Decimal giữ nguyên; outcome mapping tập trung. | Winner/non-winner/no-award, medicine Decimal và fields. |
| BF-009 | Đã sửa | SQL `lower(trim())` không cùng contract với Python/Excel và không xử lý NFKC/Unicode whitespace. | Migration v36 thêm/backfill `ma_phan_lo_normalized` cho lô và opening, phát hiện collision trước mutation, index trực tiếp; mọi write/matching seam dùng chung canonical function. | NFKC/NBSP/casefold/Excel numeric; migration success/collision-before-DDL; lot child và opening serializer không tin canonical từ client. |
| BF-010 | Một phần, fail-safe | Artifact là filesystem; nhiều host không an toàn nếu local disk. | Startup production từ chối `APP_INSTANCE_COUNT > 1` nếu chưa xác nhận shared storage; tài liệu deploy và env contract; atomic claim hỗ trợ shared filesystem. | Test fail-closed/confirmed config và concurrent claim. Chưa có multi-host integration environment. |
| BF-011 | Đã sửa | Validate trả tối đa 10.000 rows và warning đầy đủ; UI chỉ render page đầu. | Response mặc định giới hạn 100, summary theo code, endpoint page/filter cap 200; UI prev/next + 4 filter gọi backend; diff theo cột old/new/source; báo cáo đối chiếu riêng qua worker. | 10.000 rows, stable page/filter; JS fetch pagination/filter; report scope/audit/formula safety. |
| BF-012 | Đã sửa | Award Excel gọi policy mang tên Word và plan không biểu diễn capability riêng. | API capability tổng quát; migration v37 thêm ba grant độc lập, backfill plan cũ = 1; backend quyết định cuối. | Manager, employee, personal, super-admin, no grant, Word-only, Excel-only, award-result-only, cross-org. |
| BF-013 | Đã sửa trong award-result flow | Session thiếu trả 403. | `AUTH_REQUIRED` trả 401; thiếu quyền/entitlement vẫn 403; frontend shared handler hiện có phân biệt 401/403. | Python route 401/403 tests; JS error flow. |
| BF-014 | Đã sửa | Object URL revoke đồng bộ ngay sau click. | Revoke bằng task sau; cancel artifact khi đóng panel. | Test thứ tự click → schedule → revoke và không leak token. |
| BF-015 | Đã sửa workflow trong repo | Hai workflow còn action v4/v5. | Đồng bộ checkout/setup Python/setup Node v6 và upload-artifact v7. | Parse toàn bộ workflow YAML; test step contract. |

## C. File đã sửa/thêm

- `backend/documents/spreadsheet_security.py`: sanitizer dùng chung, không đổi numeric/date.
- `backend/documents/award_result_mapping.py`: enum và mapping outcome/status/reason.
- `backend/documents/workbook_preservation.py`: manifest và minimal OOXML worksheet patch.
- `backend/documents/award_result_excel_service.py`: matching metrics/diff, dataset mapping, preservation, artifact lifecycle/quota/claim/paging helpers.
- `backend/documents/award_result_excel/{types,templates,normalization,reports}.py`: deep interfaces đã tách cho domain types, registry/version, canonical matching và reconciliation workbook; facade cũ re-export tương thích.
- `backend/documents/award_result_excel_routes.py`: 401, entitlement Excel, no-artifact-on-block, paging/cancel endpoints, export claim.
- `backend/documents/excel_workbook_builder.py`: tái sử dụng sanitizer chung.
- `backend/db/schema.py`, `backend/db/postgres_schema.py`, `backend/db/upgrades.py`: canonical lot columns/index (v36) và document export capabilities (v37).
- `backend/shared/subscription_policy.py`: policy export theo format/feature và grant DB riêng, giữ wrapper tương thích Word.
- `backend/lifecycle.py`, `backend/observability/metrics.py`: janitor, readiness và artifact metrics.
- `frontend/packages/detail/AwardResultExcelExport.js`: metrics/preview, writable gate, cancel token, deferred Object URL revoke.
- `.github/workflows/*.yml`: step CI tách biệt, diagnostics luôn upload, action versions đồng bộ.
- `pyproject.toml`, `requirements.txt`: `cryptography==50.0.0` và hashes mới.
- `.env.example`, `README.md`, `deploy/README.md`: quota/shared storage/single-vs-multi replica contract.
- `docs/production-security-information.md`: khôi phục tài liệu production mà test và vận hành yêu cầu.
- Tests award-result/service/routes/frontend/mapping/workflow được mở rộng; không hạ baseline hoặc coverage gate.

## D. API/DB/UI

- `GET /api/packages/{package_id}/award-result-excel/preview`: phân trang/filter `status`, `warning`, `matchMethod`, `writable`; page size tối đa 200.
- `POST /api/packages/{package_id}/award-result-excel/reconciliation`: tạo file `<source>_bao_cao_doi_chieu.xlsx` từ dữ liệu backend được tính lại; token không bị consume.
- `DELETE /api/packages/{package_id}/award-result-excel/validation`: hủy token/artifact đúng user/org/package.
- Validate response thêm metrics, warning/error summary, template version/fingerprint, page metadata và chỉ trả page đầu.
- Migration v36 backfill canonical lot code fail-closed khi collision; migration v37 backfill capability legacy. Cả hai chạy trong transaction của schema upgrader.
- UI có pagination/filter thật, diff old/new/source, nút tải reconciliation; frontend chỉ gửi token, không gửi result values.
- Audit export dùng đúng `len(updates)`; validation audit không log workbook content/token.

## E. Workbook preservation

- Writer không còn `workbook.save()` cho award-result; chỉ worksheet XML đích được patch.
- ZIP entry set trước/sau bằng nhau.
- SHA-256 mọi entry ngoài target worksheet bằng nhau.
- Row order và cell set không đổi; diff cell bắt buộc nằm trong output allowlist.
- A–F/source fingerprint, styles, number formats, data validation, hidden sheets, merged cells, formulas ngoài vùng ghi và document properties giữ nguyên trong regression fixture.
- File nguồn là immutable bytes. Repo không có fixture muasamcong thực tế; test hiện dùng fixture openpyxl giàu cấu trúc. Đây là giới hạn chưa được che giấu.

## F. Kết quả test thực

```text
npm run check
PASS — 425 Python tests, 306 JavaScript tests, coverage 38.50% (gate 28%), secure build, FK/index audit, package --check, SBOM

python -m pytest -q tests/test_award_result_excel_service.py tests/test_award_result_excel_routes.py tests/test_award_result_excel_worker.py tests/test_lot_code_normalization.py tests/test_document_export_entitlements.py
PASS — 76 tests

python -m pytest -q tests/test_n_plus_one_regressions.py
PASS — 21 tests

npm run audit:dependencies
PASS — npm 0 vulnerabilities; pip-audit no known vulnerabilities

python scripts/package_production.py --check
PASS — 318 runtime files, extracted-runtime smoke check passed

npm run package:production
BLOCKED — LEGAL_FACT_UNAPPROVED=27, LEGAL_PLACEHOLDER_PRESENT=27

npm run test:performance
PASS — isolated origin; cold p95 418 ms / limit 800 ms, warm budget pass, no long-task failure

npm run test:auth-shell
PASS — overlay/loader/profile menu/create modal assertions

npm run test:auth-roles-e2e
PASS — 14 role/session/security/registration steps against fresh PostgreSQL DB and exact origin
```

## G. CI

Nguyên nhân failure ban đầu là tài liệu `docs/production-security-information.md` bị xóa tại commit mốc nhưng test vẫn coi đây là production contract. Sau khi khôi phục, repo gate xanh. Dependency gate sau đó phát hiện CVE ở cryptography 49 và đã được sửa bằng 50.0.0.

Workflow đã tách Python compile, Python quality, ESLint/Trusted Types, debt, Python tests, JS tests, secure build, FK/index, package validation, SBOM, performance/E2E, dependency audit và production archive. Diagnostic reports/logs upload bằng `if: always()`.

Auth-role E2E từng tự kích hoạt adaptive bot challenge vì ba negative-login assertions dùng chung rate-limit state với positive-login phase. Fixture nay xóa riêng test rate-limit buckets tại ranh giới phase; CI khai báo `TURNSTILE_ENABLED=false` rõ ràng. Production Turnstile/rate-limit không bị tắt hoặc nới ngưỡng.

Full hosted CI chưa thể được tuyên bố xanh vì production-public legal gate cần dữ liệu/phê duyệt bên ngoài repository. Gate này được giữ fail-closed, không dùng `continue-on-error` và không bị hạ.

## H. Giả định nghiệp vụ cần xác nhận

- Workbook hiện chỉ có data validation `Trúng thầu,Không trúng thầu`. Các no-award outcome dùng status hợp lệ thứ hai nhưng luôn có lý do outcome-specific; cần chủ sản phẩm/pháp chế xác nhận wording chính thức.
- Duration xuất từ trường kết quả phê duyệt ở package/lot, không dùng thời gian chào trong opening.
- Plan legacy được backfill cả ba capability để giữ tương thích; plan mới có thể grant Word/Excel/award-result độc lập.
- `001.0` canonical thành `001`; leading zero khác vẫn giữ.

## I. Rủi ro và phần chưa hoàn tất

- Thiếu 27 legal facts, nguồn bằng chứng, ngày/người phê duyệt và 27 public placeholders; không được tự điền.
- Không có fixture `.xlsx` muasamcong thật trong repo để chứng minh compatibility ngoài fixture test.
- Tìm kiếm nguồn công khai chính thức chỉ xác nhận portal có chức năng “Xuất Excel”; không tìm được URL tải trực tiếp có thể truy nguyên. Cần operator có phiên đăng nhập cung cấp file đã tải và xác nhận quyền lưu fixture.
- Data-readiness trả `editPath`, nhưng UI chưa render thành deep-link điều hướng trực tiếp.
- Refactor đã tách types/templates/normalization/reports/security/mapping/preservation; inspection/matching/dataset/artifact service vẫn còn trong facade lớn và chưa đạt toàn bộ cây module mục tiêu.
