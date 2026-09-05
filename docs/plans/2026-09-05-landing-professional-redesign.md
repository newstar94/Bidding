<!-- Hallmark · proposal critique: P4 H4 E3 S5 R5 V4. Scores review the proposal, not a shipped design. -->
# Phương án landing BiddingFlow chuyên nghiệp và đồng bộ

Ngày: 05/09/2026. Trạng thái: phương án chờ duyệt, chưa triển khai giao diện.

## 1. Quyết định đề xuất

Giữ nhận diện và những điểm tốt của landing cũ: xanh cobalt/navy, bố cục giới thiệu sản phẩm rõ ràng, nội dung tiếng Việt và hình nghiệp vụ. Không quay lại nguyên trạng trang cũ, không tiếp tục chồng override lên bản hiện tại.

Hướng thiết kế: **B2B rõ nghiệp vụ — chính xác, điềm tĩnh, có bằng chứng sản phẩm**.

- Khách hàng: chuyên viên đấu thầu, người quản lý và đội ngũ doanh nghiệp.
- Mục tiêu: hiểu công dụng → xem sản phẩm → hiểu gói phù hợp → bắt đầu sử dụng.
- Giữ Plus Jakarta Sans local, bộ màu và token của `design.md`.
- Sửa hệ thống icon trước; sau đó duyệt hero desktop/mobile rồi mới triển khai phần còn lại.
- Pricing tiếp tục lấy `/api/public/commercial/offers`; không phục hồi ba gói mặc định Bạc/Vàng/Kim cương.

Tài liệu này chỉ đề xuất thay đổi phần marketing. Không thay framework, auth/session, dữ liệu nghiệp vụ, quyền, role, scope hay entitlement.

## 2. Phát hiện từ ảnh và mã hiện tại

### 2.1. Icon mất: đã xác nhận lỗi danh mục

Đối chiếu `views/components/landing_page.html` với `views/assets/landing-icons.svg`:

| Chỉ số | Kết quả |
|---|---:|
| Tên icon khác nhau được HTML sử dụng | 42 |
| Symbol hiện có trong sprite | 24 |
| Tên HTML gọi nhưng sprite không có | 26 |
| Tổng vị trí icon trong HTML | 74 |
| Vị trí gọi symbol không tồn tại | 37 |

Sprite có 24 symbol không có nghĩa hỗ trợ được 24/42 tên đang dùng: chỉ 16 tên khớp; 8 symbol khác không được HTML tĩnh này sử dụng.

Các tên thiếu:

`bell-ring`, `git-merge`, `file-spreadsheet`, `building-2`, `users`, `calendar-days`, `chevron-right`, `clock-3`, `file-warning`, `megaphone`, `pie-chart`, `briefcase-business`, `alarm-clock`, `circle-check-big`, `scan-search`, `git-pull-request-arrow`, `workflow`, `radar`, `database-zap`, `file-text`, `route`, `package-plus`, `folder-open`, `list-checks`, `user-round`, `radio-tower`.

`frontend/landing/landingIcons.js:4` tạo `<use href="…#icon-{name}">` mà không kiểm tra tên có trong danh mục. Fallback `info` chỉ áp dụng khi tên rỗng, không áp dụng cho tên không tồn tại.

Hai ô callout trong ảnh gọi `alarm-clock` và `circle-check-big`; cả hai đều thiếu. Các ô tính năng gọi `database-zap` và `route` cũng thiếu. Điều này giải thích trực tiếp các ô nền màu không có hình.

### 2.2. Icon đen/méo: đã xác nhận lỗi thuộc tính SVG

Renderer tạo SVG không đặt `fill="none"`, `stroke="currentColor"` và quy chuẩn đầu nét. Sprite cũng không cung cấp các thuộc tính nét này. CSS landing có một số selector quy định kích thước nhưng không có hợp đồng hiển thị chung cho `.landing-icon`.

Phép kiểm chứng bằng Chromium, dùng HTML/CSS/renderer thật trong trang cô lập và chuyển tham chiếu sprite thành fragment nội trang, cho kết quả:

```json
{"icons":74,"missingInstances":37,"paint":{"fill":"rgb(0, 0, 0)","stroke":"none"}}
```

Vì vậy icon hồ sơ thành khối đen; đường mũi tên/check không còn nét đúng. Đây không đơn thuần là lỗi mạng hoặc chọn màu chưa đẹp. Cơ chế tô và vẽ nét tương ứng với [MDN fill](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/fill) và [MDN stroke](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke).

Giới hạn bằng chứng: chưa tái hiện phiên trình duyệt người dùng qua máy chủ đang chạy; probe cô lập không kiểm tra HTTP, CSP hoặc cache của external sprite. Chưa tính các icon pricing sinh động. Bước triển khai phải kiểm chứng thêm hai phạm vi này.

### 2.3. Những điểm làm trang thiếu chuyên nghiệp

| Ưu tiên | Vị trí | Vấn đề | Hướng xử lý |
|---|---|---|---|
| P0 | Renderer + sprite | Icon trống/đen và không có kiểm tra coverage | Một danh mục icon, một quy chuẩn nét, test tên và hình render |
| P1 | Hero, HTML dòng 41; CSS khoảng dòng 311 | Headline dài, nặng và xuống nhiều dòng; mô tả dài; CTA bị đẩy thấp | Headline cụ thể hơn, giới hạn độ lớn và độ rộng, mô tả 2 câu ngắn |
| P1 | Product preview, HTML dòng 60 trở đi | Toàn dashboard bị thu nhỏ; CSS chứa nhiều cỡ chữ 4–8px | Dùng ảnh thật và crop khu vực nghiệp vụ cần xem |
| P1 | Solutions, HTML dòng 199 trở đi | Card trong card; ô icon lớn; khoảng trống không giúp đọc nội dung | Một lớp khung, minh họa gắn trực tiếp với công dụng |
| P1 | Hero actions, HTML dòng 43 trở đi | Khi commercial bị ẩn, CTA còn lại mang kiểu secondary | Primary action luôn có trọng lượng thị giác chính theo state |
| P2 | Nhãn section/copy | Nhiều cụm trừu tượng, số thứ tự trang trí, lặp nhịp icon–heading–paragraph | Dùng tiêu đề nghiệp vụ cụ thể; chỉ đánh số quy trình thật |

Audit thẩm mỹ: 1 critical (card-in-card), 3 major (headline/hierarchy, miniature preview, icon-tile/eyebrow repetition). Lỗi icon kỹ thuật được phân loại P0 riêng, không gộp thành nhận xét “xấu”.

## 3. Hệ thống thị giác

### Nền, màu và chữ

- Nền sáng hơi lạnh, vùng nội dung trắng; navy dùng có giới hạn cho phần chốt giá trị, không làm mảng nghiêng chiếm nửa màn hình.
- Cobalt dành cho hành động chính và điểm nhấn. Xanh lá/amber/đỏ chỉ dùng cho trạng thái có ý nghĩa.
- Dùng các token `--canvas`, `--surface`, `--ink`, `--ink-muted`, `--primary`, `--line` cùng lớp token hiện có. Không tạo bảng màu độc lập cho mỗi section.
- Giữ Plus Jakarta Sans cho cả tiêu đề và nội dung theo `design.md`; không thêm dependency Google Fonts hoặc font mới chỉ để tạo khác biệt.
- H1 dự kiến 48–56px desktop, 32–36px mobile; weight 650–700 nếu font hỗ trợ. Tránh tracking quá chặt và kiểm tra dấu tiếng Việt.
- H2 30–36px desktop, 26–30px mobile; body 16–18px, line-height 1.55–1.7.

Các kích thước trên là mục tiêu thiết kế, cần chốt bằng ảnh render ở kích thước CSS thực, không suy ra từ pixel của screenshot đã scale.

### Layout

- Container 1200–1280px tối đa; gutter 20px mobile, 32px tablet và lớn hơn khi cần ở desktop.
- Khoảng cách theo thang 4/8px. Section chính 72–96px desktop, 40–56px mobile; đoạn chuyển tiếp ngắn hơn.
- Border mảnh, radius khoảng 12–16px, shadow nhẹ. Không cho mọi card nổi cùng một mức.
- Native scroll; không full-height bắt buộc, scroll-jacking hoặc thêm lớp lock mới.
- Không chữa overflow bằng cách che phần tràn toàn trang. Sửa nguyên nhân kích thước; chỉ clip trang trí tại container tương ứng.

## 4. Hero đề xuất

Copy để duyệt:

> **Quản lý toàn bộ quy trình đấu thầu**  
> **trên một nền tảng duy nhất**
>
> Tập trung kế hoạch LCNT, gói thầu, hồ sơ và hợp đồng. Theo dõi thời hạn và trạng thái xử lý trong cùng một hệ thống.

Headline theo đúng định hướng người dùng đã cung cấp; các claim bổ sung phải được đối chiếu module thật trước khi đưa lên trang.

Desktop: bố cục chia khoảng 45/55. Cột copy giới hạn độ rộng, hình sản phẩm không bị chữ che. Không ép xuống đúng hai dòng ở mọi viewport; mục tiêu 2–3 dòng desktop, 3–4 dòng mobile.

```text
Logo          Sản phẩm · Quy trình · Bảng giá · FAQ       Đăng nhập  [CTA]

Quản lý toàn bộ                 [Ảnh sản phẩm thật / crop rõ]
quy trình đấu thầu              Thời hạn cần xử lý
trên một nền tảng duy nhất      Trạng thái gói thầu

Hai câu mô tả                  Chú thích: Giao diện minh họa
[Bắt đầu/Dùng thử] [Xem sản phẩm]
```

Wireframe chỉ diễn tả phân cấp, không phải thiết kế final.

- Primary CTA: “Dùng thử miễn phí” chỉ khi runtime/config xác nhận trial; nếu không, “Bắt đầu sử dụng”.
- Secondary CTA: “Xem sản phẩm”, trỏ đến phần giới thiệu thực sự tồn tại.
- Người đã đăng nhập dùng destination theo routing hiện hành, không bắt đăng nhập lại.
- Không dùng “Vào không gian làm việc” cho visitor chưa hiểu sản phẩm.
- Commercial off không được làm mất primary CTA hoặc để lại nút checkout chết.

### Hình sản phẩm

Chụp ứng dụng thật với bộ dữ liệu demo được phép dùng; không đưa dữ liệu khách hàng lên marketing. Ghi rõ “Dữ liệu minh họa”, tránh làm số liệu demo giống social proof.

Hero ưu tiên crop “Cần xử lý hôm nay” và trạng thái gói; ảnh đầy đủ đặt ở walkthrough. Không vẽ lại thanh browser/OS hoặc thu nhỏ toàn dashboard đến mức không đọc được.

Tối đa một callout nếu giúp giải thích nghiệp vụ, không che vùng quan trọng. Mobile chuyển chú thích xuống dưới ảnh; không giữ floating card chồng mép. Ảnh có kích thước giữ chỗ, định dạng tối ưu; nếu là LCP thì không lazy-load.

## 5. Nhịp nội dung toàn trang

Giữ trục nội dung cũ, cải tổ cách trình bày:

| Phần | Nội dung | Bố cục |
|---|---|---|
| Hero | Sản phẩm là gì, giải quyết việc gì, CTA | Copy + hình sản phẩm |
| Vấn đề → giá trị | Deadline, hồ sơ phân tán, trạng thái khó theo dõi | Một dải so sánh ngắn; không dựng 3 card giống nhau |
| Giải pháp | Quản lý tập trung, theo dõi tiến độ, Word/Excel | 2–3 spotlight xen kẽ ảnh/text, mỗi phần một lợi ích |
| Quy trình | Kế hoạch → gói thầu → xử lý hồ sơ → kết quả/hợp đồng, xác minh bước thật | Timeline ngang desktop, danh sách dọc mobile |
| Theo vai trò | Công việc của chuyên viên và tổng quan của quản lý | Hai cột biên tập, không tự định nghĩa lại quyền |
| Pricing | Offers do cấu hình cung cấp | Grid linh hoạt theo số lượng, nội dung dễ so sánh |
| FAQ | Gỡ do dự về trial, quota, thanh toán, hết hạn | Thêm sau khi xác minh policy; dùng accordion accessible |
| Final CTA + footer | Nhắc lại giá trị và bước tiếp theo | Một dải CTA gọn, legal link thực có |

Giải pháp không quảng cáo tính năng mới. Loại mọi con số tiết kiệm thời gian, testimonial, logo khách hàng hoặc chứng nhận không có bằng chứng.

## 6. Quy chuẩn icon bắt buộc

Chọn **một họ Lucide outline local**, đồng bộ với ngôn ngữ icon đang dùng trong ứng dụng. Không trộn Phosphor, emoji, glyph font và icon tự phác thảo trong cùng landing.

| Thuộc tính | Quy chuẩn đề xuất |
|---|---|
| ViewBox | 0 0 24 24 |
| Fill | none cho line icon; ngoại lệ logo tách riêng |
| Stroke | currentColor |
| Stroke width | 2 ở lưới 24px; không tăng riêng từng section |
| Line cap/join | round |
| Kích thước | 16px inline nhỏ, 20px CTA, 24px tính năng, 32px spotlight |
| Container | Tùy chức năng; không mặc định icon nào cũng cần ô nền |
| A11y | Decorative: aria-hidden; nút icon-only có accessible name |

Ánh xạ ngữ nghĩa dự kiến: kế hoạch → clipboard-list; gói thầu → package; deadline → calendar-clock; hồ sơ → files; nhân sự → users-round; hợp đồng → file-signature. Đây là mapping để duyệt, không phải lý do đổi icon workspace ngoài phạm vi.

Kiến trúc ưu tiên: tiếp tục sprite local nhẹ, nhưng sinh từ một allowlist và source Lucide đã pin trong repository. HTML và pricing renderer dùng cùng danh mục. Thiếu tên phải fail test/build; runtime dùng fallback có thật và giữ nhãn chữ. Không giả định `name || info` xử lý được unknown name.

Phiên bản URL sprite phải gắn với nội dung/build, không dùng một ngày cố định mãi. Kiểm chứng `200`, MIME, fragment ID, CSP và cache sau deploy. Không nới CSP hoặc quay lại eager-load toàn bộ workspace để sửa icon landing.

## 7. Pricing và mobile không được thoái lui

- `/api/public/commercial/offers` giữ nguyên source of truth. Render được 0/1/2/3/4+ offers; không card rỗng để đủ ba cột.
- Giá, kỳ thanh toán, quota, recommendation/badge và thứ tự chỉ theo dữ liệu có thật. Không suy gói đắt nhất là phổ biến nhất.
- API loading/off/error có UX riêng; hero và nội dung marketing không chờ pricing.
- Giữ offer context qua auth/checkout nếu luồng hiện tại hỗ trợ có validation; không tự hack query string.
- Duyệt mobile 390px từ đầu, không đợi cuối dự án. CTA xếp dọc khi cần; giá, tên offer không cắt mất.
- Menu mobile phải có nút thật, mở/đóng, Escape, focus return, anchor click và resize an toàn. Hiện JS tìm `data-landing-menu-toggle`/`data-landing-nav`, trong phần header HTML được đọc không có hai hook đó: cần kiểm thử integration, không chỉ kiểm tra có hàm menu.

## 8. Phạm vi triển khai sau khi duyệt

| File/nhóm | Công việc dự kiến |
|---|---|
| `frontend/landing/landingIcons.js` | Danh mục, fallback, thuộc tính SVG, cơ chế version URL |
| `views/assets/landing-icons.svg` | Đồng bộ symbol với danh mục được duyệt |
| `views/components/landing_page.html` | Hero, hierarchy, semantic sections, menu hooks, copy và icon |
| `views/css/landing.css` | Refactor theo layout/components/sections/responsive/motion; không nối override vô hạn |
| `frontend/landing/LandingPage.js` | Chỉ các hook presentation, menu, CTA state và render icon pricing cần thiết |
| `views/css/landing-shell.css`, `vite.config.js`, `backend/app.py` | Chỉ sửa nếu cần wiring/version/serving asset; giữ boundary landing/workspace |
| `views/assets/…` | Ảnh sản phẩm demo được kiểm chứng; không tạo asset trong vòng lập phương án |
| `tests/js/…`, `e2e/specs/landing.spec.mjs` | Icon coverage, paint, navigation, pricing states, scroll và screenshot |

Không xóa file production mặc định. Chỉ bỏ selector đã xác minh không còn consumer. Không sửa global token/app CSS để ép landing nếu có thể giải quyết trong namespace `.landing-*`.

## 9. Thứ tự và cổng duyệt

1. Chụp baseline thực trên source và secure bundle; xác định release, viewport, zoom và state commercial.
2. Viết test đỏ cho missing symbol, SVG paint và dynamic pricing icon; sửa icon rồi chụp lại cùng bố cục cũ. Tách riêng lợi ích của fix và redesign.
3. Dựng hero desktop 1440px và mobile 390px để người dùng duyệt; chưa làm lại cả trang khi hero chưa được chốt.
4. Triển khai spotlight, workflow, pricing, FAQ và footer theo hệ thống đã duyệt.
5. Kiểm tra browser, scroll, a11y, SEO, performance, screenshots và báo cáo chênh lệch.

Không công bố “đẹp hơn” chỉ bằng đọc code hoặc điểm tự chấm. Duyệt ảnh render thực ở desktop/mobile là cổng chất lượng bắt buộc.

## 10. Tiêu chí nghiệm thu

- Mọi tên icon static/dynamic đều resolve; không ô trống ngoài loading state có chủ đích. Không còn fill đen ngoài ý đồ thiết kế.
- Icon có bbox không rỗng và ảnh render đúng; không chỉ assert số lượng `<svg>` hoặc HTTP 200 của sprite.
- Có screenshot icon sheet và screenshot landing desktop/mobile/pricing/commercial-off; kiểm tra cold load và cache sau release change.
- Chromium/Firefox/WebKit: wheel, keyboard, touch/mobile và programmatic scroll tới footer; kiểm tra Back/Forward, auth return, menu và resize; không scroll-lock leak.
- Responsive: 320, 375, 390, 414, 768, 1024, 1440, 1920 và 2560px; 200% zoom; không tràn ngang hoặc cắt nội dung.
- Pricing 0/1/2/3/4+; trial/off/error; guest/authenticated và đích CTA thật.
- Một H1; nội dung marketing trong initial HTML; metadata và canonical hợp lệ theo environment. FAQ/structured data chỉ phản ánh nội dung/chính sách thật.
- Giữ nguyên các test auth, commercial và startup có liên quan. Không hạ gate để đạt báo cáo xanh.
- Mục tiêu Lighthouse: Performance ≥90, Accessibility ≥95, Best Practices ≥95, SEO ≥95 trong môi trường đo được ghi rõ. Ghi actual; không lấy số đo workspace cũ làm baseline landing.
- So sánh network/JS/CPU trước–sau; không thêm thư viện animation nặng hoặc font network. Nội dung không phụ thuộc animation mới xuất hiện; tôn trọng reduced motion.

## 11. Trạng thái bàn giao phương án

Vòng này đã kiểm tra ảnh, danh mục icon, renderer, CSS, design system, shell stylesheet và một số hook commercial/navigation; đã chạy probe Chromium cô lập. Không sửa code production, không build/restart server, không tạo ảnh giả làm kết quả đã triển khai.

UI/UX Pro Max định hướng tính nhất quán và khả năng đọc; Hallmark giúp loại bớt card lồng nhau, chữ quá khổ và trang trí không mang thông tin. Quy tắc của `design.md` và contract sản phẩm được ưu tiên hơn gợi ý đổi font/framework của skill.

Đề xuất duyệt: giữ hướng **B2B rõ nghiệp vụ**, triển khai icon fix trước và duyệt một hero desktop/mobile trước khi làm toàn trang.
