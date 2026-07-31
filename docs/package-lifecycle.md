# Package lifecycle contract

Backend `backend/shared/lifecycle_policy.py` là nguồn chuẩn, phát contract version 1 qua `GET /api/contracts/package-lifecycle`. Frontend adapter nằm tại `frontend/packages/LifecyclePolicy.js`; mismatch version/schema phải fail rõ, không tự đoán transition.

## Status codes

`PREPARING → INVITED → OPENED → EVALUATING → PARTIALLY_AWARDED/AWARDED`; `CANCELLED` là transition có kiểm soát và restore/rebid dùng command nghiệp vụ hiện hữu. Nhãn như “Đang chấm thầu” chỉ là presentation/legacy alias.

Policy cung cấp:

- `normalizeStatus(value)`;
- `allowedTransitions(code, context)`;
- `fieldPolicy(code, packageType)`;
- `workflowStep(code, method, lotState)`;
- `presentStatus(code)`.

Package detail lấy status/field/workflow presentation từ policy. Lot award state vẫn được tách theo batch/lot; package chỉ `AWARDED` khi các scope bắt buộc hoàn tất. Mọi material transition đi qua sync mutation có row version, mutation ID và immutable audit.

