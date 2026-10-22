# Dùng kết nối PostgreSQL bằng context manager

Không viết mới mẫu `conn = None / try / except rollback / finally close`. Dùng một trong hai cách:

```python
from backend.shared.helpers import database

# Chỉ đọc: không commit; giao dịch ngầm (nếu có) được rollback khi trả kết nối.
with database.connection() as connection:
    row = connection.execute("SELECT ...", (value,)).fetchone()

# Ghi: BEGIN trước thân hàm, COMMIT khi thành công, ROLLBACK và ném lại lỗi gốc khi có exception.
with database.transaction() as connection:
    connection.execute("UPDATE ...", (value,))
```

- Kết nối luôn được trả về pool, kể cả khi lỗi; metric `connection_acquire` vẫn được ghi qua `get_connection()`.
- SAVEPOINT bên trong `transaction()` dùng như cũ (`SAVEPOINT x` / `ROLLBACK TO SAVEPOINT x`).
- Muốn trả lỗi nghiệp vụ mà không commit thì ném exception (hoặc gọi `connection.rollback()` trước khi `return`). Lệnh `return` bình thường trong `transaction()` sẽ COMMIT.
- Mã cũ được chuyển dần theo từng module, giữ nguyên thứ tự câu lệnh SQL. Mẫu đầu tiên: `backend/product_analytics/routes.py`.
