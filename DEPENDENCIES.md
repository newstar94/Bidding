# Quản lý dependency và chuỗi cung ứng

## Python

Python chuẩn của dự án được ghi tại `.python-version`; dependency trực tiếp tách thành runtime và `dev` trong `pyproject.toml`. Hai lockfile trong `requirements/` pin toàn bộ dependency bắc cầu và SHA-256 của các bản phân phối.

Cài môi trường production sạch:

```bash
python -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements/runtime.lock.txt
```

Môi trường phát triển/CI dùng `requirements/dev.lock.txt`. Trên Windows thay `.venv/bin/python` bằng `.venv\Scripts\python.exe`.

Khi cập nhật dependency trực tiếp, sửa `pyproject.toml`, đọc changelog/security advisory rồi tạo lại cả hai lockfile bằng đúng Python trong `.python-version`:

```bash
pip-compile pyproject.toml --generate-hashes --strip-extras --output-file requirements/runtime.lock.txt
pip-compile pyproject.toml --extra dev --generate-hashes --strip-extras --allow-unsafe --output-file requirements/dev.lock.txt
```

Không sửa tay lockfile. Chạy cài đặt sạch, toàn bộ test và `npm run audit:python` trước khi nhận lock mới.

## npm

Mọi dependency trực tiếp được pin chính xác trong `package.json`; `package-lock.json` khóa dependency bắc cầu và integrity hash. Máy mới luôn dùng `npm ci`, không dùng `npm install` trong CI. Chạy `npm run audit:npm` và xem xét install script mới trước khi cập nhật lock.

## JavaScript/font vendored

`views/vendor/vendor-manifest.json` là nguồn chuẩn cho tên, phiên bản, nguồn tải, giấy phép và SHA-256. `npm run audit:vendor` từ chối file bị thay đổi hoặc file bên thứ ba chưa được kiểm kê, sau đó chạy Retire.js.

Quy trình cập nhật XLSX/Lucide/Flatpickr/font:

1. chỉ lấy từ `source`/`updateSource` chính thức trong manifest;
2. kiểm tra license và security advisory của phiên bản mới;
3. thay asset, xác nhận version nhúng trong file và cập nhật SHA-256 trong manifest;
4. chạy `npm run audit:vendor`, unit/API/E2E liên quan và production build;
5. tạo lại SBOM bằng `npm run sbom` và review diff thành phần.

SheetJS hiện được kiểm kê ở bản 0.18.5. Nguồn cập nhật có thẩm quyền là SheetJS CDN/documentation, không phải bản npm mirror; nâng phiên bản cần chạy regression import Excel trên trình duyệt trước khi phát hành.

## Audit, secret scan và SBOM

Sau khi cài dev lock:

```bash
npm ci
npm run audit:dependencies
npm run sbom
```

SBOM CycloneDX cho Python runtime, npm và asset vendored được đặt trong `sbom/`. Secret scan loại trừ lock/generated/vendor/test fixture, nhưng quét code, cấu hình deployment và tài liệu do dự án duy trì. Chỉ dùng `pragma: allowlist secret` cho dữ liệu giả đã được review.
