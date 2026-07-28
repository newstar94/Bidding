# Prompt cho Codex: Bổ sung chức năng danh mục hàng hóa cho gói thầu hàng hóa

## Vai trò

Bạn là senior full-stack engineer chịu trách nhiệm phân tích và triển khai chức năng mới trong repository:

```text
https://github.com/newstar94/Bidding
```

Hãy đọc kỹ toàn bộ code liên quan trước khi sửa, đặc biệt là:

- Cấu trúc dữ liệu và migration PostgreSQL.
- Cơ chế versioning của `goi_thau` và `goi_thau_phan_lo`.
- Cơ chế local-first, IndexedDB, mutation queue và `/api/sync`.
- Access policy theo workspace, organization, module, assignment và ownership.
- Quy trình gói thầu hàng hóa, phần lô, phát hành HSMT, mở thầu và đánh giá.
- Cơ chế import/export Excel hiện có.
- Cơ chế tạo phiên bản mới của gói thầu và đấu thầu lại.
- Bộ test hiện có.

Không triển khai theo kiểu thêm CRUD độc lập. Chức năng mới phải tích hợp đầy đủ với kiến trúc hiện tại của ứng dụng.

---

# 1. Mục tiêu nghiệp vụ

Đối với gói thầu có lĩnh vực **Hàng hóa**, bổ sung khả năng quản lý **danh mục hàng hóa yêu cầu** của gói thầu.

Có hai trường hợp:

1. Gói thầu hàng hóa không chia phần lô:
   - Danh mục hàng hóa thuộc trực tiếp gói thầu.

2. Gói thầu hàng hóa có chia phần lô:
   - Mỗi hàng hóa phải thuộc một phần lô cụ thể.
   - Có thể xem, nhập, chỉnh sửa và xuất dữ liệu theo từng phần lô hoặc toàn bộ gói.

Danh mục này là dữ liệu yêu cầu của bên mời thầu, được lưu có cấu trúc để phục vụ:

- Lập và xuất hồ sơ mời thầu.
- Theo dõi danh mục hàng hóa theo phần lô.
- Chấm thầu chi tiết theo từng hàng hóa trong giai đoạn sau.
- So sánh hàng hóa nhà thầu đề xuất với yêu cầu của gói thầu.

Không lưu file Excel như nguồn dữ liệu chính. Sau khi import, dữ liệu phải được chuẩn hóa và lưu thành từng bản ghi trong hệ thống.

---

# 2. Yêu cầu phân tích trước khi code

Trước khi chỉnh sửa, hãy:

1. Lập bản đồ các file, module, bảng và workflow bị ảnh hưởng.
2. Xác định chính xác:
   - Tên trường xác định lĩnh vực gói thầu.
   - Giá trị thực tế đang được dùng cho lĩnh vực `Hàng hóa`.
   - Trường xác định gói có chia phần lô hay không.
   - Cấu trúc thực tế của bảng `goi_thau_phan_lo`.
   - Cách tạo phiên bản mới của `goi_thau`.
   - Cách sao chép dữ liệu con khi tạo phiên bản mới.
   - Danh sách table/entity được phép sync.
   - Cách frontend khai báo state, storage key và IndexedDB store.
   - Cách backend kiểm tra quyền chỉnh sửa gói thầu.
   - Cách import/export Excel hiện tại đang được tổ chức.
3. Không giả định tên trường nếu chưa kiểm tra code.
4. Tái sử dụng convention và helper hiện có thay vì tạo kiến trúc song song.
5. Trước khi code, ghi một implementation plan ngắn trong phần trả lời của Codex.

---

# 3. Mô hình dữ liệu

## 3.1. Tạo entity/bảng mới

Tạo bảng mới theo convention của repository, tên đề xuất:

```text
goi_thau_hang_hoa
```

Tên entity frontend đề xuất:

```text
goithauhanghoa
```

Nếu repository có convention tên khác, hãy điều chỉnh nhất quán nhưng phải giải thích rõ.

## 3.2. Các trường nghiệp vụ

Bảng cần hỗ trợ tối thiểu các trường sau:

```text
id
organization_id
owner_type
goi_thau_id
phan_lo_id
ma_hang_hoa
ten_hang_hoa
nhom_hang_hoa
don_vi_tinh
so_luong
yeu_cau_ky_thuat
ky_ma_hieu_tham_chieu
xuat_xu_yeu_cau
dia_diem_giao_hang
thoi_gian_giao_hang
don_gia_du_toan
thanh_tien_du_toan
ghi_chu
sort_order
row_version
sync_version
created_at
updated_at
```

Áp dụng đúng convention đặt tên của backend và frontend hiện tại. Nếu backend dùng snake_case còn frontend dùng camelCase, phải bổ sung mapping đầy đủ.

## 3.3. Ý nghĩa trường

- `goi_thau_id`: tham chiếu đến đúng phiên bản gói thầu hiện tại, không chỉ tham chiếu `id_goc`.
- `phan_lo_id`:
  - `NULL` khi gói không chia phần lô.
  - Bắt buộc khi gói có chia phần lô.
- `ma_hang_hoa`: mã hạng mục/hàng hóa trong phạm vi gói hoặc phần lô.
- `ten_hang_hoa`: tên hàng hóa.
- `don_vi_tinh`: đơn vị tính.
- `so_luong`: số lượng yêu cầu, phải lớn hơn 0.
- `yeu_cau_ky_thuat`: mô tả hoặc thông số kỹ thuật yêu cầu.
- `don_gia_du_toan`, `thanh_tien_du_toan`: số tiền không âm, sử dụng kiểu dữ liệu tiền tệ phù hợp với convention hiện tại của dự án.
- `sort_order`: phục vụ giữ thứ tự hàng hóa như trong file hoặc UI.
- `row_version`, `sync_version`: tuân theo cơ chế optimistic concurrency và sync hiện tại.

## 3.4. Ràng buộc dữ liệu

Phải có validation ở cả frontend và backend:

1. `goi_thau_id` tồn tại và thuộc đúng workspace/organization hiện tại.
2. Gói thầu phải có lĩnh vực Hàng hóa.
3. Nếu gói không chia phần lô:
   - `phan_lo_id` phải là `NULL`.
4. Nếu gói có chia phần lô:
   - `phan_lo_id` bắt buộc.
   - Phần lô phải tồn tại.
   - Phần lô phải thuộc đúng gói thầu.
   - Phần lô phải thuộc cùng organization/workspace.
5. `ma_hang_hoa`, `ten_hang_hoa`, `don_vi_tinh` không được rỗng.
6. `so_luong > 0`.
7. Đơn giá và thành tiền không được âm.
8. Không cho trùng mã hàng hóa trong cùng phạm vi:

```text
organization_id + goi_thau_id + phan_lo_id + ma_hang_hoa
```

Với gói không phân lô, coi `phan_lo_id = NULL` là cùng một phạm vi.

Tạo unique index PostgreSQL phù hợp. Chuẩn hóa mã trước khi so sánh, tối thiểu bằng trim và so sánh không phân biệt hoa thường nếu phù hợp với convention hiện tại.

## 3.5. Foreign key và hành vi xóa

- Khi xóa hoàn toàn một phiên bản gói thầu, danh mục hàng hóa tương ứng có thể bị cascade theo đúng convention hiện tại.
- Không cho xóa phần lô nếu đang có hàng hóa tham chiếu, trừ khi workflow hiện tại có cơ chế xóa cascade an toàn và được người dùng xác nhận rõ.
- Ưu tiên `ON DELETE RESTRICT` đối với `phan_lo_id` để tránh mất danh mục ngoài ý muốn.

---

# 4. Versioning và lịch sử dữ liệu

Đây là yêu cầu bắt buộc.

Khi tạo phiên bản mới của gói thầu:

1. Sao chép danh mục hàng hóa của phiên bản trước sang phiên bản mới.
2. Mỗi hàng hóa mới phải có `id` mới.
3. `goi_thau_id` phải trỏ đến ID phiên bản gói thầu mới.
4. Nếu phần lô cũng được sao chép sang ID mới:
   - Xây dựng mapping `phan_lo_id_cu -> phan_lo_id_moi`.
   - Hàng hóa ở phiên bản mới phải trỏ đến phần lô mới tương ứng.
5. Không được để phiên bản mới tham chiếu phần lô hoặc hàng hóa của phiên bản cũ.
6. Phiên bản cũ phải giữ nguyên dữ liệu lịch sử.

Khi tạo gói đấu thầu lại:

- Cho phép sao chép danh mục hàng hóa từ gói gốc theo convention hiện tại.
- Tạo ID mới cho tất cả hàng hóa.
- Không dùng chung bản ghi giữa gói cũ và gói mới.

Bổ sung test cho toàn bộ logic trên.

---

# 5. Phân quyền

Danh mục hàng hóa phải kế thừa quyền xem/sửa của gói thầu.

## Quyền xem

Người dùng chỉ được đọc danh mục nếu có quyền xem gói thầu tương ứng.

## Quyền sửa

Người dùng chỉ được thêm, sửa, xóa hoặc import khi:

- Có quyền chỉnh sửa module gói thầu.
- Có quyền truy cập bản ghi gói thầu theo assignment/ownership/access policy hiện tại.
- Gói thầu đang ở trạng thái cho phép chỉnh sửa danh mục.

Không chỉ ẩn nút ở frontend. Backend phải kiểm tra đầy đủ quyền với mọi mutation.

Không tạo access policy riêng làm sai lệch logic hiện có. Tái sử dụng helper kiểm tra quyền gói thầu.

---

# 6. Quy tắc trạng thái gói thầu

Danh mục hàng hóa là một phần của yêu cầu mời thầu, vì vậy phải khóa sửa sau khi phát hành.

Áp dụng theo enum/trạng thái thực tế trong code, với nguyên tắc:

- Trạng thái chuẩn bị: cho phép thêm, sửa, xóa, import.
- Đã phát hành/mời thầu: chỉ đọc.
- Đã mở thầu: chỉ đọc.
- Đang đánh giá: chỉ đọc.
- Đã có kết quả: chỉ đọc.
- Đã hủy: chỉ đọc.

Nếu repository đã có chức năng đính chính HSMT và cơ chế tạo version thay đổi sau phát hành, hãy tích hợp đúng workflow đó. Không được cho sửa trực tiếp dữ liệu lịch sử đã phát hành.

Frontend phải disable thao tác và hiển thị giải thích. Backend vẫn phải từ chối mutation trái phép.

---

# 7. Giao diện người dùng

## 7.1. Vị trí

Thêm một tab hoặc khu vực mới trong trang chi tiết/quy trình gói thầu:

```text
Danh mục hàng hóa
```

Chỉ hiển thị khi lĩnh vực gói thầu là Hàng hóa.

Không nhồi toàn bộ logic vào một file workflow vốn đã lớn. Tách thành module riêng theo convention frontend hiện tại, ví dụ:

```text
frontend/packages/packageGoods/
  PackageGoodsWorkflow.js
  PackageGoodsTable.js
  PackageGoodsExcel.js
  packageGoodsSelectors.js
  packageGoodsValidation.js
```

Có thể điều chỉnh cấu trúc theo convention thực tế của repository.

## 7.2. Gói không chia phần lô

Hiển thị:

- Tổng số mặt hàng.
- Bảng danh mục hàng hóa.
- Nút thêm hàng hóa.
- Nút nhập Excel.
- Nút tải file mẫu.
- Nút xuất Excel.
- Tìm kiếm/lọc cơ bản nếu component hiện tại hỗ trợ.

Các cột tối thiểu:

```text
STT
Mã hàng hóa
Tên hàng hóa
Nhóm hàng hóa
Đơn vị tính
Số lượng
Yêu cầu kỹ thuật
Ký mã hiệu tham chiếu
Xuất xứ yêu cầu
Địa điểm giao hàng
Thời gian giao hàng
Đơn giá dự toán
Thành tiền dự toán
Ghi chú
Thao tác
```

Cho phép thêm/sửa bằng modal, drawer hoặc inline editor theo design system hiện tại.

## 7.3. Gói chia phần lô

Hiển thị:

- Bộ chọn `Tất cả phần lô` hoặc một phần lô cụ thể.
- Tổng số hàng hóa theo phần lô.
- Có thể import một phần lô hoặc import toàn bộ gói.
- Có thể xuất một phần lô hoặc toàn bộ gói.
- Bảng phải hiển thị thêm mã và tên phần lô khi đang xem tất cả.

Khi thêm thủ công:

- Bắt buộc chọn phần lô.
- Chỉ cho chọn phần lô thuộc phiên bản gói thầu hiện tại.

## 7.4. Trải nghiệm sử dụng

- Bảng hỗ trợ danh sách dài, tránh render gây treo UI.
- Có empty state rõ ràng.
- Có loading, saving và error state.
- Sau khi lưu phải cập nhật local state ngay theo kiến trúc hiện tại.
- Khi sync thất bại phải hiển thị trạng thái phù hợp, không báo lưu thành công giả.
- Không làm mất các thay đổi local chưa sync khi đổi tab hoặc reload.

---

# 8. Import Excel

Tái sử dụng hệ thống Excel hiện có. Không tạo parser rời thiếu sandbox hoặc validation an toàn.

## 8.1. File mẫu

Hỗ trợ tải file mẫu cho:

1. Gói không chia phần lô.
2. Một phần lô cụ thể.
3. Toàn bộ gói có chia phần lô.

Cột đề xuất:

```text
Mã phần lô
Tên phần lô
Mã hàng hóa
Tên hàng hóa
Nhóm hàng hóa
Đơn vị tính
Số lượng
Yêu cầu kỹ thuật
Ký mã hiệu tham chiếu
Xuất xứ yêu cầu
Địa điểm giao hàng
Thời gian giao hàng
Đơn giá dự toán
Thành tiền dự toán
Ghi chú
```

Quy tắc:

- Gói không chia lô: không yêu cầu cột mã phần lô.
- Import vào một phần lô đã chọn: có thể bỏ cột mã phần lô hoặc tự gán phần lô đang chọn.
- Import toàn bộ gói chia lô: bắt buộc có mã phần lô.

## 8.2. Mapping tiêu đề

Hỗ trợ alias tiếng Việt phổ biến, ví dụ:

```text
Mã hàng hóa / Mã hạng mục
Tên hàng hóa / Tên hạng mục
ĐVT / Đơn vị tính
Số lượng / Khối lượng
Yêu cầu kỹ thuật / Thông số kỹ thuật / Mô tả kỹ thuật
Mã phần lô / Mã lô
```

Không tự động map mơ hồ nếu có nguy cơ sai cột.

## 8.3. Preview trước khi lưu

Sau khi upload, phải hiển thị bảng preview với:

```text
Số dòng
Phần lô
Mã hàng hóa
Tên hàng hóa
Đơn vị tính
Số lượng
Thao tác dự kiến
Trạng thái
Chi tiết lỗi
```

Phân loại thao tác:

- Thêm mới.
- Cập nhật bản ghi hiện có.
- Không thay đổi.
- Không hợp lệ.

## 8.4. Validation import

Kiểm tra tối thiểu:

- Thiếu mã hàng hóa.
- Thiếu tên hàng hóa.
- Thiếu đơn vị tính.
- Số lượng không phải số hoặc không lớn hơn 0.
- Giá trị tiền âm hoặc không hợp lệ.
- Trùng mã trong cùng file và cùng phạm vi.
- Trùng mã với dữ liệu hiện tại.
- Mã phần lô không tồn tại.
- Phần lô không thuộc gói thầu.
- Gói có chia lô nhưng thiếu mã phần lô khi import toàn bộ.
- Gói không chia lô nhưng file có phần lô.
- Người dùng không có quyền sửa.
- Gói thầu đã bị khóa theo trạng thái.

Preview phải hiển thị tất cả lỗi có thể xác định, không chỉ lỗi đầu tiên.

## 8.5. Chế độ import

Hỗ trợ tối thiểu hai chế độ:

### Gộp dữ liệu

- Mã đã tồn tại trong cùng phạm vi: cập nhật.
- Mã chưa tồn tại: thêm mới.
- Dữ liệu cũ không xuất hiện trong file: giữ nguyên.

Đây là chế độ mặc định.

### Thay thế toàn bộ phạm vi

- Chỉ áp dụng cho phạm vi đang import: toàn bộ gói hoặc một phần lô.
- Bản ghi cũ không xuất hiện trong file sẽ bị xóa.
- Phải có cảnh báo xác nhận rõ ràng.
- Không cho lưu nếu còn bất kỳ dòng không hợp lệ nào.
- Toàn bộ thao tác phải atomic trong một transaction hoặc một sync mutation batch có rollback an toàn.

Không được xóa dữ liệu cũ trước rồi mới phát hiện file lỗi.

## 8.6. Hiệu năng và an toàn

- Tuân theo giới hạn kích thước file hiện có.
- Dùng document worker/sandbox hiện có.
- Không thực thi macro.
- Không tin dữ liệu formula trả về nếu parser hiện tại có biện pháp an toàn riêng.
- Có giới hạn số dòng hợp lý và thông báo rõ khi vượt giới hạn.
- Không thực hiện N+1 query khi resolve phần lô hoặc kiểm tra dữ liệu hiện có.

---

# 9. Export Excel

Cho phép xuất danh mục đã lưu ra Excel:

- Toàn bộ gói không chia lô.
- Một phần lô.
- Toàn bộ gói chia lô.

Yêu cầu:

- Giữ đúng thứ tự `sort_order`.
- Có mã và tên phần lô với file xuất toàn bộ gói chia lô.
- Định dạng số lượng và tiền tệ phù hợp.
- Header dễ đọc.
- Không xuất trường nội bộ như ID, sync version hoặc organization ID.
- Tôn trọng quyền xuất dữ liệu nếu dự án đang áp dụng policy tương ứng.

---

# 10. Tích hợp cơ chế sync

Bổ sung entity mới vào toàn bộ luồng local-first hiện tại.

Cần rà soát và cập nhật tối thiểu:

- Backend schema contract.
- Danh sách bảng/entity đồng bộ.
- Mapper snake_case/camelCase.
- Read service.
- Sync write service.
- Delete handling.
- Sync cursor/version.
- Permission validation.
- Owner/workspace reference validation.
- Frontend state.
- `SYNCED_STATE_KEYS` hoặc cấu trúc tương đương.
- Storage keys.
- IndexedDB object store.
- Mutation queue.
- Serializer/deserializer.
- Merge/reconciliation.
- Workspace switching.
- WebSocket invalidation hoặc realtime update.

Nếu IndexedDB cần tăng version, hãy tạo migration an toàn:

- Không xóa dữ liệu cũ.
- Chỉ thêm object store/index cần thiết.
- Test nâng cấp từ version hiện tại.

Không được chỉ thêm API CRUD riêng ngoài hệ thống sync nếu dữ liệu nghiệp vụ khác đang đi qua `/api/sync`.

---

# 11. Quy tắc khi thay đổi cấu hình gói thầu

## 11.1. Đổi lĩnh vực

Nếu gói đang có danh mục hàng hóa, không cho đổi lĩnh vực từ Hàng hóa sang lĩnh vực khác.

Thông báo phải nêu rõ người dùng cần xóa hoặc xử lý danh mục hàng hóa trước.

Backend phải enforce quy tắc này.

## 11.2. Tắt chia phần lô

Nếu có hàng hóa đang gắn với phần lô:

- Không cho đổi gói từ chia phần lô sang không chia phần lô.
- Không tự động xóa hoặc chuyển dữ liệu ngầm.

Có thể đề xuất workflow chuyển dữ liệu nhưng không bắt buộc trong MVP.

## 11.3. Xóa phần lô

Nếu phần lô đang có hàng hóa:

- Không cho xóa trực tiếp.
- Trả về lỗi nghiệp vụ rõ ràng.
- UI hiển thị số lượng hàng hóa đang tham chiếu nếu có thể.

---

# 12. Chuẩn bị cho chức năng chấm thầu sau này

Trong phạm vi task này chưa cần xây màn hình chấm từng hàng hóa.

Tuy nhiên cấu trúc phải cho phép sau này tạo quan hệ:

```text
nhà thầu tham dự × hàng hóa yêu cầu
```

Danh mục `goi_thau_hang_hoa` chỉ lưu yêu cầu của bên mời thầu.

Không lưu vào bảng này các dữ liệu do nhà thầu đề xuất như:

- Hãng sản xuất.
- Model.
- Xuất xứ thực tế.
- Năm sản xuất.
- Thông số nhà thầu chào.
- Đơn giá dự thầu.
- Kết luận đáp ứng.

Các dữ liệu đó sẽ thuộc bảng đánh giá/đề xuất riêng trong chức năng sau.

Thiết kế ID và foreign key của danh mục hiện tại phải ổn định để có thể tham chiếu từ bảng đánh giá tương lai.

---

# 13. API và transaction

Ưu tiên đi qua sync architecture hiện tại.

Nếu cần endpoint riêng cho import preview hoặc export Excel, endpoint phải:

- Kiểm tra authentication.
- Resolve workspace hiện tại.
- Kiểm tra quyền xem/sửa gói thầu.
- Kiểm tra organization isolation.
- Kiểm tra trạng thái gói thầu.
- Không tin `organization_id` do client gửi.
- Không cho tham chiếu phần lô ngoài gói.
- Dùng transaction cho thao tác import replace.
- Trả lỗi có cấu trúc để frontend hiển thị theo từng dòng.

Không tạo endpoint ghi dữ liệu hàng hóa bỏ qua sync version hoặc row version nếu các entity khác đang dùng optimistic concurrency.

---

# 14. Test bắt buộc

Bổ sung unit test, integration test và frontend test phù hợp với hạ tầng hiện tại.

## 14.1. Database và validation

- Tạo hàng hóa cho gói hàng hóa không chia lô.
- Tạo hàng hóa cho đúng phần lô.
- Từ chối phần lô thuộc gói khác.
- Từ chối phần lô thuộc organization khác.
- Từ chối gói không phải lĩnh vực hàng hóa.
- Từ chối thiếu mã, tên hoặc đơn vị tính.
- Từ chối số lượng bằng 0 hoặc âm.
- Từ chối số tiền âm.
- Từ chối trùng mã trong cùng phạm vi.
- Cho phép cùng mã ở hai phần lô khác nhau.
- Cho phép cùng mã ở hai gói khác nhau.

## 14.2. Access policy

- Manager có quyền phù hợp được sửa.
- Employee có quyền module và assignment được sửa.
- Employee không được phân công bị từ chối.
- Người chỉ có quyền xem không được mutation.
- Người dùng organization khác không đọc hoặc sửa được.

## 14.3. Trạng thái

- Cho phép sửa ở trạng thái chuẩn bị.
- Từ chối sửa sau phát hành.
- Từ chối sửa ở mở thầu, đánh giá, kết quả và hủy.

## 14.4. Versioning

- Tạo phiên bản gói mới sao chép đầy đủ hàng hóa.
- ID hàng hóa mới khác ID cũ.
- `goi_thau_id` trỏ đúng phiên bản mới.
- Mapping phần lô cũ/mới chính xác.
- Sửa danh mục phiên bản mới không ảnh hưởng phiên bản cũ.

## 14.5. Sync

- Create/update/delete qua mutation queue.
- Idempotency khi gửi lại cùng mutation.
- Conflict theo row version.
- Workspace isolation.
- Reconciliation sau reload.
- WebSocket hoặc refresh nhận thay đổi từ client khác.
- IndexedDB upgrade không làm mất dữ liệu cũ.

## 14.6. Import Excel

- Import gói không chia lô.
- Import một phần lô.
- Import toàn bộ gói chia lô.
- Alias header hoạt động.
- Preview thêm mới/cập nhật/không đổi/lỗi.
- Phát hiện trùng mã trong file.
- Phát hiện mã phần lô không tồn tại.
- Merge không xóa dữ liệu ngoài file.
- Replace xóa đúng phạm vi.
- Replace rollback khi có lỗi.
- Không N+1 query khi import nhiều dòng.

## 14.7. UI

- Tab chỉ hiện cho gói hàng hóa.
- Gói chia lô hiển thị bộ lọc phần lô.
- Form validation đúng.
- Trạng thái khóa disable nút và hiển thị lý do.
- Lỗi sync không hiển thị thành công giả.

---

# 15. Yêu cầu về chất lượng code

- Không để lại code chết, comment thừa hoặc import không dùng.
- Không duplicate logic kiểm tra quyền, phần lô hoặc trạng thái.
- Tách helper dùng chung cho validation và selector.
- Không làm `BidProcessWorkflow.js` hoặc file workflow lớn hơn một cách mất kiểm soát.
- Không dùng N+1 query.
- Với import nhiều dòng, preload phần lô và dữ liệu hàng hóa hiện có bằng batch query/map.
- Dùng transaction hợp lý.
- Giữ backward compatibility với dữ liệu hiện tại.
- Không làm mất IndexedDB của người dùng khi nâng version.
- Không thay đổi behavior ngoài phạm vi task nếu không cần thiết.
- Nếu phát hiện kiến trúc hiện tại khiến yêu cầu này không thể triển khai an toàn, hãy nêu rõ và thực hiện refactor tối thiểu cần thiết.

---

# 16. Tài liệu cần cập nhật

Cập nhật tài liệu kỹ thuật phù hợp, tối thiểu gồm:

- Schema/entity mới.
- Quan hệ với gói thầu và phần lô.
- Quy tắc versioning.
- Quy tắc trạng thái.
- Cấu trúc file Excel.
- Cách chạy migration.
- Cách chạy test liên quan.

Nếu repository có changelog hoặc tài liệu module, cập nhật theo convention hiện tại.

---

# 17. Tiêu chí nghiệm thu

Chức năng được coi là hoàn thành khi đáp ứng toàn bộ các điều kiện sau:

1. Gói thầu hàng hóa không chia lô có thể thêm, sửa, xóa, import và xuất danh mục hàng hóa.
2. Gói hàng hóa chia lô có thể quản lý danh mục theo từng phần lô.
3. Không thể gắn hàng hóa vào phần lô của gói khác.
4. Dữ liệu được lưu thành bản ghi có cấu trúc, không chỉ lưu file hoặc JSON blob trong `goi_thau`.
5. Dữ liệu hoạt động đúng qua local state, IndexedDB, mutation queue, sync backend và reload.
6. Phân quyền và workspace isolation được kiểm tra ở backend.
7. Danh mục bị khóa chỉnh sửa sau khi phát hành gói thầu.
8. Khi tạo phiên bản gói thầu mới, hàng hóa và phần lô được sao chép đúng sang ID mới.
9. Import Excel có preview, validation và hai chế độ merge/replace.
10. Replace được xử lý atomic và không gây mất dữ liệu khi file lỗi.
11. Không có N+1 query trong import hoặc tải danh mục.
12. Tất cả test cũ vẫn chạy thành công.
13. Test mới cho database, access policy, sync, versioning, import và UI đều thành công.
14. Code được tổ chức rõ ràng và không dồn thêm logic thiếu kiểm soát vào workflow hiện tại.

---

# 18. Cách thực hiện và báo cáo kết quả

Hãy làm theo thứ tự:

1. Phân tích code hiện tại và ghi implementation plan.
2. Thiết kế migration/schema.
3. Triển khai backend validation, access policy và sync.
4. Triển khai frontend state, IndexedDB và UI.
5. Triển khai import/export Excel.
6. Triển khai versioning/copy logic.
7. Viết test.
8. Chạy toàn bộ test liên quan và lint/typecheck/build nếu dự án có.
9. Review lại diff để loại bỏ code chết và lỗi ngoài ý muốn.

Trong báo cáo cuối cùng, trình bày:

- Các file đã sửa và lý do.
- Schema/migration đã thêm.
- Luồng UI mới.
- Cách import/export hoạt động.
- Cách xử lý versioning và phần lô.
- Cách phân quyền được enforce.
- Test đã chạy và kết quả.
- Những điểm chưa hoàn thành hoặc rủi ro còn lại.

Không tuyên bố hoàn thành nếu chưa chạy được test. Nếu môi trường không cho chạy một số test, phải ghi rõ test nào chưa chạy và lý do.
