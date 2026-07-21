# Kế hoạch kết hợp Tailwind CSS với hệ thống giao diện hiện tại

## 1. Trạng thái

- **Trạng thái:** Kế hoạch, chưa cài đặt Tailwind và chưa thay đổi mã Tailwind.
- **Ngày lập:** 20/07/2026.
- **Phạm vi:** Frontend BiddingFlow trong thư mục `D:\\Bidding`.
- **Phương án đã chọn:** Hybrid/incremental migration.

## 2. Mục tiêu

Đưa Tailwind CSS vào dự án để xây dựng giao diện mới nhanh và nhất quán hơn, nhưng không làm gián đoạn các màn nghiệp vụ đang hoạt động.

Mục tiêu cụ thể:

1. Chuẩn hóa màu sắc, typography, khoảng cách, border radius và trạng thái tương tác bằng design token dùng chung.
2. Dùng Tailwind cho các component mới và các component được chuyển đổi có kiểm soát.
3. Giữ nguyên các CSS nghiệp vụ ổn định cho đến khi có component thay thế và đã kiểm thử giao diện.
4. Không làm thay đổi quyền, bộ lọc dữ liệu, luồng kế hoạch/gói thầu/hợp đồng/phân công hoặc chính sách khóa xóa của chuyên viên.
5. Đảm bảo build secure, Trusted Types, kiểm tra vendor và đóng gói production tiếp tục đạt.

## 3. Hiện trạng kỹ thuật

- Ứng dụng dùng **Vite 8** và JavaScript/HTML thuần, không dùng React, Vue hoặc TSX.
- HTML được ghép từ `views/components`, `views/tabs` và các template JavaScript.
- CSS hiện tại gồm `variables.css`, `base.css`, `components.css`, `views.css`, các CSS sinh tự động/runtime và `ui-redesign.css`.
- Nhiều màn hình đang dùng class nghiệp vụ `bf-s-*`, class Bootstrap-like và style runtime qua `setRuntimeStyle`.
- `views/index.html` đang nạp CSS tĩnh trực tiếp; Vite entry hiện là `frontend/app/app.js`.
- Pipeline production hiện chạy `lint:security`, audit vendor và `vite build --mode secure`.

## 4. Quyết định kiến trúc

### 4.1 Không viết lại toàn bộ CSS

Không thay toàn bộ CSS hiện tại bằng Tailwind trong một lần. Việc này có nguy cơ làm thay đổi mặc định của bảng, form, modal, lớp generated styles và các màn hình nghiệp vụ.

### 4.2 Dùng Tailwind theo từng lớp

| Lớp | Công cụ chính | Cách xử lý |
|---|---|---|
| Design token | `variables.css` + Tailwind theme | Giữ tên token hiện có, ánh xạ dần sang `@theme` |
| Layout/UI mới | Tailwind utilities | Dùng cho component mới hoặc component pilot |
| Component nghiệp vụ ổn định | CSS hiện tại | Chưa chuyển nếu chưa có kiểm thử tương đương |
| Style động an toàn | `setRuntimeStyle` | Giữ nguyên; không chuyển tùy tiện sang class động |
| CSS legacy | Các file hiện hữu | Loại bỏ từng phần sau khi migration và regression test |

### 4.3 Không đưa shadcn/ui vào giai đoạn này

shadcn/ui phù hợp với React/TypeScript và Radix primitives. Ứng dụng hiện tại là vanilla JavaScript nên chỉ tích hợp Tailwind CSS, không thực hiện migration framework.

## 5. Thiết kế token mục tiêu

Giữ các semantic token đang có và bổ sung chúng vào Tailwind theme khi pilot ổn định:

| Nhóm | Token hiện có/định hướng |
|---|---|
| Thương hiệu | `--brand`, `--brand-strong`, `--brand-soft` |
| Vai trò Super Admin | `--role-super-admin`, `--role-super-admin-strong`, `--role-super-admin-soft` |
| Vai trò Quản lý | `--role-manager`, `--role-manager-strong`, `--role-manager-soft` |
| Vai trò Chuyên viên | `--role-employee`, `--role-employee-strong`, `--role-employee-soft` |
| Nội dung | `--ink`, `--ink-muted`, `--ink-subtle` |
| Bề mặt/đường viền | `--canvas`, `--surface`, `--line`, `--line-strong` |
| Trạng thái | success, warning, danger, info theo token hiện hành |
| Hình học | radius và shadow đang dùng trong hệ thống hiện tại |

Nguyên tắc: component dùng semantic token, không rải mã màu trực tiếp trong HTML nếu token tương ứng đã tồn tại.

## 6. Lộ trình triển khai

### Giai đoạn 0 — Baseline và chuẩn bị

- [ ] Chụp/ghi nhận baseline desktop và mobile cho các vai trò Super Admin, Quản lý, Chuyên viên.
- [ ] Chạy `npm run lint:security` và `npm run build` trước khi cài Tailwind.
- [ ] Lập danh sách component pilot, ưu tiên component ít phụ thuộc nghiệp vụ.
- [ ] Xác định CSS precedence giữa Tailwind utilities, `ui-redesign.css`, `components.css` và runtime styles.
- [ ] Quy ước rằng Tailwind không được sửa logic phân quyền hoặc API.

**Đầu ra:** baseline hình ảnh, danh sách component và tiêu chí so sánh trước/sau.

### Giai đoạn 1 — Tích hợp Tailwind tối thiểu

- [ ] Cài `tailwindcss` và `@tailwindcss/vite` dưới `devDependencies`.
- [ ] Thêm plugin Tailwind vào `vite.config.js` mà không làm mất plugin obfuscation secure.
- [ ] Tạo CSS entry riêng, ví dụ `frontend/styles/tailwind.css`.
- [ ] Kết nối CSS entry với Vite và pipeline đóng gói hiện tại; xác nhận CSS sinh ra được phục vụ trong dev và production.
- [ ] Ở giai đoạn đầu không bật reset/preflight toàn cục nếu có thể; nếu cần dùng, phải kiểm thử riêng bảng, form, button và heading.
- [ ] Giữ các stylesheet legacy trong `views/index.html` cho đến khi từng nhóm component được chuyển đổi.

**Tiêu chí đạt:** ứng dụng chạy và build được, không có thay đổi hình ảnh ngoài vùng pilot, CSS Tailwind không gây FOUC hoặc lỗi Trusted Types.

### Giai đoạn 2 — Ánh xạ theme và tạo lớp component dùng chung

- [ ] Ánh xạ token vai trò, brand, surface, text và trạng thái vào Tailwind theme.
- [ ] Tạo quy ước cho button, badge, card, input, focus ring, table wrapper và empty state.
- [ ] Chỉ tạo `@utility`/component CSS cho pattern lặp lại thật sự; không biến mọi class dài thành abstraction mới.
- [ ] Giữ focus-visible và kích thước vùng bấm tối thiểu 44px.
- [ ] Đảm bảo màu active của Super Admin, Quản lý và Chuyên viên vẫn khác nhau nhưng cùng một cấu trúc component.

**Tiêu chí đạt:** token mới có thể dùng mà không cần hard-code màu; contrast và keyboard focus đạt baseline hiện tại.

### Giai đoạn 3 — Pilot giao diện ít rủi ro

Ưu tiên chuyển đổi theo thứ tự:

1. Empty state và status badge.
2. Button nhóm thao tác và toolbar tìm kiếm/lọc.
3. Card dashboard và các khối thống kê không chứa logic ghi dữ liệu.
4. Header/sidebar layout sau khi đã xác nhận không lặp thông tin vai trò.

Với mỗi component:

- [ ] Tạo biến thể Tailwind với class tĩnh đầy đủ.
- [ ] Đối chiếu desktop/mobile ở các breakpoint hiện hành.
- [ ] Kiểm tra hover, active, focus-visible, disabled và reduced motion.
- [ ] Kiểm tra cả ba vai trò và trạng thái chuyên viên bị khóa xóa.
- [ ] Xóa CSS cũ chỉ sau khi không còn selector sử dụng và test đã cập nhật.

### Giai đoạn 4 — Chuyển đổi theo nhóm nghiệp vụ

Chuyển đổi từng nhóm, không trộn nhiều workflow trong một thay đổi lớn:

1. Dashboard và timeline.
2. Kế hoạch LCNT.
3. Gói thầu, phần lô và các biến thể 1G1T/2G2T/1G2T.
4. Nhà thầu độc lập, liên danh, tư vấn/không tư vấn.
5. Kết quả lựa chọn nhà thầu.
6. Hợp đồng.
7. Chủ đầu tư, chuyên gia, nhân sự và phân công.
8. Modal, form và các màn Excel/Word.

Mỗi nhóm phải có regression test nghiệp vụ trước khi xóa CSS legacy tương ứng.

### Giai đoạn 5 — Dọn dẹp và chuẩn hóa production

- [ ] Xóa các selector CSS không còn tham chiếu.
- [ ] Kiểm tra class generated `bf-s-*` và runtime styles không bị Tailwind thay đổi ngoài ý muốn.
- [ ] Xác nhận CSS output có kích thước hợp lý, không phát sinh toàn bộ utility không dùng.
- [ ] Cập nhật manifest/package production nếu CSS entry chuyển từ static sang Vite asset.
- [ ] Chạy toàn bộ test, security lint, audit vendor và secure build.
- [ ] Chụp lại baseline và ghi nhận sai khác UI đã được chấp thuận.

## 7. Quy tắc class động bắt buộc

Tailwind quét source dưới dạng văn bản. Không ghép tên utility bằng interpolation hoặc concatenation:

```js
// Không dùng
`bg-${role}-600`

// Dùng map chứa class hoàn chỉnh
const roleClasses = {
  manager: "bg-blue-600 text-white",
  employee: "bg-teal-700 text-white",
  super_admin: "bg-violet-700 text-white"
};
```

Quy tắc áp dụng cho toàn bộ template HTML/JavaScript:

- [ ] Tên utility phải xuất hiện đầy đủ trong source hoặc được đăng ký bằng `@source`/nguồn tĩnh phù hợp.
- [ ] Không tạo class từ dữ liệu người dùng hoặc giá trị API.
- [ ] Các biến thể role, tone, trạng thái phải dùng lookup map tĩnh.
- [ ] Class `bf-s-*` và style runtime không được xem là nguồn để Tailwind tự suy luận.
- [ ] Nếu có template nằm ngoài vùng quét mặc định, khai báo `@source` và kiểm tra CSS output.

## 8. Phạm vi không thay đổi

- Không thay đổi schema database, API, auth, RBAC hoặc policy backend.
- Không thay đổi logic chỉ hiển thị kế hoạch khi chuyên viên được phân công gói thầu thuộc kế hoạch.
- Không thay đổi nghiệp vụ phần lô, không phần lô, 1G1T, 2G2T, 1G2T, tư vấn/không tư vấn, độc lập/liên danh.
- Không mở lại quyền xóa của chuyên viên.
- Không thay đổi cơ chế Trusted Types, sanitization hoặc secure obfuscation.

## 9. Kiểm thử và tiêu chí nghiệm thu

### Kiểm thử tự động

- [ ] `npm run lint:security` đạt.
- [ ] `npm run audit:vendor` đạt.
- [ ] `npm run build` và `npm run build:secure` đạt.
- [ ] Test role-based UI đạt.
- [ ] Không có lỗi console mới trong các màn pilot.

### Kiểm thử trình duyệt

- [ ] Super Admin: dashboard quản trị, menu, profile và trạng thái active.
- [ ] Quản lý: điều hành đơn vị, phân công, chỉnh sửa và xóa theo quyền.
- [ ] Chuyên viên: chỉ thấy dữ liệu được phân công; thêm/sửa hoạt động; xóa bị khóa.
- [ ] Responsive tối thiểu tại 375px, 768px, 1024px và desktop.
- [ ] Hover trên mục active không làm mất tương phản chữ/icon.
- [ ] Keyboard navigation, focus-visible, screen reader label và reduced motion.

### Kiểm thử hồi quy nghiệp vụ

- [ ] Thêm, sửa, xóa và refresh danh sách cho từng nhóm nghiệp vụ.
- [ ] Xác nhận toast vẫn giữ đúng tên đối tượng và không bị ảnh hưởng bởi CSS mới.
- [ ] Xác nhận các modal/form không bị Preflight làm thay đổi layout hoặc validation.
- [ ] Xác nhận build production phục vụ đủ CSS, không có FOUC.

## 10. Rủi ro và phương án giảm thiểu

| Rủi ro | Mức độ | Giảm thiểu |
|---|---:|---|
| Preflight đổi mặc định form/table | Cao | Tắt hoặc giới hạn trong pilot; test riêng trước khi bật rộng |
| CSS specificity xung đột | Cao | Quy định thứ tự layer, chuyển từng component, không dùng `!important` tùy tiện |
| Class động không được sinh CSS | Cao | Dùng lookup map class đầy đủ và kiểm tra CSS output |
| FOUC do CSS từ Vite và CSS tĩnh | Trung bình | Chốt một đường nạp CSS rõ ràng trong pilot và kiểm tra production package |
| Bundle/CSS tăng kích thước | Trung bình | Giới hạn source scan, không import component library dư thừa, theo dõi gzip |
| Xóa nhầm CSS đang được runtime dùng | Cao | `rg` selector, test screenshot và chỉ xóa sau khi có bằng chứng không còn dùng |
| Giao diện role bị đồng nhất sai | Trung bình | Kiểm tra cả 3 role ở mỗi component dùng token role |

## 11. Kế hoạch rollback

Mỗi giai đoạn phải được commit độc lập. Nếu pilot gây regression:

1. Gỡ CSS entry/plugin Tailwind của commit đó.
2. Khôi phục stylesheet legacy và markup trước pilot.
3. Giữ lại test để tái hiện lỗi.
4. Không rollback các sửa lỗi nghiệp vụ hoặc quyền đã hoàn tất trước đó.

## 12. Định nghĩa hoàn tất

Kế hoạch chỉ được đánh dấu hoàn tất khi:

- Các nhóm component đã chuyển đổi có danh sách rõ ràng và không còn CSS legacy tương ứng không sử dụng.
- Build secure và package production đạt.
- Tất cả vai trò và nghiệp vụ nêu trong phần kiểm thử không bị thay đổi hành vi.
- Không còn class Tailwind động không thể quét được.
- Có ảnh baseline trước/sau và tài liệu rollback cho các thay đổi lớn.

## 13. Tài liệu tham khảo

- [Tailwind CSS với Vite](https://tailwindcss.com/docs/installation/using-vite)
- [Phát hiện class trong source](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Preflight](https://tailwindcss.com/docs/preflight)
- [Theme variables](https://tailwindcss.com/docs/theme)
