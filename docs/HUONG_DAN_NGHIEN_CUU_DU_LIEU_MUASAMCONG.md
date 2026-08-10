# HƯỚNG DẪN NGHIÊN CỨU VÀ LẤY DỮ LIỆU CÔNG KHAI TỪ MUASAMCONG

> Mục đích: nghiên cứu kỹ thuật và khai thác **dữ liệu công khai** trên Hệ thống mạng đấu thầu quốc gia.
>
> Website: https://muasamcong.mpi.gov.vn/
>
> Lưu ý: Tài liệu này **không hướng dẫn vượt đăng nhập, OTP, CAPTCHA, cơ chế chống bot hoặc bất kỳ biện pháp kiểm soát truy cập nào**. Chỉ nên sử dụng với dữ liệu mà người dùng bình thường có thể xem công khai trên website.

---

## 1. Mục tiêu

Tài liệu này hướng dẫn cách nghiên cứu luồng dữ liệu của:

- Kế hoạch lựa chọn nhà thầu (KHLCNT), thường có mã dạng `PL...`
- Gói thầu / Thông báo mời thầu (TBMT), thường có mã dạng `IB...`
- Thông tin chi tiết gói thầu
- Các ID liên quan như:
  - `notifyId`
  - `bidOpenId`
  - `inputResultId`
  - `planNo`
  - `notifyNo`

Hướng tiếp cận được khuyến nghị là:

```text
Trình duyệt
    ↓
Chrome DevTools
    ↓
Network
    ↓
Fetch/XHR
    ↓
Xác định request mà website đang sử dụng
    ↓
Copy as cURL
    ↓
Tái hiện request bằng Python / Node.js
```

Không nên bắt đầu bằng việc scrape HTML nếu dữ liệu thực tế được website tải động bằng API.

---

# 2. Tại sao nên nghiên cứu Fetch/XHR thay vì scrape HTML?

Website `muasamcong.mpi.gov.vn` tải nhiều dữ liệu động sau khi trang đã mở.

Vì vậy, nếu chỉ gọi:

```python
requests.get("https://muasamcong.mpi.gov.vn/...")
```

thì HTML nhận được có thể không chứa đầy đủ dữ liệu mà người dùng nhìn thấy trên trình duyệt.

Trong nhiều trường hợp, luồng thực tế là:

```text
HTML ban đầu
    ↓
JavaScript chạy
    ↓
Fetch / XHR
    ↓
API trả JSON
    ↓
JavaScript render dữ liệu lên màn hình
```

Do đó, cách ổn định hơn là nghiên cứu chính request mà website đang gửi.

---

# 3. Bắt request bằng Chrome DevTools

## 3.1. Mở DevTools

Truy cập:

```text
https://muasamcong.mpi.gov.vn/
```

Sau đó:

1. Nhấn `F12`
2. Chọn tab **Network**
3. Chọn bộ lọc **Fetch/XHR**
4. Thực hiện tìm kiếm một KHLCNT hoặc gói thầu trên website
5. Quan sát các request mới xuất hiện

---

## 3.2. Những thông tin cần kiểm tra

Bấm vào từng request và xem:

### Headers

Quan tâm tới:

```text
Request URL
Request Method
Content-Type
Origin
Referer
```

### Payload

Nếu là `POST`, kiểm tra:

```text
Request Payload
```

hoặc:

```text
Form Data
```

### Response

Kiểm tra dữ liệu JSON trả về.

Có thể dùng chức năng tìm kiếm trong Response để tìm:

```text
PL...
```

hoặc:

```text
IB...
```

mà bạn vừa tra cứu.

---

## 3.3. Copy request chính xác

Sau khi tìm được request cần nghiên cứu:

```text
Chuột phải request
→ Copy
→ Copy as cURL
```

Đây là cách rất hữu ích vì cURL chứa gần như toàn bộ:

- URL
- Method
- Header
- Body
- Query parameters

Sau đó mới chuyển request đó sang Python hoặc Node.js.

---

# 4. Endpoint tìm kiếm dữ liệu lựa chọn nhà thầu

Một endpoint từng được ghi nhận từ request thực tế của portal là:

```text
POST
https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/smart/search
```

> Cảnh báo: Đây không nên được xem là API công khai có hợp đồng ổn định. Endpoint, body hoặc header có thể thay đổi. Luôn kiểm tra lại bằng DevTools trước khi sử dụng.

---

# 5. Ví dụ tìm kiếm một gói thầu theo mã TBMT

Ví dụ mã:

```text
IB2600026487
```

Một cấu trúc request có thể có dạng:

```json
[
  {
    "pageSize": 10,
    "pageNumber": 0,
    "query": [
      {
        "index": "es-contractor-selection",
        "keyWord": "IB2600026487",
        "matchType": "exact",
        "matchFields": [
          "notifyNo",
          "bidName"
        ],
        "filters": [
          {
            "fieldName": "type",
            "searchType": "in",
            "fieldValues": [
              "es-notify-contractor"
            ]
          }
        ]
      }
    ]
  }
]
```

Ý nghĩa sơ bộ:

```text
pageSize
    Số bản ghi mỗi trang

pageNumber
    Trang cần lấy

index
    Chỉ mục dữ liệu mà hệ thống tìm kiếm

keyWord
    Từ khóa

matchType
    Kiểu so khớp

matchFields
    Các trường được tìm kiếm

filters
    Điều kiện lọc
```

---

# 6. Ví dụ Python gọi request tìm gói thầu

```python
import requests

URL = (
    "https://muasamcong.mpi.gov.vn/"
    "o/egp-portal-contractor-selection-v2/services/smart/search"
)

payload = [
    {
        "pageSize": 10,
        "pageNumber": 0,
        "query": [
            {
                "index": "es-contractor-selection",
                "keyWord": "IB2600026487",
                "matchType": "exact",
                "matchFields": [
                    "notifyNo",
                    "bidName"
                ],
                "filters": [
                    {
                        "fieldName": "type",
                        "searchType": "in",
                        "fieldValues": [
                            "es-notify-contractor"
                        ]
                    }
                ]
            }
        ]
    }
]

headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Origin": "https://muasamcong.mpi.gov.vn",
    "Referer": "https://muasamcong.mpi.gov.vn/"
}

response = requests.post(
    URL,
    json=payload,
    headers=headers,
    timeout=30
)

response.raise_for_status()

data = response.json()

print(data)
```

Nếu request thực tế trên trình duyệt có thêm header, cookie, token hoặc tham số khác thì cần nghiên cứu đúng request mà browser gửi.

Không nên tìm cách vượt các cơ chế xác thực hoặc chống truy cập tự động.

---

# 7. Các ID quan trọng của một gói thầu

Sau khi tìm được gói thầu, nên kiểm tra và lưu các trường như:

```text
notifyNo
notifyId
bidOpenId
inputResultId
planNo
stepCode
processApply
```

Có thể hình dung:

```text
IBxxxxxxxxxx
       │
       ├── notifyId
       │      └── Thông báo mời thầu
       │
       ├── bidOpenId
       │      └── Biên bản mở thầu
       │
       ├── inputResultId
       │      └── Kết quả lựa chọn nhà thầu
       │
       └── planNo
              └── KHLCNT chứa gói thầu
```

Không nên mặc định:

```text
notifyId == bidOpenId == inputResultId
```

Đây thường là các ID phục vụ những đối tượng/nghiệp vụ khác nhau.

---

# 8. Lấy chi tiết TBMT

Một request từng được ghi nhận để lấy thông tin chính của TBMT có dạng:

```text
POST
/o/egp-portal-contractor-selection-v2/services/lcnt_tbmt_ttc_ldt
```

Body ví dụ:

```json
{
  "id": "<notifyId>"
}
```

---

## Ví dụ Python

```python
import requests

BASE = "https://muasamcong.mpi.gov.vn"

notify_id = "<NOTIFY_ID>"

url = (
    BASE
    + "/o/egp-portal-contractor-selection-v2/"
      "services/lcnt_tbmt_ttc_ldt"
)

response = requests.post(
    url,
    json={
        "id": notify_id
    },
    headers={
        "Content-Type": "application/json; charset=utf-8",
        "Origin": BASE,
        "Referer": BASE + "/"
    },
    timeout=30
)

response.raise_for_status()

detail = response.json()

print(detail)
```

`notify_id` phải lấy từ kết quả tìm kiếm hoặc từ request thực tế của portal.

---

# 9. Kế hoạch lựa chọn nhà thầu – KHLCNT

KHLCNT thường có mã dạng:

```text
PLxxxxxxxxxx
```

Trang chi tiết KHLCNT có thể chứa các tham số như:

```text
planNo=PL...
type=es-plan-project-p
stepCode=plan-step-1
```

Một KHLCNT có thể chứa các thông tin:

```text
Mã KHLCNT
Tên KHLCNT
Chủ đầu tư
Tên dự án / dự toán
Tổng mức đầu tư
Nguồn vốn
Số lượng gói thầu
```

Danh sách các gói thuộc kế hoạch có thể có:

```text
Tên gói thầu
Lĩnh vực
Giá gói thầu
Nguồn vốn
Hình thức lựa chọn nhà thầu
Phương thức lựa chọn nhà thầu
Thời gian bắt đầu LCNT
Loại hợp đồng
Thời gian thực hiện
Tình trạng TBMT
```

---

# 10. Cách xác định API lấy KHLCNT

Không nên đoán endpoint nếu chưa xác minh.

Thực hiện:

```text
DevTools
→ Network
→ Fetch/XHR
```

Sau đó tìm một mã:

```text
PL2600076058
```

Mở trang chi tiết KHLCNT.

Trong danh sách request, tìm các request chứa:

```text
plan
```

hoặc:

```text
khlcnt
```

hoặc:

```text
contractor-selection
```

hoặc:

```text
smart/search
```

Sau đó mở:

```text
Response
```

và tìm:

```text
PL2600076058
```

Nếu response chứa mã KHLCNT đang xem và dữ liệu kế hoạch tương ứng thì rất có thể đã xác định đúng request.

---

# 11. Cấu trúc tìm kiếm KHLCNT có thể nghiên cứu

Dữ liệu KHLCNT từng được portal thể hiện với loại dữ liệu dạng:

```text
es-plan-project-p
```

Trong khi TBMT có thể được thể hiện bằng:

```text
es-notify-contractor
```

Một body tìm kiếm KHLCNT **có thể** có logic tương tự:

```json
[
  {
    "pageSize": 10,
    "pageNumber": 0,
    "query": [
      {
        "index": "es-contractor-selection",
        "keyWord": "PL2600076058",
        "matchType": "exact",
        "matchFields": [
          "planNo"
        ],
        "filters": [
          {
            "fieldName": "type",
            "searchType": "in",
            "fieldValues": [
              "es-plan-project-p"
            ]
          }
        ]
      }
    ]
  }
]
```

> Quan trọng: Payload trên chỉ nên dùng để hiểu nguyên lý. Hãy xác nhận body thực tế bằng DevTools trước khi viết chương trình sử dụng lâu dài.

---

# 12. Quy trình nghiên cứu một KHLCNT hoàn chỉnh

Giả sử có:

```text
PL2600076058
```

Quy trình:

```text
1. Search PL2600076058
          ↓
2. Lấy thông tin KHLCNT
          ↓
3. Lấy danh sách các gói thầu
          ↓
4. Với mỗi gói, kiểm tra notifyNo
          ↓
5. Nếu có IB...
          ↓
6. Search TBMT
          ↓
7. Lấy notifyId
          ↓
8. Lấy chi tiết TBMT
          ↓
9. Nếu có bidOpenId
          ↓
10. Nghiên cứu request biên bản mở thầu
          ↓
11. Nếu có inputResultId
          ↓
12. Nghiên cứu request KQLCNT
```

Mô hình:

```text
KHLCNT
   │
   ├── Gói 01
   │       └── TBMT
   │              ├── HSMT
   │              ├── Biên bản mở thầu
   │              └── KQLCNT
   │
   ├── Gói 02
   │       └── TBMT
   │
   └── Gói 03
```

---

# 13. Thiết kế dữ liệu đề xuất

Nếu cần lưu vào database của một hệ thống quản lý đấu thầu, có thể tách:

## ProcurementPlan

```text
ProcurementPlan
│
├── planNo
├── name
├── investorName
├── projectName
├── investTotal
├── investmentFunds
├── publicDate
└── packages[]
```

## Package

```text
Package
│
├── planNo
├── packageName
├── packagePrice
├── bidField
├── bidForm
├── bidMode
├── contractType
├── implementationPeriod
└── notifyNo
```

## TenderNotice

```text
TenderNotice
│
├── notifyNo
├── notifyId
├── bidName
├── bidPrice
├── investorName
├── bidCloseDate
├── bidOpenDate
├── bidOpenId
└── inputResultId
```

---

# 14. Quan hệ dữ liệu đề xuất

```text
ProcurementPlan
       │
       │ 1:N
       ↓
Package
       │
       │ 0..1
       ↓
TenderNotice
       │
       ├───────── BidOpening
       │
       └───────── SelectionResult
                         │
                         ↓
                      Contract
```

---

# 15. Lưu raw JSON khi nghiên cứu

Trong giai đoạn đầu, không nên chỉ map ngay một số trường vào database.

Nên lưu cả response gốc:

```python
import json

with open(
    "raw_response.json",
    "w",
    encoding="utf-8"
) as f:
    json.dump(
        data,
        f,
        ensure_ascii=False,
        indent=2
    )
```

Lợi ích:

- Phân tích schema
- Tìm trường mới
- So sánh dữ liệu theo thời gian
- Debug khi portal thay đổi
- Viết parser mà không phải gọi website liên tục

---

# 16. In toàn bộ key của JSON để nghiên cứu

Có thể dùng:

```python
def print_keys(obj, prefix=""):
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else key
            print(path)
            print_keys(value, path)

    elif isinstance(obj, list):
        for item in obj[:1]:
            print_keys(item, prefix)


print_keys(data)
```

Ví dụ output:

```text
data
data.content
data.content.notifyNo
data.content.notifyId
data.content.planNo
data.content.bidName
...
```

Cách này giúp khám phá schema nhanh.

---

# 17. Chuyển cURL sang Python

Sau khi dùng:

```text
Copy as cURL
```

Có thể tự chuyển về cấu trúc:

```python
import requests

url = "..."

headers = {
    ...
}

payload = {
    ...
}

response = requests.post(
    url,
    headers=headers,
    json=payload
)

print(response.json())
```

Nên loại bỏ các header không cần thiết thay vì copy tất cả header trình duyệt vào source code.

Đặc biệt không commit:

```text
Cookie
Authorization
Token
Session ID
```

vào Git.

---

# 18. Pagination

Nếu endpoint sử dụng:

```json
{
  "pageSize": 20,
  "pageNumber": 0
}
```

thì có thể duyệt:

```python
page = 0

while True:
    payload[0]["pageNumber"] = page

    response = requests.post(
        URL,
        json=payload,
        headers=headers,
        timeout=30
    )

    data = response.json()

    # Parse danh sách kết quả tại đây.

    if not has_more(data):
        break

    page += 1
```

Không nên gửi request quá nhanh.

Có thể chèn delay hợp lý:

```python
import time

time.sleep(1)
```

---

# 19. Retry hợp lý

Ví dụ:

```python
import time
import requests

def request_with_retry(url, payload, headers):
    for attempt in range(3):
        try:
            r = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=30
            )

            r.raise_for_status()

            return r

        except requests.RequestException:
            if attempt == 2:
                raise

            time.sleep(2 ** attempt)
```

Không nên dùng retry vô hạn.

Nếu hệ thống trả lỗi giới hạn truy cập hoặc yêu cầu xác thực, nên dừng và xem lại điều kiện sử dụng thay vì cố vượt giới hạn.

---

# 20. User-Agent

Nếu cần, có thể đặt User-Agent rõ ràng:

```python
headers = {
    "User-Agent": (
        "Mozilla/5.0 research-client "
        "(public procurement data research)"
    ),
    "Content-Type": "application/json",
    "Origin": "https://muasamcong.mpi.gov.vn",
    "Referer": "https://muasamcong.mpi.gov.vn/"
}
```

Không nên giả mạo nhiều IP/User-Agent để né hạn chế của website.

---

# 21. Logging

Nên ghi log:

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)
```

Ví dụ:

```python
logging.info(
    "Fetching plan %s",
    plan_no
)
```

---

# 22. Cache dữ liệu

Nếu cùng một KHLCNT được tra cứu nhiều lần, nên cache.

Ví dụ:

```text
cache/
   PL2600076058.json
   IB2600026487.json
```

Có thể đặt TTL:

```text
6 giờ
12 giờ
24 giờ
```

tùy mục đích.

Điều này giúp:

- giảm request
- tăng tốc
- giảm tải cho website
- dễ debug

---

# 23. Kiến trúc crawler/research client đề xuất

```text
muasamcong/
│
├── client.py
│
├── search.py
│
├── plans.py
│
├── tenders.py
│
├── bid_opening.py
│
├── selection_result.py
│
├── models.py
│
├── parser.py
│
├── cache.py
│
└── cli.py
```

Ví dụ:

```text
client.py
    HTTP client chung

search.py
    smart/search

plans.py
    KHLCNT

tenders.py
    TBMT

bid_opening.py
    Biên bản mở thầu

selection_result.py
    KQLCNT

parser.py
    Parse JSON

models.py
    Data model

cache.py
    Cache raw JSON
```

---

# 24. CLI đề xuất

Mục tiêu có thể xây:

```bash
python muasamcong.py PL2600076058
```

Output:

```text
KHLCNT: PL2600076058

├── Gói 01
│   ├── Tên: ...
│   ├── Giá: ...
│   └── TBMT: IB...
│
├── Gói 02
│   ├── Tên: ...
│   └── TBMT: IB...
│
└── Gói 03
```

Hoặc:

```bash
python muasamcong.py IB2600026487
```

Output:

```text
TBMT
│
├── notifyNo
├── bidName
├── investorName
├── bidPrice
├── bidCloseDate
├── bidOpenDate
├── bidOpenId
└── inputResultId
```

---

# 25. Có thể xuất JSON

Ví dụ:

```bash
python muasamcong.py \
    PL2600076058 \
    --output json
```

Kết quả:

```text
output/
└── PL2600076058.json
```

---

# 26. Có thể xuất Excel

Ví dụ:

```bash
python muasamcong.py \
    PL2600076058 \
    --output excel
```

Các sheet:

```text
Plan
Packages
TenderNotices
BidOpening
SelectionResults
```

---

# 27. Đồng bộ vào ứng dụng nội bộ

Nếu tích hợp vào hệ thống quản lý đấu thầu, không nên để frontend gọi trực tiếp portal.

Nên dùng:

```text
Frontend
    ↓
Backend của ứng dụng
    ↓
MuasamcongClient
    ↓
muasamcong.mpi.gov.vn
```

Backend thực hiện:

```text
cache
rate-limit nội bộ
normalize dữ liệu
logging
error handling
permission check
```

---

# 28. Không nên phụ thuộc trực tiếp vào schema bên ngoài

Không nên để toàn bộ code nghiệp vụ sử dụng trực tiếp JSON của portal:

```python
data["foo"]["bar"]["notifyNo"]
```

ở khắp ứng dụng.

Nên normalize:

```python
class TenderNotice:
    notify_no: str
    notify_id: str
    plan_no: str
    bid_name: str
```

Sau đó:

```text
Portal JSON
    ↓
Adapter / Parser
    ↓
Internal Model
    ↓
Application
```

Nếu portal đổi schema thì chỉ cần sửa Adapter.

---

# 29. Xử lý khi API thay đổi

Nếu một ngày chương trình lỗi:

```text
404
400
500
JSON schema changed
```

thì quay lại:

```text
Chrome
→ DevTools
→ Network
→ Fetch/XHR
```

Thực hiện thao tác tương tự trên website và so sánh:

```text
URL cũ vs URL mới

Payload cũ vs Payload mới

Response cũ vs Response mới
```

Đây là lý do không nên xem endpoint nghiên cứu được như API chính thức bất biến.

---

# 30. Những việc không nên làm

Không nên:

```text
❌ vượt CAPTCHA

❌ bypass OTP

❌ sử dụng tài khoản người khác

❌ cố truy cập endpoint không được phép

❌ khai thác lỗ hổng

❌ gửi request với tốc độ gây tải cho hệ thống

❌ xoay proxy/IP để né rate limit

❌ giả lập hàng nghìn session để vượt giới hạn

❌ thu thập dữ liệu không công khai
```

---

# 31. Những việc phù hợp cho mục đích nghiên cứu

Có thể:

```text
✓ quan sát request do chính browser gửi

✓ nghiên cứu dữ liệu công khai

✓ dùng DevTools

✓ Copy as cURL

✓ viết Python tái hiện request công khai

✓ cache dữ liệu

✓ rate-limit request

✓ normalize JSON

✓ lưu dữ liệu phục vụ nghiên cứu nội bộ

✓ phân tích quan hệ KHLCNT → gói thầu → TBMT
```

---

# 32. Luồng dữ liệu tổng thể nên hướng tới

```text
KHLCNT
   ↓
Danh sách gói thầu
   ↓
TBMT
   ↓
Thông tin HSMT
   ↓
Biên bản mở thầu
   ↓
Danh sách nhà thầu
   ↓
KQLCNT
   ↓
Nhà thầu trúng thầu
   ↓
Giá trúng thầu
   ↓
Hợp đồng
```

---

# 33. Lộ trình nghiên cứu đề xuất

## Giai đoạn 1

Làm được:

```text
PL → thông tin KHLCNT
```

## Giai đoạn 2

Làm được:

```text
PL → danh sách packages
```

## Giai đoạn 3

Làm được:

```text
PL
 ↓
Package
 ↓
IB
```

## Giai đoạn 4

Làm được:

```text
IB
 ↓
TBMT detail
```

## Giai đoạn 5

Nghiên cứu tiếp:

```text
IB
 ├── Bid Opening
 ├── Contractors
 └── Selection Result
```

## Giai đoạn 6

Đồng bộ vào database.

---

# 34. Kết luận

Nguyên tắc quan trọng nhất là:

```text
Đừng đoán API.
Hãy quan sát API mà chính website đang sử dụng.
```

Quy trình:

```text
Browser
   ↓
DevTools
   ↓
Network
   ↓
Fetch/XHR
   ↓
Request
   ↓
Response JSON
   ↓
Copy as cURL
   ↓
Python
   ↓
Parser
   ↓
Database
```

Đối với KHLCNT:

```text
PL...
```

Đối với TBMT/gói thầu:

```text
IB...
```

Sau khi xác định được các ID liên kết, có thể xây dựng quan hệ:

```text
PL
 ↓
Package
 ↓
IB
 ↓
notifyId
 ↓
bidOpenId
 ↓
inputResultId
```

Từ đó từng bước xây một module nghiên cứu/đồng bộ dữ liệu công khai từ Hệ thống mạng đấu thầu quốc gia.

---

## Tài liệu tham khảo để tự kiểm chứng

- Hệ thống mạng đấu thầu quốc gia:
  - https://muasamcong.mpi.gov.vn/

- Khi nghiên cứu endpoint không có tài liệu API chính thức, luôn ưu tiên kiểm chứng lại bằng:
  - Chrome DevTools
  - Network
  - Fetch/XHR
  - Copy as cURL

---

**Phiên bản tài liệu:** 2026-08-11

**Mục đích:** Nghiên cứu kỹ thuật và dữ liệu công khai.
