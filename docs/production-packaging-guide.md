# Hướng dẫn đóng gói BiddingFlow cho production

Tài liệu này mô tả quy trình tạo production artifact từ source repository. Artifact
được tạo bởi allowlist trong `scripts/package_production.py`; không tự sao chép toàn bộ
working tree lên máy chủ.

## 1. Kết quả đầu ra

Lệnh đóng gói chính thức:

```powershell
npm run package:production
```

Artifact được tạo tại:

```text
release/biddingflow-production.zip
```

ZIP chứa backend, secure frontend build, runtime views/assets, cấu hình deploy, migration
và các script vận hành được allowlist. ZIP không chứa `.env`, secret, `node_modules`, source
frontend, test, cache, database, upload, log, backup hoặc source map.

## 2. Yêu cầu môi trường build

- Python đúng phiên bản trong `.python-version` — hiện là Python 3.14.
- Node.js 24 và npm tương thích với `package-lock.json`.
- Dependency Python từ `pyproject.toml`/`requirements.txt`.
- Dependency Node từ `package-lock.json`.
- PostgreSQL test cô lập cho full test và extracted-package smoke.
- Không sử dụng database production để build hoặc smoke test.

Kiểm tra phiên bản:

```powershell
python --version
node --version
npm --version
```

## 3. Điều kiện pháp lý bắt buộc

Public production package bị chặn nếu thông tin pháp lý chưa được duyệt. Trước khi build:

1. Điền [`legal-fact-sheet.md`](legal-fact-sheet.md) bằng dữ liệu thật.
2. Mỗi dòng `LEGAL-xx` phải có bằng chứng, ngày duyệt, người duyệt và trạng thái
   `approved`.
3. Thay toàn bộ `<span class="legal-placeholder">[TODO: ...]</span>` trong:
   - `views/legal/terms.html`;
   - `views/legal/privacy.html`;
   - `views/legal/security.html`.

Kiểm tra gate:

```powershell
npm run check:legal:production
```

Không đổi trạng thái thành `approved` khi chưa có phê duyệt thật và không chạy trực tiếp
packager để né legal gate.

## 4. Cài dependency sạch

Trong repository:

```powershell
python -m pip install -e ".[test]"
npm ci
```

`npm ci` dùng đúng lockfile và không thay đổi phiên bản dependency. Không commit `.env`,
`node_modules` hoặc artifact được sinh ra.

### Browser worker Mua Sắm Công (khi bật)

Production ZIP chứa các file `.mjs`, `package.json` và `package-lock.json`, nhưng vẫn không nhúng
`node_modules` hay browser binary. Trên image/runtime được phép dùng browser lookup, cài dependency
production và Chromium theo đúng lockfile/version:

```powershell
npm ci --omit=dev
npx playwright install chromium
```

Browser binary phải được bake vào image bất biến và chạy bằng service account không đặc quyền vì
lookup/import mặc định bật mà không cần environment flag. Xác minh binary, exact-host allowlist,
live probe và benchmark trước khi phát hành. Rollback khẩn cấp bằng
`PROCUREMENT_LOOKUP_ENABLED=false` và `PROCUREMENT_IMPORT_ENABLED=false`.
Không thêm `--no-sandbox`, `--disable-web-security`,
cookie/token tĩnh hoặc cơ chế giải/né challenge vào image.

## 5. Cấu hình database smoke cô lập

`npm run check` và `scripts/package_production.py --check` cần một PostgreSQL database có
tên thể hiện rõ mục đích test/smoke. Ví dụ chỉ minh họa:

```powershell
$env:TEST_DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:5432/biddingflow_unit_test"
$env:PACKAGE_SMOKE_DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:5432/biddingflow_package_smoke_test"
```

Không ghi URL thật vào tài liệu, Git hoặc console log. Database smoke có thể bị reset schema;
tuyệt đối không trỏ biến này vào database production.

## 6. Chạy quality gate đầy đủ

```powershell
npm run check
npm run audit:dependencies
```

`npm run check` bao gồm compile, Python/Node tests, lint, secure build, FK-index audit,
extracted-package smoke và SBOM. Nếu runner giới hạn thời gian, chạy từng gate để lấy log
riêng nhưng không bỏ qua gate nào:

```powershell
npm run check:quality
npm run build:secure
python scripts/audit_fk_indexes.py
python scripts/package_production.py --check
npm run sbom
npm run audit:dependencies
```

`npm run check:quality` giữ nguyên các kiểm tra coverage và critical coverage của dự án;
không thay nó bằng một lệnh `pytest` rút gọn khi xác nhận release.

## 7. Tạo production artifact

Sau khi mọi gate đều pass:

```powershell
npm run package:production
```

Không dùng lệnh sau như cách thay thế cho production gate:

```text
python scripts/package_production.py
```

Lệnh Python trực tiếp chỉ là implementation bên dưới; nó không chạy legal gate và secure
build theo chuỗi chính thức.

## 8. Kiểm tra artifact

Tính checksum SHA-256:

```powershell
Get-FileHash .\release\biddingflow-production.zip -Algorithm SHA256
```

Kiểm tra ZIP có manifest:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(
    (Resolve-Path .\release\biddingflow-production.zip)
)
try {
    $manifest = $zip.Entries | Where-Object FullName -eq "PRODUCTION_MANIFEST.json"
    if (-not $manifest) { throw "PRODUCTION_MANIFEST.json is missing" }
    $manifest | Select-Object FullName, Length
} finally {
    $zip.Dispose()
}
```

Kiểm tra artifact không chứa dữ liệu cấm:

```powershell
$forbidden = @(
    ".env",
    "node_modules/",
    "frontend/",
    "tests/",
    "data/"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(
    (Resolve-Path .\release\biddingflow-production.zip)
)
try {
    $names = $zip.Entries.FullName
    foreach ($prefix in $forbidden) {
        if ($names | Where-Object { $_ -eq $prefix -or $_.StartsWith($prefix) }) {
            throw "Forbidden production path found: $prefix"
        }
    }
} finally {
    $zip.Dispose()
}
```

Packager cũng tự kiểm tra manifest hash, content-hashed frontend asset, source map, đường dẫn
thoát ZIP và smoke runtime sau giải nén.

## 9. Chuyển artifact lên VPS

```powershell
scp .\release\biddingflow-production.zip root@IP_VPS:/tmp/
```

Nên lưu checksum cùng release để đối chiếu trên VPS:

```powershell
Get-FileHash .\release\biddingflow-production.zip -Algorithm SHA256 |
    Format-List
```

Trên VPS:

```bash
sha256sum /tmp/biddingflow-production.zip
```

Sau khi checksum trùng khớp, triển khai theo [`deploy/README.md`](../deploy/README.md).
Environment production
phải nằm ngoài release artifact, owner `root`, mode `0600`.

## 10. Lỗi thường gặp

### `LEGAL_READINESS_BLOCKED`

`docs/legal-fact-sheet.md` còn dòng chưa `approved` hoặc `views/legal/` vẫn có placeholder.
Không bỏ gate; hoàn tất phê duyệt và nội dung công khai.

### `Secure frontend marker is missing`

Chạy lại:

```powershell
npm run build:secure
```

### `PACKAGE_SMOKE_DATABASE_URL must reference an isolated PostgreSQL test database`

Đặt URL tới database riêng có `test` hoặc `smoke` trong tên database. Không dùng production.

### PostgreSQL timeout

Kiểm tra PostgreSQL đang chạy, host/port reachable và credential chỉ dành cho test. Không
thay đổi packager để bỏ extracted-runtime smoke.

### Manifest hoặc frontend asset không hợp lệ

Xóa `dist` cũ, chạy lại secure build rồi package:

```powershell
npm run build:secure
npm run package:production
```

## 11. Checklist phát hành

- [ ] Legal fact sheet và public legal copy đã được duyệt.
- [ ] Working tree không chứa thay đổi ngoài phạm vi release.
- [ ] Python/Node versions đúng yêu cầu.
- [ ] `npm ci` và cài Python dependency thành công.
- [ ] Full test, lint, audit và secure build pass.
- [ ] Fresh database/migration pass trên PostgreSQL cô lập.
- [ ] Extracted-package smoke pass.
- [ ] Production ZIP có manifest và không chứa secret/source map.
- [ ] SHA-256 đã được ghi lại và đối chiếu trên VPS.
- [ ] Backup/restore drill và rollback plan đã được xác minh trước khi chuyển traffic.
