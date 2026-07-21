# Design — BiddingFlow

Đây là design system dùng chung cho toàn bộ frontend BiddingFlow. Các page
redesign phải đọc file này trước khi thêm CSS mới. Không tạo theme riêng cho
từng tab.

## Genre

Modern-minimal, utilitarian — giao diện điều hành hồ sơ và phân công nghiệp vụ.

## Macrostructure family

- **Marketing:** Marquee Hero tối giản; product figure không dựng fake chrome.
- **App:** Workbench; toolbar, trạng thái cần xử lý và data surface là nhịp
  chính.
- **Content/forms:** Long Document; section rõ, một cột trên mobile.

## Information architecture

- **Dashboard:** `Cần xử lý hôm nay` là khối đầu tiên; tổng quan và biểu đồ
  đứng sau hành động.
- **Nghiệp vụ chính:** Kế hoạch → Gói thầu → Timeline → Hợp đồng.
- **Đối tác:** Chủ đầu tư → Nhà thầu → Chuyên gia.
- **Điều hành:** Nhân sự → Phân quyền → Hồ sơ giấy.
- **Thông báo:** một timeline duy nhất; hoạt động, cảnh báo và lỗi chỉ khác
  bằng severity/icon, không chia nhiều panel có viền nặng.

## Theme

Các giá trị primitive nằm trong `views/css/tokens.css`; các stylesheet dùng
semantic token, không thêm hex/rgb giữa rule.

- `--color-paper`: `oklch(98.1% 0.012 250)`
- `--color-paper-2`: `oklch(96.6% 0.018 250)`
- `--color-surface`: `oklch(100% 0 0)`
- `--color-ink`: `oklch(22% 0.035 255)`
- `--color-muted`: `oklch(43% 0.045 255)`
- `--color-rule`: `oklch(89% 0.028 250)`
- `--color-accent`: `oklch(53% 0.205 263)`
- `--color-accent-strong`: `oklch(45% 0.19 263)`
- `--color-focus`: `oklch(62% 0.21 263)`
- `--color-success`: `oklch(50% 0.12 165)`
- `--color-warning`: `oklch(54% 0.14 65)`
- `--color-danger`: `oklch(52% 0.18 25)`

Vai trò chỉ dùng cho active context: Super Admin = violet, quản lý = blue,
chuyên viên = green. Nút hành động vẫn dùng accent chung.

## Typography

- **Target pairing:** display face hỗ trợ tiếng Việt (ưu tiên self-hosted
  Be Vietnam Pro hoặc candidate tương đương sau visual compare) + Plus Jakarta
  Sans cho body.
- **Migration fallback:** hiện dùng Plus Jakarta Sans cho cả display/body để
  giữ nguyên metrics; không tải font ngoài runtime. Việc đổi display face là
  một deliverable riêng của Phase 4.
- `--font-display` và `--font-body` là token duy nhất; phase 4 sẽ đánh giá
  display face hỗ trợ tiếng Việt trước khi thay đổi font.
- Heading không italic; tiêu đề dài phải `min-width: 0` và
  `overflow-wrap: anywhere`.

## Spacing, radius, motion

- Spacing 4pt: `--space-1` đến `--space-12`.
- Radius: input 8px, card 12px, dialog 16px, pill 999px.
- Easing: `--ease-out`, `--ease-in`, `--ease-in-out`; chỉ animate opacity và
  transform. Reduced motion tối đa 150ms opacity.
- Entrance chỉ ở cấp trang/section; không animate từng card khi xuất hiện.

## Data surfaces và mobile

- Mỗi bảng nằm trên một data surface; header sticky, có density thấp/vừa/cao.
- Ở 320–768px, bảng ưu tiên row-card/detail; scroll ngang chỉ là phương án
  cuối cho bảng cần so sánh nhiều cột.
- Sidebar là drawer có backdrop; shell không được bị cắt khỏi viewport.

## Microinteractions

- Focus ring hiển thị ngay, không animate.
- Success ưu tiên cập nhật im lặng; lỗi dùng màu đỏ và hành động thử lại.
- Tooltip hover 800ms, focus 0ms.
- Mobile drawer có backdrop và đóng bằng Escape; modal form một cột.
- Modal ngắn dùng cho xác nhận, đổi trạng thái, gán người và xem chi tiết.
- Theo quy ước sản phẩm hiện tại, năm biểu mẫu nghiệp vụ dài — Gói thầu,
  Kế hoạch, Chủ đầu tư, Nhà thầu và Hợp đồng — dùng chung `modal-wide-form`:
  `1120px × min(92dvh, 900px)` trên desktop và sheet toàn màn hình trên mobile.
  Không tạo kích thước riêng cho từng loại biểu mẫu.

## Per-page allowances

- App pages không dùng decorative enrichment; dữ liệu và trạng thái là điểm
  nhấn.
- Landing được dùng figure/screenshot thật hoặc data canvas; không fake URL bar.
- Bảng dữ liệu được phép scroll nội bộ khi thật sự cần, nhưng shell không được
  tràn ngang.

## File conventions

- Runtime token source: `views/css/tokens.css`.
- Compatibility tokens legacy giữ trong `views/css/variables.css` trong thời
  gian migration; không thêm token mới vào legacy nếu đã có semantic token.
- Mọi phase phải cập nhật `docs/frontend-redesign-plan.md` và chạy build.

## Exports

### Runtime `tokens.css`

Nguồn chạy thật là `views/css/tokens.css`; file `tokens.css` ở root chỉ làm cầu
nối để tái sử dụng ngoài runtime.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(98.1% 0.012 250);
  --color-paper-2: oklch(96.6% 0.018 250);
  --color-ink: oklch(22% 0.035 255);
  --color-muted: oklch(43% 0.045 255);
  --color-rule: oklch(89% 0.028 250);
  --color-accent: oklch(53% 0.205 263);
  --color-focus: oklch(62% 0.21 263);
  --font-display: "Plus Jakarta Sans", sans-serif;
  --font-body: "Plus Jakarta Sans", sans-serif;
  --spacing-sm: 0.75rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --radius-input: 0.5rem;
  --radius-card: 0.75rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.1% 0.012 250)", "$type": "color" },
    "ink": { "$value": "oklch(22% 0.035 255)", "$type": "color" },
    "rule": { "$value": "oklch(89% 0.028 250)", "$type": "color" },
    "accent": { "$value": "oklch(53% 0.205 263)", "$type": "color" },
    "focus": { "$value": "oklch(62% 0.21 263)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Plus Jakarta Sans, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Plus Jakarta Sans, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 98.1% 0.012 250;
  --foreground: 22% 0.035 255;
  --card: 100% 0 0;
  --card-foreground: 22% 0.035 255;
  --primary: 53% 0.205 263;
  --primary-foreground: 98.5% 0.008 250;
  --muted: 96.6% 0.018 250;
  --muted-foreground: 43% 0.045 255;
  --border: 89% 0.028 250;
  --input: 89% 0.028 250;
  --ring: 62% 0.21 263;
  --radius: 0.75rem;
}
```
