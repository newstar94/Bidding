# Hướng dẫn Codex triển khai mapping Phương pháp đánh giá từ dữ liệu muasamcong

## Mục tiêu

Bổ sung logic đọc và mapping **Phương pháp đánh giá** từ dữ liệu E-HSMT lấy về từ muasamcong.

Dữ liệu phương pháp đánh giá nằm trong phần tử có dạng:

```json
{
  "formCode": "BD.CG.02.0113",
  "formValue": "{\"method\":\"1\",\"cost\":null,...}"
}
```

`formValue` là chuỗi JSON, cần parse trước khi sử dụng.

---

## Quy tắc mapping

Không được mapping chỉ dựa trên `method`, vì `method = "2"` có ý nghĩa khác nhau tùy lĩnh vực gói thầu.

| method | Lĩnh vực TV - Tư vấn | Các lĩnh vực khác |
|---|---|---|
| `"1"` | Giá thấp nhất | Giá thấp nhất |
| `"2"` | Giá cố định | Giá đánh giá |
| `"3"` | Kết hợp kỹ thuật và giá | Kết hợp kỹ thuật và giá |
| `"4"` | Dựa trên kỹ thuật | Dựa trên kỹ thuật |

Trong đó các lĩnh vực khác `TV` có thể gồm `HH`, `XL`, `PTV`, `HON_HOP` và các mã lĩnh vực khác của hệ thống.

### Logic chuẩn

```ts
function mapEvaluationMethod(
  method: string | number | null | undefined,
  bidField: string | null | undefined
): string | null {
  if (method === null || method === undefined) {
    return null;
  }

  const normalizedMethod = String(method).trim();
  const normalizedBidField = String(bidField ?? '')
    .trim()
    .toUpperCase();

  switch (normalizedMethod) {
    case '1':
      return 'Giá thấp nhất';

    case '2':
      if (!normalizedBidField) {
        return null;
      }

      return normalizedBidField === 'TV'
        ? 'Giá cố định'
        : 'Giá đánh giá';

    case '3':
      return 'Kết hợp kỹ thuật và giá';

    case '4':
      return 'Dựa trên kỹ thuật';

    default:
      return null;
  }
}
```

---

## Cách lấy `method`

Tìm trong danh sách dữ liệu E-HSMT:

```ts
const evaluationForm = biddingData?.find(
  item => item?.formCode === 'BD.CG.02.0113'
);
```

Parse `formValue` an toàn:

```ts
function safeParseJson<T = any>(value: unknown): T | null {
  if (!value) return null;

  if (typeof value === 'object') {
    return value as T;
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
```

Sau đó:

```ts
const evaluationValue = safeParseJson<{
  method?: string | number;
  cost?: number | string | null;
}>(evaluationForm?.formValue);

const evaluationMethod = mapEvaluationMethod(
  evaluationValue?.method,
  bidField
);
```

---

## Cách xác định `bidField`

Không được giả định chỉ có một đường dẫn dữ liệu. Hãy kiểm tra cấu trúc dữ liệu hiện tại của project và ưu tiên trường chính xác đang được backend lưu.

Có thể fallback theo thứ tự tương tự:

```ts
const bidField =
  source?.bidField ??
  source?.investField ??
  source?.bidpPlanDetail?.bidField ??
  source?.bidpPlanDetailDTO?.bidField ??
  null;
```

Tuy nhiên phải **tận dụng model/type hiện có của project**, không copy nguyên đoạn trên nếu cấu trúc thực tế khác.

---

## Không được dùng `evalMethod`

Trong dữ liệu muasamcong có field:

```json
"evalMethod": null
```

Field này thường đang `null`, vì vậy **không sử dụng `evalMethod` làm nguồn chính để xác định phương pháp đánh giá**.

Nguồn chính hiện tại phải là:

```text
formCode = BD.CG.02.0113
      ↓
JSON.parse(formValue)
      ↓
formValue.method
      ↓
kết hợp với bidField
      ↓
tên phương pháp đánh giá
```

---

## Không nhầm với `evalTechnical`

Có một form khác:

```json
{
  "formCode": "BD.CG.02.0104",
  "formValue": "{\"evalTechnical\":\"0\",...}"
}
```

`evalTechnical` **không phải phương pháp đánh giá tổng thể**.

Nó liên quan đến cách đánh giá/chấm kỹ thuật.

Vì vậy tuyệt đối không viết logic:

```ts
// SAI
if (evalTechnical === '1') {
  evaluationMethod = 'Kết hợp kỹ thuật và giá';
}
```

---

## Field `cost`

Trong `BD.CG.02.0113` còn có:

```json
{
  "method": "2",
  "cost": ...
}
```

Có khả năng `cost` được sử dụng trong phương pháp **Giá cố định**, nhưng hiện tại **không sử dụng `cost` để quyết định tên phương pháp đánh giá**.

Chỉ lưu `cost` nếu hệ thống cần sử dụng sau này.

Phương pháp đánh giá vẫn phải xác định bằng:

```text
method + bidField
```

---

## Yêu cầu kiến trúc

Không rải mapping trực tiếp ở nhiều component/service.

Hãy tạo một hàm/helper/service dùng chung, ví dụ:

```text
utils/evaluationMethod.ts
```

hoặc vị trí phù hợp với kiến trúc hiện tại.

Có thể định nghĩa constant:

```ts
export const EVALUATION_METHOD = {
  LOWEST_PRICE: 'Giá thấp nhất',
  FIXED_BUDGET: 'Giá cố định',
  EVALUATED_PRICE: 'Giá đánh giá',
  QUALITY_COST_BASED: 'Kết hợp kỹ thuật và giá',
  QUALITY_BASED: 'Dựa trên kỹ thuật',
} as const;
```

Sau đó helper chỉ trả về constant tương ứng.

---

## Xử lý trường hợp thiếu dữ liệu

Nếu:

- không tồn tại `BD.CG.02.0113`;
- `formValue` lỗi JSON;
- không có `method`;
- `method` không thuộc `1,2,3,4`;

thì:

```ts
return null;
```

Không được tự đoán.

Nếu `method = 2` nhưng không xác định được `bidField`, cũng **không nên tự mặc định là Giá đánh giá**, vì có nguy cơ gói đó là tư vấn.

Nên xử lý:

```ts
case '2':
  if (!normalizedBidField) {
    return null;
  }

  return normalizedBidField === 'TV'
    ? 'Giá cố định'
    : 'Giá đánh giá';
```

---

## Test bắt buộc

Viết unit test tối thiểu cho các trường hợp:

```text
method=1, bidField=HH
=> Giá thấp nhất

method=1, bidField=TV
=> Giá thấp nhất

method=2, bidField=TV
=> Giá cố định

method=2, bidField=HH
=> Giá đánh giá

method=2, bidField=XL
=> Giá đánh giá

method=2, bidField=PTV
=> Giá đánh giá

method=3, bidField=TV
=> Kết hợp kỹ thuật và giá

method=3, bidField=HH
=> Kết hợp kỹ thuật và giá

method=4, bidField=TV
=> Dựa trên kỹ thuật

method=4, bidField=HH
=> Dựa trên kỹ thuật

method=null
=> null

method=5
=> null

method=2, bidField=null
=> null

formValue JSON lỗi
=> null
```

### Regression test bằng dữ liệu thực tế

```text
IB2600271825
bidField = HH
method = 1
=> Giá thấp nhất
```

Và nếu trong quá trình test lấy được dữ liệu thực tế của:

```text
IB2600079201
```

hãy kiểm tra `BD.CG.02.0113.formValue.method`.

Kỳ vọng hiện tại:

```text
bidField = TV
method = 3
=> Kết hợp kỹ thuật và giá
```

Nếu dữ liệu API thực tế khác kỳ vọng trên thì **không được ép mapping theo tài liệu này**.

Hãy:

1. ghi lại raw fixture;
2. báo rõ sự khác biệt;
3. cập nhật mapping dựa trên dữ liệu thực tế.

---

## Yêu cầu triển khai cuối cùng

Sau khi triển khai, Codex phải báo:

1. File nào đã sửa.
2. Vị trí lấy `BD.CG.02.0113`.
3. Nguồn `bidField` đang sử dụng.
4. Nơi lưu/hiển thị `evaluationMethod`.
5. Kết quả chạy test.
6. Không thay đổi logic nghiệp vụ khác ngoài phạm vi cần thiết.
7. Không hard-code phương pháp đánh giá theo mã TBMT cụ thể.

---

## Lưu ý quan trọng nhất

**`method = 2` bắt buộc phải xét `bidField`.**

Không được viết mapping kiểu:

```ts
2 => 'Giá đánh giá'
```

cho tất cả các gói thầu.

Quy tắc đúng:

```text
method = 2 + bidField = TV
=> Giá cố định

method = 2 + bidField != TV
=> Giá đánh giá
```

Nếu thiếu `bidField`:

```text
=> null
```

Không được tự suy đoán.
