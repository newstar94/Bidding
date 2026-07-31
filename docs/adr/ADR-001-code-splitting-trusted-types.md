# ADR-001: Native ESM code splitting với Trusted Types

- Status: accepted
- Date: 2026-07-30

## Decision

Bật Vite/Rolldown `codeSplitting: true` tại các dynamic import seam đã có: auth/shell, admin, documents, partners, package detail/evaluation. Giữ `modulePreload: false` vì helper preload gán raw URL vào sink bị Trusted Types kiểm soát; native `import()` tự tải dependency và không cần chèn `<script>`.

Mọi output JS chunk tiếp tục đi qua secure obfuscator, không có source map, và manifest/hash được kiểm tra. Dynamic import failure phải đi qua loader error state hiện có. Startup budget giữ cold p95 ≤ 800 ms, warm p95 ≤ 300 ms.

## Consequences

Secure build tạo nhiều artifact thay vì một bundle; deployment phải publish manifest và toàn bộ hashed chunks atomically. Rollback phải rollback cùng release directory để không mismatch manifest/chunk.

