# Runbook: nâng cấp database qua schema v49–v62

Runbook này áp dụng cho database có `schema_version < 62`. Các migration lịch
sử đã phát hành là bất biến: **không sửa migration v61**, không hạ tay
`database_metadata.schema_version` và không chạy SQL đổi tên tenant hàng loạt.

## 1. Điều kiện bắt buộc trước maintenance

1. Chặn write traffic và đưa hệ thống vào maintenance; dừng web/worker có thể ghi.
2. Tạo backup, verify checksum và diễn tập restore vào database cách ly.
3. Ghi lại schema version, release SHA, row cardinality và cấu hình timeout.
4. Dùng đúng migrator credential; không dùng web runtime credential.
5. Đặt ngân sách khóa/thời gian theo rehearsal staging, ví dụ:

   ```bash
   export DATABASE_STATEMENT_TIMEOUT_MS=300000
   export DATABASE_LOCK_TIMEOUT_MS=5000
   ```

## 2. Read-only preflight

Chạy trước trên production và lưu JSON output vào change record:

```bash
python scripts/manage_database.py --preflight
```

Đối chiếu các trường:

- `v49ToV62Operational`: danh sách version, yêu cầu transactional dry-run và lock budget.
- `v50BindingSnapshotUniqueness`: `duplicateGroups` phải bằng `0` trước khi tạo unique constraint.
- `v54ObservationUniqueness`: cả hai nhóm duplicate phải bằng `0`.
- `v59WebsocketDispatchRewrite`: dùng `deliveredRowsToRewrite` và `relationBytes`
  để ước lượng thời gian rewrite/lock.
- `v60SyncedDeleteSnapshot`: phải rehearsal trigger function và rollback.
- `v61DefaultWorkspaceRename`: chỉ trả cardinality ứng viên, không trả tenant ID
  và không mutation.
- `v62AiMessageIdempotency`: dành lock/index build budget cho bảng `ai_messages`.

Nếu `requiresDataRepair=true`, dừng rollout. Repair plan phải được review riêng,
không sửa expected test hoặc unique constraint để ép migration chạy.

## 3. Gate bắt buộc riêng cho v61

`v61DefaultWorkspaceRename.automaticRemediationAllowed` luôn phải là `false`.
Nếu `candidateOrganizations > 0` hoặc `requiresApprovedTenantMapping=true`:

1. dừng trước khi chạy migration chain qua v61;
2. lấy mapping tenant chính xác từ chủ sản phẩm và backup đã verify;
3. xác nhận tenant nào thực sự là default workspace lịch sử;
4. lập change record/ADR cho remediation dữ liệu nếu migration đã từng chạy.

Không tự động đổi toàn bộ `HCP` về `HTD`, không tự động đổi toàn bộ `HTD` sang
`HCP`, và không suy luận identity tenant từ tên hiển thị. Nếu không có mapping
được phê duyệt, đây là blocker riêng của v61; không được dùng blocker này để đổi
role, scope, masking hoặc dữ liệu người dùng được phép xem.

## 4. Transactional dry-run và rehearsal

Chạy trên bản restore có cardinality tương đương production:

```bash
python scripts/manage_database.py --dry-run
```

Dry-run phải rollback toàn bộ. Ghi thời gian từng migration và kiểm tra:

- v49 tạo provenance tables/triggers/FK đầy đủ;
- v50/v54 unique constraints không gặp collision;
- v55 session indexes và v56/v57 FK catalog khớp fresh schema;
- v58 document job policy columns có default/check đúng;
- v59 chỉ rewrite `delivered → dispatched`, không làm mất event;
- v60 trigger function snapshot-aware được cài và test delete fixture;
- v61 chỉ được đi qua khi mapping gate ở trên đã được phê duyệt;
- v62 unique partial index được tạo và retry message idempotent.

Rehearsal rollback gồm: hủy transaction dry-run, restore backup sang database
mới, chạy catalog/FK contract, smoke login/read-only/Word export/websocket/AI.

## 5. Thực thi và hậu kiểm

Sau khi mọi gate xanh:

```bash
python scripts/backup.py create
python scripts/backup.py verify --snapshot <snapshot>
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
```

Hậu kiểm:

- `database_metadata.schema_version = 62`;
- preflight chạy lại báo `upgradeRequired=false`;
- fresh schema và upgraded schema contract giống nhau;
- không có duplicate ở target keys v50/v54/v62;
- websocket event cardinality được bảo toàn;
- tenant name/ID khớp mapping đã duyệt, không kiểm tra bằng tên mặc định chung;
- targeted migration, session, authorization và audit tests xanh.

## 6. Rollback

Không chạy DDL ngược ad-hoc. Nếu application rollback vẫn tương thích schema,
rollback release và giữ schema. Nếu migration/data không tương thích:

1. tiếp tục cô lập write traffic;
2. lưu forensic snapshot database lỗi;
3. restore backup đã verify vào database mới;
4. smoke test rồi mới chuyển traffic;
5. giữ database lỗi để điều tra.

Không dùng rollback như lý do tự sửa migration lịch sử hoặc tự suy đoán mapping v61.
