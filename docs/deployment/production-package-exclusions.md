# Danh sách loại trừ khi đóng gói sản phẩm BiddingFlow

Tài liệu này dùng để tạo gói triển khai sạch cho máy chủ hoặc khách hàng. Các
thành phần bị loại khỏi gói vẫn có thể được giữ trong kho mã nguồn để phát
triển, kiểm thử và bảo trì.

## 1. Thành phần tối thiểu để ứng dụng chạy

- `backend/`: mã nguồn dịch vụ Python.
- `dist/`: giao diện đã được tạo bằng `npm run build:secure`.
- `views/`: HTML, CSS, phông chữ và thư viện giao diện tĩnh.
- `holidays.json`: dữ liệu ngày nghỉ dùng khi tính thời hạn.
- Các thư viện Python đã cài từ `requirements.txt`.
- Thư mục dữ liệu rỗng hoặc ổ lưu trữ riêng được cấu hình bằng
  `BIDDING_DATA_DIR`.

Nếu triển khai đầy đủ dịch vụ tạo tài liệu, migration và sao lưu thì giữ thêm:

- `scripts/env_utils.py`
- `scripts/manage_database.py`
- `scripts/run_document_worker.py`
- `scripts/verify_document_sandbox.py`
- `scripts/backup.py`

## 2. Thành phần phục vụ cài đặt và vận hành

Các thành phần sau không được tiến trình web đọc trực tiếp, nhưng nên có trong
gói triển khai đầy đủ hoặc một gói vận hành riêng:

- `.env.example`
- `.python-version`
- `README.md`
- `requirements.txt`
- `pyproject.toml`
- `deploy/`
- `scripts/configure_database_roles.py`
- `scripts/verify_document_worker_deployment.py`
- `scripts/benchmark_password_hash.py`

Không thay `.env.example` bằng file `.env` thật.

## 3. Công cụ AI và skill phải loại trừ

- `.agents/`
- `.claude/`
- `.codex/`
- `.hallmark/`
- `agent/`
- `AGENTS.md`
- `skills-lock.json`
- Mọi file `SKILL.md`, `agents/openai.yaml` và tài nguyên nằm trong skill.

Những file này chỉ hướng dẫn công cụ hỗ trợ lập trình, không được frontend,
backend, PostgreSQL hoặc bộ tạo Word/Excel sử dụng.

## 4. Mã nguồn và công cụ chỉ dùng để xây dựng

Sau khi đã tạo `dist/`, loại khỏi gói chạy thật:

- `frontend/`
- `node_modules/`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `eslint.config.js`
- `scripts/package_production.py`

Máy dùng để tạo bản phát hành vẫn phải giữ các thành phần này.

## 5. Kiểm thử, kiểm tra chất lượng và tài liệu nội bộ

- `tests/`
- `requirements-ci.in`
- `requirements-ci.txt`
- `security/`
- `docs/agents/`
- `docs/plans/`
- `docs/research/`
- `docs/reviews/`
- `.github/` nếu chỉ phát hành gói chạy thật.
- `.pytest_cache/`
- `.mypy_cache/`
- `.ruff_cache/`
- `.hypothesis/`
- `coverage/`
- `htmlcov/`
- `test-results/`
- `playwright-report/`
- `blob-report/`

SBOM, báo cáo coverage và checksum có thể phát hành trong một gói bằng chứng
riêng, không trộn vào gói chạy ứng dụng.

## 6. Dữ liệu cục bộ và dữ liệu nhạy cảm tuyệt đối không đóng gói

- `.env`
- `.vscode/`
- `data/postgresql*/`
- `data/tools/`
- `data/logs/`
- `data/backups/`
- `data/audit-checkpoints/`
- `data/document-worker-temp/`
- `data/skills/`
- `data/templates/` đang chứa dữ liệu hoặc biểu mẫu của người dùng.
- Cơ sở dữ liệu, bản sao lưu, nhật ký và khóa cục bộ.

Không đóng gói các đuôi file:

- `*.db`, `*.sqlite`, `*.sqlite3`
- `*.bak`
- `*.log`
- `*.tmp`, `*.temp`
- `*.pyc`
- `*.map`
- `*.pid`, `*.pid.lock`

Biểu mẫu Word mặc định, nếu cần phát hành, phải được duyệt riêng và đưa vào
một thư mục tài nguyên chỉ đọc; không lấy nguyên thư mục biểu mẫu đang sử dụng
của người dùng.

## 7. Metadata kho mã nguồn và file tạm

- `.git/`
- `.gitignore`
- `CONTEXT.md`
- `design.md`
- `__pycache__/`
- `.vite/` ngoài kết quả nằm trong `dist/`.
- `release/` cũ.
- File tạm của hệ điều hành hoặc trình soạn thảo như `.DS_Store`,
  `Thumbs.db`, `Desktop.ini`, `*.swp`, `*.swo`.

## 8. Kiểm tra trước khi phát hành

1. Không nén trực tiếp toàn bộ thư mục dự án.
2. Chạy `npm run package:production` để tạo giao diện an toàn và gói từ danh
   sách cho phép.
3. Xác nhận gói có `dist/secure-build.json`.
4. Xác nhận gói không có `.env`, dữ liệu PostgreSQL, log, source map, test,
   frontend nguồn hoặc thư mục skill.
5. Giải nén gói vào thư mục sạch và chạy kiểm tra khởi động.
6. Phát hành SBOM và checksum ở gói bằng chứng riêng nếu cần.

