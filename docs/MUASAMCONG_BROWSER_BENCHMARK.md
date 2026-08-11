# Benchmark Mua Sắm Công browser adapter

Ngày cập nhật: 2026-08-11

## Trạng thái

**Fixture benchmark: PASS. Live benchmark: REVIEW.**

Phiên làm việc chưa có server browser hoàn tất được TLS handshake tới target và chưa có bộ 50–100 mã operator-supplied, vì vậy chưa có số liệu live cold/warm/cache và không được dùng số liệu fixture để tuyên bố đạt target production.

Đã lọc và validate local `43` mã canonical duy nhất có provenance từ ZIP/tài liệu/manual-live do operator cung cấp (`21` PL, `22` IB). Input nằm trong `.codex-tmp/muasamcong_operator_candidates.json`, bị Git ignore để không commit danh sách nghiệp vụ. Còn thiếu `7` mã thật trước khi CLI cho phép chạy live benchmark; revision suffix và placeholder `IB0123456789` đã bị loại.

## Harness

Harness tại `scripts/benchmark_muasamcong.py`:

- chỉ nhận 1–100 mã có sẵn trong file input;
- live mode bắt buộc 50–100 mã duy nhất do người vận hành cung cấp;
- không sinh/enumerate PL/IB, không pagination và không retry loop;
- chạy ba pha: browser cold riêng từng mã, browser warm dùng chung, rồi cache hit;
- phân loại success, not-found, interaction-required, timeout, schema-error và upstream-error;
- báo driver, extractor, browser mode, p50/p95, interaction-required rate và schema-error rate.

Fixture verification:

```powershell
python scripts/benchmark_muasamcong.py `
  --input tests/fixtures/muasamcong/benchmark_sample.json `
  --fixtures
```

Kết quả lần kiểm chứng cục bộ ngày 2026-08-11:

- 7 fixture, 21 lượt đo qua ba pha;
- 15 success, 3 not-found, 3 schema-error;
- driver trong các lượt thành công: Vue2 40%, Generic 60%;
- extractor: network 60%, Vue state 20%, semantic DOM 20%;
- mọi fixture hợp lệ trả đúng stable DTO; not-found và schema-changed fail closed.

Các latency dưới millisecond của fixture chỉ đo Python parser/cache trên dữ liệu local, không phản ánh network hay Chromium và không được so với target live.

## Chạy live được cấp phép

Input JSON gồm 50–100 mã duy nhất:

```json
[
  {"code": "PL2600000001", "category": "plan-normal"},
  {"code": "IB2600000002", "category": "package-open"}
]
```

Chạy trong development/staging đã cài Chromium:

```powershell
$env:PROCUREMENT_LOOKUP_ENABLED='true'
python scripts/benchmark_muasamcong.py `
  --input D:\authorized-data\muasamcong-benchmark.json `
  --live `
  --output D:\authorized-data\muasamcong-benchmark-report.json
```

Không đưa file mã thật hoặc report có dữ liệu nghiệp vụ vào Git nếu chưa được duyệt.

## Target chưa được xác nhận

```text
Cache p95 < 200 ms
Warm browser p50 < 3 s
Warm browser p95 < 7 s
Cold browser p95 < 10 s
Extraction p95 < 100 ms
```

Chỉ chuyển target thành kết quả PASS sau khi report live có đủ 50–100 mẫu và selector/framework live đã được xác minh.
