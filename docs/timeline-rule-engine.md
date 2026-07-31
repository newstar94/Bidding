# Effective timeline và checklist động

Timeline dùng một seam thuần `buildEffectiveTimeline(packageData, relatedEntities, savedEntries)` ở cả hai runtime. Catalog chuẩn nằm tại `shared/timeline_rules.json`; frontend nạp JSON trực tiếp, backend đọc cùng file. Catalog chứa `milestoneKey` ổn định, section, tiêu đề, đơn vị ban hành, nguồn dữ liệu, tag, predicate, cờ lặp, thứ tự và mã cũ.

## Mapping tương thích

| Dữ liệu cũ | Dữ liệu chuẩn |
| --- | --- |
| `maMoc` (`1.1` … `5.13`) | `milestoneKey` theo `shared/timeline_rules.json` |
| không có instance | `instanceKey = ""` |
| dòng lặp từ entity | `instanceKey = sourceEntityId` |
| STT hiển thị | `displayCode`, tính lại sau khi lọc |
| `yeuCauThamDinhHsmt = Có`/`true` | `yeuCauThamDinhHsmtCode = REQUIRED` |
| `yeuCauThamDinhHsmt = Không`/`false` | `yeuCauThamDinhHsmtCode = NOT_REQUIRED` |
| rỗng/null/chưa có | `yeuCauThamDinhHsmtCode = UNDETERMINED` |

Migration v33 backfill khóa mốc cũ và thêm `goi_thau_dieu_chinh_hsmt`; migration v34 bổ sung index cho các FK actor audit. Entry cũ không còn áp dụng chỉ bị ẩn; UI khi lưu giữ các entry bị ẩn để khôi phục.

## Rule đã triển khai

- Ba trạng thái áp dụng; `CONDITIONAL` không vào progress, overdue hoặc xuất chính thức.
- Thẩm định E-HSMT ba trạng thái, evidence tự nhận diện và cảnh báo xung đột khi người dùng chọn `NOT_REQUIRED` nhưng dữ liệu đã phát sinh.
- Chào hàng cạnh tranh loại toàn bộ tag `APPRAISAL`.
- Kế hoạch riêng/gộp và phương thức 1G1T/1G2T dùng predicate tập trung.
- Chỉ định thầu, chỉ định rút gọn và lựa chọn đặc biệt có nhánh loại/conditional riêng, không tái sử dụng nguyên timeline cạnh tranh.
- Tư vấn lập/thẩm và tổ chuyên gia/tổ thẩm định dựa trên contract/team entity; thiếu dữ liệu là `CONDITIONAL`.
- Điều chỉnh E-HSMT, làm rõ và gia hạn sinh instance lặp theo entity; instance có khóa ổn định và idempotent.
- Khi tạo phiên bản gói thầu (`phienBan > 00`), hệ thống tự bảo đảm entity `QĐ phê duyệt điều chỉnh E-HSMT` với khóa `package-version:<packageId>`. `sequence` lấy từ `phienBan`, số/ngày quyết định lấy từ phiên bản mới; dữ liệu phiên bản cũ không có entity vẫn được evaluator suy luận tương thích ngược.
- `effectiveClosingTime` luôn là giá trị lớn nhất giữa `thoiGianDongThau` của phiên bản và mọi mốc `giaHanList` đang hoạt động; dùng chung cho giao diện, cảnh báo quá hạn và xuất Word.
- Timeline không còn luồng “Thêm điều chỉnh E-HSMT” thủ công; người dùng vẫn có thể ẩn một instance đã phát sinh, và tombstone đó được giữ khi lưu/sync.

## Thêm milestone/rule mới

1. Thêm một object vào `shared/timeline_rules.json`, chọn `milestoneKey` không đổi, `sectionKey`, `sortAnchor`, `tags`, `applicabilityRule`, `source` và `legacyCodes` nếu cần.
2. Nếu là mốc phát sinh, đặt `repeatable: true` và `source.entity` trỏ tới danh sách entity; không dùng STT làm khóa.
3. Nếu predicate mới chưa có, thêm cùng tên vào evaluator JS và Python, rồi thêm fixture vào `tests/fixtures/timeline_parity.json`.
4. Chạy `node --test tests/js/timeline_rule_engine.test.mjs` và `python -m pytest -q tests/test_timeline_rule_engine.py` trước khi chạy hồi quy.

Catalog được đối chiếu với sheet `Check list` trong `File gốc thông thường.xlsx` (55 dòng, 48 mốc tĩnh). Workbook là danh sách tối đa; rule engine không mặc định coi mọi dòng là bắt buộc.
