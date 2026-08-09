# Runbook: organization decommission

Organization decommission **không phải feature đang được hỗ trợ**. Backend
không có endpoint hoặc production SQL `DELETE FROM to_chuc`; không được xóa tổ
chức trực tiếp bằng console, migration ad-hoc hay fixture production.

`backend.shared.organization_decommission` cung cấp ownership dry-run chỉ đếm
row và postcondition fail-closed. Registry được sinh từ canonical schema, hiện
bao phủ toàn bộ 62 bảng có `organization_id`, gồm 39 bảng có `owner_type`. Nó
không trả payload, snapshot hoặc khóa tenant ra log.

## Boundary hiện tại

- Không thêm cascade FK hàng loạt. Nhiều bảng dùng owner polymorphic và một số
  bảng audit/retention có lifecycle khác dữ liệu nghiệp vụ.
- Không thêm endpoint xóa trước khi có product lifecycle, retention/legal rule,
  legal hold, export/erasure order và operator/audit ownership được phê duyệt.
- CI phải fail nếu backend xuất hiện `DELETE FROM to_chuc` trước khi finding này
  được mở lại với service và test transaction đầy đủ.
- Dry-run và postcondition chỉ là primitive read-only; chúng không cấp quyền và
  không phải decommission service.

## Yêu cầu nếu sản phẩm bổ sung feature

1. Chốt authoritative retention/legal policy cho business rows, tombstone,
   audit, WebSocket, document job và artifact storage.
2. Chọn one-transaction flow hoặc resumable state machine có idempotency,
   lock-order, retry và crash recovery rõ ràng.
3. Chạy ownership dry-run trong cùng authorization boundary; response/log chỉ
   chứa aggregate count.
4. Quiesce writer và background worker của organization trước destructive step.
5. Chỉ cho phép retained table bằng allowlist đã review; không tự suy diễn từ FK.
6. Sau commit cuối, chạy postcondition: root không tồn tại và mọi table không
   được phê duyệt retention phải có count bằng 0.
7. Test real PostgreSQL cho rollback, concurrent write, partial failure, retry,
   retained evidence và artifact cleanup trước khi mở endpoint.

## Sự cố

Nếu phát hiện organization root bị xóa nhưng còn owner rows, dừng mọi cleanup tự
động, cô lập writer, giữ forensic backup và mở incident. Không sửa bằng cascade
hoặc SQL xóa hàng loạt; dùng ownership inventory count-only để xác định phạm vi,
sau đó thực hiện workflow recovery đã được product/privacy/security phê duyệt.
