# Phương án UX quản lý gói dịch vụ — Super Admin

Ngày: 05/09/2026. Trạng thái: phương án chờ duyệt; chưa sửa code hoặc xuất bản cấu hình.

## 1. Mục tiêu

Người quản trị mở màn hình phải trả lời được ngay:

1. Khách đang nhìn thấy những gói nào?
2. Muốn hiện/ẩn một gói thì thao tác ở đâu?
3. Thay đổi đã áp dụng hay mới nằm trong bản nháp?
4. Nếu chưa áp dụng được, cần xử lý gì tiếp theo?

Thiết kế lại cách tổ chức và diễn đạt, không thay semantics thương mại. Đây là màn hình vận hành, không phải landing marketing: không hero lớn, không card trang trí, không trộn quản lý gói với thao tác tiền bạc trên cùng vùng làm việc.

Liên quan: [Phương án landing](2026-09-05-landing-professional-redesign.md). Hai phần phải dùng chung quy tắc trình bày offer, nhưng không dùng chung toàn bộ giao diện hoặc load toàn bộ admin vào landing.

## 2. Cách dùng màn hình hiện tại

### Hiện một gói ra landing

1. Chọn bản nháp muốn sửa. Nếu muốn sửa đúng cấu hình đang chạy, dùng **Tạo bản nháp từ bản đang hiệu lực** ở phần Lịch sử; nếu chưa có release, dùng **Tạo bản nháp**.
2. Trong **Offer & bảng giá**, tìm đúng gói và biến thể Nội bộ/Kết nối.
3. Đặt **Trạng thái bán → Đang bán**.
4. Trong khối **Hiển thị công khai**, đặt **Hiển thị → Công khai**.
5. Rà tên, giá, nhãn, mô tả, lợi ích và thứ tự.
6. Trở lại **Phát hành & điều kiện sẵn sàng**: bấm **Lưu r… → Kiểm tra**.
7. Xử lý mọi lỗi hoặc quyết định chưa chốt. Chỉ bấm **Xuất bản** khi kiểm tra đạt; nhập lý do và xác thực lại nếu được yêu cầu.
8. Nếu để trống **Hiệu lực từ**, frontend gửi thời điểm hiện tại; nếu chọn tương lai, landing chưa đổi cho tới thời điểm đó.
9. Mở lại landing, xác minh catalog public của release hiệu lực. Không coi thông báo lưu nháp là bằng chứng đã hiển thị.

### Ẩn một gói mà không dừng bán

Đổi **Hiển thị → Ẩn khỏi catalog**, giữ nguyên **Đang bán** nếu chỉ muốn ẩn khỏi danh sách, rồi **Lưu → Kiểm tra → Xuất bản**.

### Dừng bán một gói

Đổi **Trạng thái bán → Đã dừng bán**, rồi thực hiện chuỗi phát hành như trên. Không dùng nút **Dừng bán** tại phần Lịch sử để ẩn một gói: handler của nút đó tác động release hiện hành với scope global, không phải riêng dòng đang xem.

### Phạm vi quan trọng

`display.visibility` là hiển thị trong **catalog công khai dùng chung**, không phải cờ chỉ dành riêng cho landing. Ẩn không đồng nghĩa cấm mua: đường kiểm tra giao dịch hiện xét `salesState` và `ownerKind`, không dùng visibility làm rào chặn giao dịch. Vì vậy không gọi công tắc này là “Bật/tắt gói” hoặc hứa “ẩn là không mua được”.

Nếu muốn gói ẩn riêng trên landing nhưng vẫn xuất hiện trong cửa hàng ứng dụng, đó là yêu cầu nghiệp vụ mới cần chốt trước; không tự thêm field/channel hoặc đổi filter hiện tại.

## 3. Điều kiện hiển thị thực tế trong code

| Điều kiện | Ý nghĩa |
|---|---|
| Commercial runtime enabled và mode khác off | API public được phép cung cấp catalog |
| Không bật trial full access | Trial toàn hệ thống hiện ép commercial off |
| Có release hiệu lực được resolver chọn | Bản nháp/lịch tương lai không phải bản đang hiển thị |
| `salesState = sellable` | Offer được phép đưa vào danh sách bán |
| `display.visibility != hidden` | Offer không bị ẩn khỏi catalog public |

API public có thể đọc release shadow theo semantics hiện tại; **có mặt trong catalog không chứng minh checkout/activation đã sẵn sàng**. UI cần tách hai trạng thái này.

Thứ tự public dựa vào `display.order`; nếu thiếu/không hợp lệ thì dùng thứ tự nguồn. Recommendation chỉ từ cấu hình, không tự đánh dấu gói giá cao nhất.

API công bố cache tối đa 60 giây và rút ngắn theo release sắp hiệu lực. Middleware/proxy và frontend cũng ảnh hưởng freshness: không cam kết “toggle là khách thấy ngay”. Bước xác minh sau xuất bản phải đọc release/API thực tế, không yêu cầu người dùng xóa toàn bộ cache theo thói quen.

Nguồn đã đọc:

- `frontend/commercial-policy/CommercialControlCenter.js`: renderOffers, bindDraftInputs, bindEvents.
- `backend/commercial_policy/service.py`: resolve_offer, evaluate_commercial_command, validate_draft, publish_draft.
- `backend/commercial_policy/config.py`: CommercialRuntimeConfig.from_environment.
- `backend/commercial_policy/routes.py`: public_commercial_offers_api và các route draft/publish.
- `frontend/commercial-policy/PublicCommercialCatalog.js`: visibleOffersForOwner, presentCommercialOffer.

Chưa kiểm tra trạng thái runtime/release của phiên đang mở trong screenshot; các điều kiện trên là contract đọc từ code, không khẳng định môi trường người dùng đang bật hay tắt.

## 4. Vì sao hiện tại khó dùng

- Mỗi offer là một dòng bảng cộng một form metadata lớn luôn mở. Với 8 offer, người dùng phải cuộn qua hàng chục trường trước khi hiểu mục tiêu chính.
- Giá/quota, thông tin kỹ thuật, nội dung marketing và trạng thái bán đều cùng mức ưu tiên.
- Nút xuất bản nằm xa vùng đang chỉnh, tạo cảm giác sửa một trường là xong.
- Chưa có trạng thái hàng “đang hiển thị thật” so với “sẽ hiển thị sau xuất bản”.
- `offer`, `SKU`, `r…`, `validation`, `catalog`, `PRODUCT_GATE` lộ ra như ngôn ngữ thao tác chính.
- `views/tabs/tab_commercial_admin.html:35` hard-code “8 offer năm · 4 SKU lượt”; con số phải sinh từ dữ liệu đang xem.
- `bindDraftInputs` gọi `renderAll` sau mỗi change. Cần kiểm thử focus/caret, vị trí cuộn và field thời gian khi đổi input, không chỉ layout tĩnh.
- Nút Kiểm tra gửi revision của bản lưu trên server, không gửi document đang sửa trong bộ nhớ. UX mới phải chặn/giải thích khi còn thay đổi chưa lưu, hoặc orchestration lưu thành công rồi mới kiểm tra. Không được báo đã kiểm tra bản trên màn hình nếu thực tế kiểm tra revision cũ.

Hai điểm lifecycle cuối là rủi ro nhận diện qua code; cần reproduce và test integration trước khi sửa, chưa khẳng định tất cả xảy ra trong phiên của người dùng.

## 5. Bố cục đề xuất: danh sách gọn + chỉnh từng gói + xem trước

Màn hình mặc định ưu tiên **Gói dịch vụ**, với thanh trạng thái đang áp dụng luôn rõ ràng.

```text
Thương mại & Thanh toán
[Gói dịch vụ] [Lượt mua thêm] [Chính sách] [Thanh toán] [Lịch sử]

Đang áp dụng: phiên bản …       Hiệu lực: …       [Mở landing]
Catalog: …                     Checkout: …

Đang sửa bản nháp … • Chưa ảnh hưởng khách hàng
[Tìm gói…] [Đối tượng ▾] [Biến thể ▾] [Hiển thị ▾]

Gói / biến thể       Giá / kỳ    Bán hàng     Catalog public       Thao tác
Cá nhân · Nội bộ      …          Đang bán     Công khai            [Chỉnh sửa]
Cá nhân · Kết nối     …          Đang bán     Ẩn                   [Chỉnh sửa]
… danh sách sinh từ configuration, không cố định số dòng …

Thay đổi chưa xuất bản: …  [Lưu bản nháp] [Kiểm tra & xem trước] [Xuất bản…]
```

Wireframe không trình bày số gói/giá giả như dữ liệu thật. Tab là nhóm nội dung trong route hiện tại; không tạo route tree mới mặc định.

### Danh sách gói

- Dòng gọn khoảng 64–80px trên desktop; cột ưu tiên tên/biến thể, giá/kỳ, trạng thái bán, catalog, nút sửa.
- Mã kỹ thuật chuyển vào chi tiết có thể mở/xem/copy, không xóa dữ liệu hay đổi định danh.
- Có chế độ **Đang áp dụng / Bản nháp** rõ ràng; trạng thái draft hiển thị “Dự kiến công khai” thay cho “Khách đang thấy”.
- Công tắc **Công khai trong danh mục** có nhãn và helper: “Áp dụng cho landing và nơi dùng catalog công khai. Chỉ có hiệu lực sau xuất bản.”
- Nếu gói đã dừng bán, vẫn bảo toàn lựa chọn visibility; hiển thị lý do “Chưa xuất hiện vì đã dừng bán”. Không tự bật lại salesState khi bật visibility.
- Giữ nguyên ba giá trị salesState; không gộp stopped/non_sellable thành boolean khi chưa có quyết định sản phẩm.
- Thứ tự chỉ có một thao tác chính; ưu tiên nút lên/xuống dùng được bằng bàn phím, số thứ tự là chi tiết. Khi filter đang bật, không âm thầm đảo toàn catalog; dùng chế độ sắp xếp toàn danh sách rõ ràng.

### Panel chỉnh sửa một gói

Desktop: drawer hoặc panel đủ rộng, không form tràn toàn bảng. Mobile: dialog toàn màn hình, native scroll, footer hành động không che field.

Nhóm trường:

1. **Giá & quyền lợi:** giá/kỳ, số thành viên, lượt lấy hồ sơ Mua Sắm Công kèm theo, trạng thái bán. Không gọi quota này là “lượt tra cứu” chung vì tra cứu đối tác là chức năng khác.
2. **Nội dung công khai:** tên, mô tả, lợi ích, nhãn phương án, nhãn chu kỳ, badge và recommendation.
3. **Hiển thị:** công khai/ẩn và thứ tự; đi kèm tác động dự kiến.
4. **Thông tin kỹ thuật:** code, ownerKind, variant và giá trị contract chỉ đọc khi hiện tại không cho sửa.

Không tự sửa thuế, currency, period hoặc entitlement khi chỉ chỉnh microcopy. Những logic hiện có ngoài phạm vi phải được giữ và kiểm thử.

### Preview cạnh form

- Hiện đúng card tương ứng với landing đã được duyệt, dùng cùng presenter `presentCommercialOffer` và quy tắc lọc/sắp xếp.
- Không mount cả landing app hoặc lôi workspace module vào public bundle.
- Có nhãn **Xem trước bản nháp — chưa công khai**. Card preview được cập nhật local nhưng không tạo quote/order thật.
- Preview có sẵn 2 chế độ desktop/mobile; không cần giả thanh browser.
- Luôn giải thích lý do không xuất hiện: gói bị ẩn, dừng bán, runtime off, trial, chưa có release hoặc chưa tới giờ hiệu lực.
- Trạng thái backend chưa biết phải ghi “Chưa xác minh”, không suy ra “đang hiển thị” chỉ từ toggle.

## 6. Luồng chỉnh sửa và xuất bản

```text
Đang áp dụng (chỉ đọc)
  → Chỉnh cấu hình (chọn/tạo bản nháp)
  → Chỉnh gói, xem trước
  → Lưu bản nháp (revision mới)
  → Kiểm tra đúng revision
  → Xem thay đổi + chọn hiệu lực
  → Xác nhận xuất bản + lý do + xác thực lại
  → Đã áp dụng / Đã lên lịch / Chưa xác minh public
```

Thanh hành động theo state:

| State | Feedback | Hành động |
|---|---|---|
| Chưa có bản nháp | “Tạo bản nháp để chỉnh; khách chưa bị ảnh hưởng” | Tạo từ bản đang áp dụng |
| Đã chỉnh local | “Chưa lưu” và số thay đổi thực | Lưu; chưa cho publish |
| Đã lưu | “Đã lưu bản nháp, chưa xuất bản” | Kiểm tra |
| Kiểm tra lỗi | Tóm tắt lỗi và link đúng field/tab | Sửa lỗi |
| Kiểm tra đạt | “Bản nháp sẵn sàng xuất bản” | Xem tác động và xuất bản |
| Validation hết hạn/obsolete | “Cần kiểm tra lại” | Kiểm tra lại, không bỏ gate |
| Xung đột revision 409 | Thông báo có bản mới; giữ thay đổi local để đối chiếu | Tải bản mới/so sánh; không force overwrite |
| Đã lên lịch | Giờ hiệu lực rõ theo múi giờ, không ghi đã áp dụng | Xem lịch sử |

Trang xác nhận xuất bản liệt kê các thay đổi thực: gói chuyển public→hidden, giá cũ→mới, quota, recommendation, thứ tự, chính sách. Không chỉ xác nhận bằng một prompt chung.

Không bật tự động thanh toán hoặc tắt trial để làm preview trông đúng. Các điều kiện triển khai và quyết định sản phẩm chưa chốt hiển thị read-only, giải thích ai cần xử lý, giữ nguyên gate.

## 7. Chuẩn visual và accessibility

- Theo `design.md`: Plus Jakarta Sans local, surface/canvas/ink/line và action token hiện có; giữ accent Super Admin đúng ngữ cảnh shell.
- Không mở hết drawer/form cùng lúc; chỉ giảm mật độ trình bày, mọi trường và quyền hiện hữu vẫn truy cập được.
- Giá căn phải, số tabular; trạng thái có text, không chỉ màu hoặc icon.
- Icon Lucide local thống nhất, 20–24px cho control; không icon trang trí cho mỗi label.
- Focus rõ; panel có heading, label, Escape và trả focus về đúng hàng; xử lý nháp chưa lưu theo cơ chế modal hiện có.
- Toggle accessible bằng keyboard và tên đầy đủ của gói; text “Bản nháp” luôn đi cùng để tránh hiểu áp dụng tức thì.
- Row/card responsive vẫn phân biệt biến thể, salesState và visibility. Chưa có dữ liệu thì empty state có bước tiếp theo.

## 8. Phạm vi file sau khi duyệt

| File/nhóm | Dự kiến |
|---|---|
| `views/tabs/tab_commercial_admin.html` | Tab nội bộ, trạng thái, điểm bắt đầu; bỏ con số hard-code |
| `frontend/commercial-policy/CommercialControlCenter.js` | State local/server rõ; danh sách, panel, dirty guard và publish review |
| `frontend/commercial-policy/CommercialControlCenter.css` | Layout gọn, drawer, responsive và action bar trong shell |
| `frontend/commercial-policy/PublicCommercialCatalog.js` | Tái sử dụng presenter; chỉ mở rộng presentation nếu cần |
| `frontend/landing/LandingPage.js` và renderer presentation mới nếu cần | Shared preview/card seam, không thay auth/checkout contract |
| `tests/js/commercial_control_center.test.mjs` | Dirty/publish/revision/focus/filter/order/preview state |
| `tests/js/public_commercial_catalog.test.mjs`, `tests/test_commercial_public_catalog.py` | Đồng nhất filter và metadata public |
| E2E hiện có hoặc spec thương mại bổ sung | Chỉnh → lưu → validate → publish → public API → landing |

Không đổi schema/API/backend policy chỉ để làm UI dễ dùng. Nếu cần API mới cho preview hoặc trạng thái từng offer, phải trình bày khoảng thiếu và chốt phạm vi trước.

## 9. Nghiệm thu

- Người dùng mới tìm được thao tác hiện/ẩn gói mà không phải đọc bảng policy hoặc hiểu SKU.
- Không mở form toàn bộ offer; danh sách và next action thấy được ngay ở desktop tiêu chuẩn.
- Sau khi bật visibility local, landing thật chưa thay đổi; UI nói rõ điều đó.
- Publish luôn dựa trên revision đã lưu, digest còn hạn, reason, step-up auth và audit hiện hành.
- Test đủ public+sellable, hidden+sellable, public+stopped, hidden+stopped, non_sellable; không phát minh semantics mới.
- Test 0/1/2/3/4+ offers và số liệu tổng hợp lấy từ dữ liệu, không cố định 8/4.
- Runtime off/trial/shadow/enforce, publish tương lai, validation error, 409, network error đều có giải thích.
- Lịch sử và giao dịch đã ghim release không bị chỉnh hồi tố; giữ authorization và toàn bộ dữ liệu được phép đọc.
- Preview và landing cùng release có tên, giá, quota, recommendation, visibility và thứ tự tương ứng.
- Kiểm thử desktop/mobile, zoom 200%, keyboard, không focus/scroll jump sau đổi field; không mất effectiveAt do render lại.
- Screenshot trước–sau, build/test thực tế và báo cáo giới hạn; không gọi prototype là production-ready.

## 10. Thứ tự triển khai đề xuất

1. Sửa icon landing theo phương án liên quan.
2. Duyệt danh sách gói + panel của một offer + preview desktop/mobile.
3. Implement dirty-state và chuỗi lưu/kiểm tra/xuất bản theo backend hiện hành.
4. Tách chính sách/thanh toán/lịch sử sang nhóm riêng, giữ toàn bộ chức năng.
5. E2E nối admin đến catalog và landing; test trên dữ liệu cô lập, không xuất bản bảng giá thật để thử UI.

Chỉ tạo phương án trong vòng này. Chưa đổi giá, gói, cấu hình hiển thị, policy hoặc trạng thái thương mại. Gợi ý skill về progressive disclosure được áp dụng; gợi ý marketing như badge chứng nhận/animation không phù hợp admin nên không sử dụng.
