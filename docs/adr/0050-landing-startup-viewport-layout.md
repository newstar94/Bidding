# ADR 0050 — Bố trí landing theo vùng nhìn thấy khi khởi động

- Status: Accepted for implementation; release verification recorded separately
- Date: 2026-10-01
- Scope: public landing `/`, not authenticated workspace reconciliation

## Bối cảnh và nguyên nhân

Chủ sản phẩm yêu cầu sửa tác vụ khởi động vượt 100 ms. Phép đo secure bundle
với 30 cold + 30 warm, origin HTTP 127.0.0.1, preload/cache tương đương backend và
collector kiểm tra hợp lệ tái hiện task 231 ms, gồm 221 ms forced style/layout.
Lượt baseline chạy lại đạt tối đa 136 ms, vẫn không đạt 100 ms. Bootstrap
thay icon/nội dung rồi đọc scrollY; đọc này có thể yêu cầu bố trí cả tài liệu.
Chỉ bỏ lần đọc không giải quyết phần native layout: probe vẫn đạt 121 ms.

Thử nghiệm giữ nguyên toàn bộ markup/font nhưng để browser bố trí section
ngoài viewport khi cần cho thấy tối đa 64 ms cold và không có long task
warm trong 30 + 30 lượt. Đây là bằng chứng chọn hướng sửa, không thay bằng
kiểm chứng secure artifact chính thức sau sửa.

## Quyết định

1. Dùng `content-visibility: auto` chỉ cho section dưới hero và footer của
   landing. Dùng `contain-intrinsic-block-size: auto 1000px` làm ước lượng
   trước khi section được bố trí; browser giữ kích thước đã đo sau đó.
2. Giữ hero/header ở đường render bình thường. Nội dung không bị xóa,
   `hidden`, `display:none`, trì hoãn tải dữ liệu hoặc lọc khỏi DOM/API.
   Browser tự render section khi gần viewport, tìm kiếm hoặc focus cần nó.
3. Khi tài liệu có fragment target, bỏ deferred layout để giữ chính xác
   ngữ nghĩa điều hướng. Trước native anchor click, bố trí thật và flush
   layout mà không preventDefault hoặc đổi focus/smooth scroll. Reload phải
   materialize rõ trước `scrollIntoView`: CSS `:target` có thể được browser
   kích hoạt sau bootstrap, làm đổi chiều cao prefix và lệch khoảng 916 px.
   Không dùng timer để sửa thứ tự này.
   Trước lưu history ở `pagehide`, đổi tọa độ ước lượng sang tọa độ canonical
   bằng vị trí viewport của section đang thấy; tính cả native scroll anchoring
   và clamping. Khi Back, materialize rồi áp tọa độ ấy. Regression bắt lệch
   viewport 40,5 px khi numeric scrollbar jump trước bản sửa capture.
4. Benchmark giữ ngưỡng 100 ms và 30 cold + 30 warm; đo cả render/font
   ban đầu, không bỏ observer lỗi hoặc tác vụ vượt qua observation cutoff.
   Chỉ Document fixture được CDP fulfill; CSS/font/JS dùng HTTP cache native
   trên origin thường. Không tắt web security hay đổi cache production.

## Tương thích, migration và rollback

Không đổi font, typography, nội dung, thiết kế, API/schema, dữ liệu được xem,
masking/redaction, role, permission, tenant/module/assignment/record scope,
capability, entitlement hoặc thứ tự đối soát workspace. Contract conflict/F5
ở ADR 0049 giữ nguyên. Không cần migration hay cấu hình mới.

Cần build secure và đóng gói lại để artifact chứa CSS mới. Không tự deploy
hoặc restart host production. Rollback dùng artifact trước sửa; không đổi
dữ liệu nghiệp vụ. Browser không hỗ trợ CSS này tiếp tục bố trí bình thường.

## Kiểm chứng bắt buộc

- Regression trước/sau sửa về section ngoài viewport, DOM/accessibility,
  font/nội dung và geometry/ảnh khi section được nhìn thấy tại 320/768/1280.
- Kiểm tra accessibility bằng renderer ở native accessibility mode, không
  coi lazy CDP AX tree là cây screen-reader đầy đủ. Visual/history/performance
  dùng browser bình thường; không bật accessibility flag để làm performance
  gate xanh.
- Font/style/text-line/element/pseudo/SVG geometry phải giữ nguyên. Viewport
  ban đầu phải pixel-identical; section đã cuộn tới được so từ biên section
  thật, lấy thêm hai hàng pixel ngoài viewport để không cắt vùng lấy mẫu.
  So sánh ảnh không cho sai lệch màu phẳng; chỉ cho raster edge cùng màu
  tối đa một pixel. Các corner raster được đối chiếu ảnh riêng: glyph tối
  đa ba pixel trong bounds dòng chữ đã kiểm chính xác, SVG stroke tối đa
  hai pixel trong bounds vector có path/stroke/geometry giữ nguyên. Đây là
  sai lệch raster/antialiasing, không phải cho phép đổi font hoặc bố cục;
  không tuyên bố pixel-identical sau cuộn. Không dùng ngưỡng sai lệch phần
  trăm toàn ảnh để bỏ qua thay đổi thiết kế; negative controls phải phát
  hiện đổi geometry, màu, font hoặc SVG path/stroke.
- Fragment, reload, history pixel restoration, sticky và bàn phím.
- Harness phát hiện task có kiểm soát >100 ms cold/warm, cache native và
  cleanup observer/listener/CDP đúng vòng đời.
- Secure artifact chính thức đo đầy đủ, chạy riêng, lặp lại sau freeze.
- Static/security/landing/conflict regressions và package smoke cô lập.

Kết quả hiện hành và giới hạn staging/Edge được ghi ở
`docs/production-repair-report.vi.md`; không dùng ADR làm chứng nhận go-live.
