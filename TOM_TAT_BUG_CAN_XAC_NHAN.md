# Tóm tắt lỗi cần xác nhận

> **Cập nhật sau triển khai 2026-07-27:** File này là snapshot triage trước sửa. B1–B10 đã hoàn thành; NV1–NV6 đã được ghi thành ADR và triển khai đúng quyết định. Trạng thái lỗi hiện hành nằm tại `BUGS_KIEM_THU_TOAN_BO_2026-07-27.md` và hiện không còn bug code mở trong phạm vi kiểm thử cục bộ.

## 0. Trạng thái triển khai hiện tại

| Nhóm | Trạng thái đã xác minh |
|---|---|
| B1 | Backend cho phép tiêu chí `fail` không có lý do chi tiết; lý do thuộc báo cáo tổng quát |
| B2 | Outbox bền vững giữ mutation qua lỗi 500/409/offline/reload và edit đồng thời |
| B3 | Media namespace theo tenant, có test ghi/đọc/xóa chéo tổ chức |
| B4 | Import giữ immutable package/bid/lot context và hủy commit khi context đổi |
| B5 | Sparse update phân biệt thiếu field với yêu cầu xóa |
| B6 | Idempotency lưu request hash và trả conflict khi cùng ID khác payload |
| B7–B8 | Production chỉ dùng secure package; focus 3px đã dùng token 1px |
| B9 | Failed document job được giữ có thời hạn, tra cứu và chạy lại |
| B10 | Sai tên nhà thầu hiện cảnh báo “Vẫn nhập”/“Hủy”, không chặn cứng |
| KT1–KT6 | Ranking/batch/backoff/deep module/21 import/security baseline/dependency audit đã xử lý hoặc có quyết định đo trước khi tối ưu thêm |

Mục đích của file này là giúp phân biệt:

- **BUG CODE:** hành vi kỹ thuật sai hoặc có thể làm mất/ghi nhầm dữ liệu; sửa không làm thay đổi nghiệp vụ đã nêu.
- **CẦN XÁC NHẬN NGHIỆP VỤ:** code có thể đang làm đúng một quy định chủ ý của bạn.
- **KỸ THUẬT:** hiệu năng, bảo trì hoặc release gate; chưa phải lỗi nghiệp vụ trực tiếp.

## 1. Bug code nên sửa

| ID | Vấn đề | Hành vi hiện tại | Vì sao là bug code | Đề xuất |
|---|---|---|---|---|
| B1 | Không lưu được tiêu chí “Không đạt” | UI đã bỏ ô “Lý do không đạt”, nhưng backend vẫn bắt buộc có lý do | Hai phía dùng hai quy định khác nhau; người dùng không có chỗ nhập nhưng server lại yêu cầu | Bỏ điều kiện bắt buộc lý do tại báo cáo chi tiết; lý do chỉ nhập ở báo cáo tổng quát |
| B2 | Bản nháp có thể biến mất | Khi sync lỗi, mutation đang chờ có thể bị xóa rồi dữ liệu server được nạp đè lại | Người dùng đã lưu nhưng lỗi mạng/server không được phép làm mất dữ liệu chưa đồng bộ | Giữ hàng đợi thay đổi bền vững và chỉ xóa sau khi server xác nhận thành công |
| B3 | Có thể ghi đè ảnh giữa hai đơn vị | Tên file ảnh chỉ chứa ID bản ghi, không chứa organization | Hai organization được phép có cùng ID nên có thể tạo cùng đường dẫn ảnh | Tách thư mục/tên file theo organization |
| B4 | Import Excel có thể ghi nhầm gói | Một số luồng import cũ đọc lại gói đang chọn sau khi đã bắt đầu đọc file | Nếu người dùng đổi gói trong lúc xử lý, bước đọc và bước lưu có thể dùng hai gói khác nhau | Cố định package/bid/lot ngay lúc chọn file; nếu người dùng chuyển gói thì hủy import |
| B5 | Cập nhật một trường có thể xóa trường khác | Backend nhận một trường đánh giá nhưng ghi lại toàn bộ cột; trường không gửi lên thành rỗng | “Không gửi trường” đang bị hiểu thành “xóa trường” | Phân biệt rõ: thiếu field = giữ nguyên; null/rỗng = xóa theo quy định |
| B6 | Trùng mã yêu cầu nhưng khác dữ liệu | Cùng `clientMutationId` luôn nhận kết quả cũ, kể cả payload đã khác | Có thể báo lưu thành công trong khi dữ liệu mới chưa được lưu | Lưu thêm hash payload; cùng ID nhưng khác hash phải trả conflict |
| B7 | Hướng dẫn build production sai | README cho phép `build:plain`, trong khi release chuẩn yêu cầu secure build | Có thể phát hành gói bỏ qua security/vendor gate | Production chỉ dùng `npm run package:production` hoặc `build:secure` |
| B8 | Một kiểm thử CSS đang lỗi | Focus của dấu X dùng viền 3px, policy chung yêu cầu 1px | Đây là lỗi nhất quán giao diện/gate, không liên quan nghiệp vụ | Dùng token focus chung và chạy lại policy test |
| B9 | Job tài liệu lỗi bị xóa | Sau lần lỗi cuối, file và bản ghi job bị xóa | Trái quy định vừa xác nhận: phải giữ để tra cứu và chạy lại | Giữ failed job có thời hạn, lưu lỗi và cung cấp thao tác chạy lại |
| B10 | File Excel sai nhà thầu đang bị chặn | Luồng muasamcong hiện dừng import hoàn toàn khi tên không khớp | Trái quy định vừa xác nhận: chỉ cảnh báo, người dùng vẫn được tiếp tục | Hiện rõ hai tên và cho chọn “Vẫn nhập” hoặc “Hủy” |

## 2. Kết quả xác nhận nghiệp vụ

| ID | Quyết định đã chốt | Phân loại sau xác nhận | Hành động |
|---|---|---|---|
| NV1 | Code cũ được phép chạy với database schema mới hơn | **Nghiệp vụ/vận hành chủ ý, không phải bug** | Giữ hành vi hiện tại; không hạ metadata hoặc sửa migration đã áp dụng |
| NV2 | Không cần giữ “Trạng thái hồ sơ giấy”; dùng “Trạng thái hợp đồng” | **Nghiệp vụ chủ ý, không phải bug mất dữ liệu** | Không xây cơ chế khôi phục trạng thái hồ sơ giấy |
| NV3 | Hợp đồng không bắt buộc liên kết đúng nhà thầu trúng | **Nghiệp vụ chủ ý, không phải bug** | Giữ liên kết hợp đồng–gói thầu độc lập với kết quả trúng thầu |
| NV4 | Job lỗi phải được giữ để tra cứu và chạy lại | **Bug code B9** | Sửa cơ chế retention/retry |
| NV5 | Không cần `nguoi_cham_id` | **Yêu cầu đơn giản hóa model, không phải bug cũ** | Code hiện tại không đọc/ghi/kiểm tra trường này; chỉ giữ cột DB nullable để code cũ chạy với schema mới |
| NV6 | Sai/thiếu tên nhà thầu chỉ cảnh báo, không chặn hoàn toàn | **Sai khác giữa code và nghiệp vụ — B10** | Cho phép người dùng xác nhận tiếp tục import |

## 3. Những yêu cầu của bạn đã được hiểu rõ

Các điểm sau **không cần xác nhận lại**:

1. Nhà thầu độc lập không hiển thị dòng “Thỏa thuận liên danh”; nhà thầu liên danh thì giữ dòng này.
2. Loại nhà thầu phải lấy theo nhà thầu đang chọn trong hệ thống, không lấy theo file upload.
3. “Lý do không đạt”, “Yêu cầu làm rõ”, “Kết quả làm rõ” được nhập ở báo cáo tổng quát, không nhập tại báo cáo chi tiết.
4. Khi mở báo cáo chi tiết mới, không tự sinh sẵn tiêu chí; người dùng chọn thêm dòng hoặc nhập Excel.
5. File Excel sai nhà thầu phải hiện cảnh báo rõ, nhưng người dùng có quyền tiếp tục nhập.

### Trạng thái kiểm tra tên nhà thầu tại snapshot trước sửa

Tại snapshot ban đầu, chức năng đã nhận diện được sai tên nhưng còn chặn hoàn toàn. Hành vi hiện tại đã đổi sang cảnh báo có hai lựa chọn “Vẫn nhập” và “Hủy”:

- chuẩn hóa hoa/thường, dấu tiếng Việt và dấu gạch;
- so tên trong file với nhà thầu đang chọn;
- phát hiện khi sai tên, thiếu tên hoặc các sheet có nhiều tên khác nhau;
- hiển thị cả tên trong file và tên đang chọn;
- dữ liệu chỉ được áp khi người dùng chủ động chọn “Vẫn nhập”; chọn “Hủy” không làm thay đổi draft.

Import đã cố định package/bid/lot context để không đổi gói giữa lúc xử lý. Nhận diện tên tiếp tục là kiểm tra cảnh báo theo ADR 0006, không trở thành khóa cứng dựa trên MST/mã nhà thầu.

## 4. Vấn đề kỹ thuật, chưa phải lỗi nghiệp vụ

| ID | Vấn đề | Ảnh hưởng | Mức ưu tiên |
|---|---|---|---|
| KT1 | Xếp hạng quét lại toàn bộ bảng khi gõ từng ký tự | Có thể chậm khi nhiều nhà thầu | Sau các lỗi mất/ghi nhầm dữ liệu |
| KT2 | Worker kiểm tra hàng đợi mỗi 5 giây | Nhiều query rỗng nhưng hiện tổng DB time còn thấp | Trung bình |
| KT3 | Một số file/hàm dài trên 1.000 dòng | Khó sửa và dễ phát sinh lỗi về sau | Refactor từng module sau khi có test |
| KT4 | 21 import Python không dùng | Không ảnh hưởng chức năng, chỉ gây nhiễu | Thấp; xóa trong PR cleanup riêng |
| KT5 | Dynamic SQL security baseline đang đỏ | Chưa chứng minh là lỗ hổng, nhưng chưa đủ điều kiện release | Cao trước khi phát hành |
| KT6 | `npm audit` có 5 cảnh báo High | Chủ yếu nằm trong build toolchain | Nâng dependency bằng PR riêng; không dùng `--force` |

## 5. Thứ tự sửa đề xuất

1. B1 — lưu được tiêu chí “Không đạt” không có lý do chi tiết.
2. B2 — bản nháp không biến mất khi sync lỗi.
3. B4 và B10 — cố định đúng gói/nhà thầu khi import và đổi chặn thành cảnh báo xác nhận.
4. B9 — giữ và chạy lại job tài liệu lỗi.
5. NV5 — đã loại `nguoi_cham_id` khỏi runtime; cột DB nullable chỉ còn cho tương thích code cũ.
6. Các lỗi kỹ thuật và cleanup còn lại.
