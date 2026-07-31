# Production deployment and rollback

Public production packaging is blocked until every fact in
`docs/legal-fact-sheet.md` is approved and the corresponding placeholder in
`views/legal/` is replaced with reviewed copy. Verify this explicitly with
`npm run check:legal:production`; local development uses the warning-only
`npm run check:legal` command.

Đây là checklist trung lập với nhà cung cấp. Secret và file environment thật phải nằm ngoài release artifact, owner `root`, mode `0600`.

## Preflight

1. Xác nhận artifact SHA-256/`PRODUCTION_MANIFEST.json` và release ID.
2. Chạy dependency/secret scan, full test, fresh DB, upgrade và restore drill.
3. Verify `APP_PUBLIC_URL` HTTPS exact-origin, trusted proxy/host allowlist và cookie secure.
4. Verify PostgreSQL backup có thể restore; ghi checkpoint migration.
5. Verify document worker service account, DB role và Linux sandbox.

## Deploy

```bash
python scripts/backup.py create
python scripts/backup.py verify --snapshot <snapshot>
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
unzip biddingflow-production.zip -d /opt/biddingflow/releases/<release-id>
python scripts/verify_document_sandbox.py
systemctl restart biddingflow-document-worker
systemctl restart biddingflow
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
```

Reverse proxy chỉ chuyển traffic sau khi live/ready và smoke login/read-only đạt. Uvicorn dùng `--no-proxy-headers`; middleware chỉ nhận proxy metadata từ peer đã allowlist.

## Rollback

Nếu code mới lỗi nhưng schema còn tương thích, chuyển traffic/symlink về release trước và restart worker/web. Không tự giảm `database_metadata.schema_version` và không chạy DDL ngược ad-hoc.

Nếu migration làm thay đổi dữ liệu không tương thích:

1. Cô lập write traffic.
2. Lưu forensic snapshot hiện tại.
3. Restore backup đã verify vào database mới/cách ly.
4. Chuyển credential/traffic sang database restore sau smoke test.
5. Giữ database lỗi để điều tra; không overwrite backup.

Migration v28 chỉ drop `nguoi_cham_id` ở ba bảng đánh giá sau preflight `IS NOT NULL = 0`; rollback dữ liệu là restore backup, còn rollback code có thể dùng release trước nếu không ghi schema cũ.

## Runtime boundaries

- Web role: CRUD cần thiết, không DDL/role management.
- Migrator role: chỉ dùng trong deploy step, không có trong web environment.
- Document worker role: chỉ queue/document objects cần thiết.
- PostgreSQL, metrics và admin endpoints: private network/VPN.
- User upload, media, log, cache và temp: volume ngoài release package.
