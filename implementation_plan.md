# Tính năng nhân bản cột động (Column Loop) — Cơ chế tổng quát

## Mô tả

Thêm cú pháp `{#col <tên_danh_sách>}...{/col <tên_danh_sách>}` cho Word template, cho phép **nhân bản cột** theo số phần tử trong bất kỳ danh sách nào đã ánh xạ. Đây là cơ chế tổng quát, không gắn với loại bảng cụ thể.

**Hiện tại đã có:**
- `{#danh_sách}...{/danh_sách}` → lặp **dòng** (row loop)

**Thêm mới:**
- `{#col danh_sách}...{/col danh_sách}` → lặp **cột** (column loop)

User có thể dùng với bất kỳ danh sách nào: `ds_mo_thau`, `ds_nt_tham_du`, `ds_to_chuyen_gia`, `ds_nt_trung`, hoặc danh sách tùy chỉnh qua UI.

---

## Ví dụ sử dụng

| Mục đích | Danh sách dùng |
|----------|---------------|
| Bảng đánh giá tài chính (mỗi NT 1 cột) | `ds_nt_tham_du` hoặc danh sách tùy chỉnh |
| So sánh giá các nhà thầu trúng thầu | `ds_nt_trung` |
| Bảng chấm điểm kỹ thuật | `ds_mo_thau` |
| Bảng thông tin tổ chuyên gia | `ds_to_chuyen_gia` |

---

## Kiến trúc

```
Pipeline render Word
─────────────────────
1. build_report_context()       ← dữ liệu thô từ DB
2. enrich_bidders/lot_summaries ← tạo các danh sách phân loại
3. apply_custom_mappings()      ← ánh xạ biến → gán tên biến cho field trong list items
4. apply_computed_mappings()    ← công thức tính toán
5. enrich_words / format_dates  ← bổ sung bằng chữ, format ngày

★ 6. expand_column_loops()      ← MỚI: xử lý {#col}...{/col}
   │  - Quét template tìm {#col <list>}
   │  - Lấy danh sách từ context
   │  - Nhân bản cột, thay biến bằng giá trị từng phần tử
   │  - Merge header
   │  - Trả về template bytes đã sửa
   │
7. translate_xml_tags()         ← {var} → {{ var }}, {#list} → {% for %}
8. docxtpl.render()             ← Jinja2 render (row loops, global vars)
```

> [!IMPORTANT]
> **Tách biệt**: Column loop resolve biến **trực tiếp bằng Python** (bước 6). Row loop resolve bằng **Jinja2** (bước 8). Hai cơ chế không xung đột vì cột đã được expand xong trước khi Jinja2 chạy.

---

## Cú pháp template

### Quy tắc

| Cú pháp | Vị trí | Ý nghĩa |
|---------|--------|---------|
| `{#col <tên_ds>}` | Ô đầu tiên của cột mẫu (dòng header) | Bắt đầu vùng cột động |
| `{/col <tên_ds>}` | Ô cuối cùng của cột mẫu | Kết thúc vùng cột động |
| `{biến_ánh_xạ}` | Bất kỳ ô nào trong cột mẫu | Thay bằng giá trị tương ứng của từng phần tử |
| Text tĩnh | Bất kỳ ô nào trong cột mẫu | Giữ nguyên cho tất cả cột |

- `<tên_ds>` phải là tên biến danh sách có trong context (ví dụ: `ds_mo_thau`, `ds_nt_tham_du`, hoặc tên tùy chỉnh)
- `{#col}` và `{/col}` phải cùng bảng, cùng cột
- Biến trong cột mẫu phải là biến đã ánh xạ cho danh sách đó (ví dụ: `{mt_gia_du_thau}` thuộc danh sách `ds_mo_thau`)

### Ví dụ trong Word mẫu

```
┌─────┬──────────────┬──────────────────────────────┐
│ STT │ Nội dung     │ {#col ds_mo_thau}            │  ← marker + header
│     │              │ Nhà thầu: {mt_ten_nt}        │
├─────┼──────────────┼──────────────────────────────┤
│  1  │ Giá dự thầu  │ {mt_gia_du_thau}             │  ← biến ánh xạ
├─────┼──────────────┼──────────────────────────────┤
│  2  │ Giảm giá     │ {mt_ty_le_giam_gia}          │
│     │              │ {/col ds_mo_thau}            │  ← marker đóng
└─────┴──────────────┴──────────────────────────────┘
```

### Kết quả (3 phần tử trong ds_mo_thau)

```
┌─────┬──────────────┬──────────────────────────────────────────┐
│ STT │ Nội dung     │           Nhà thầu (MERGED)              │
│     │              ├────────────┬────────────┬────────────────┤
│     │              │  Cty A     │  Cty B     │  Liên danh C   │
├─────┼──────────────┼────────────┼────────────┼────────────────┤
│  1  │ Giá dự thầu  │ 1.250.000  │ 1.180.000  │ 1.320.000      │
├─────┼──────────────┼────────────┼────────────┼────────────────┤
│  2  │ Giảm giá     │ 5%         │ 0%         │ 8%             │
└─────┴──────────────┴────────────┴────────────┴────────────────┘
```

---

## Thuật toán `expand_column_loops` — Chi tiết

### Hàm chính

```python
def expand_column_loops(template_bytes: bytes, context: dict) -> bytes:
    """
    Quét template tìm {#col}...{/col}, nhân bản cột, thay biến.
    Hoạt động với BẤT KỲ danh sách nào trong context.
    Trả về template_bytes nguyên vẹn nếu không có {#col}.
    """
```

### Bước 1: Quick check

```python
# Kiểm tra nhanh trên raw bytes: có "{#col" không?
if b'{#col' not in template_bytes:
    return template_bytes  # fast path
```

### Bước 2: Đọc & parse XML

```python
# Đọc word/document.xml từ zip archive
# Parse bằng lxml.etree
# Dùng clean_braces logic để xử lý XML tags xen giữa {#col ...}
```

### Bước 3: Tìm tất cả column loops

```python
# Duyệt mỗi <w:tbl> → mỗi <w:tr> → mỗi <w:tc>
# Extract text content (loại bỏ XML tags)
# Tìm cell chứa "{#col <name>}" → ghi nhận (table, col_idx, start_row, list_name)
# Tìm cell chứa "{/col <name>}" → ghi nhận (table, col_idx, end_row)
# Validate: cùng table, cùng col_idx, end > start
# Trả về danh sách: [(table, col_idx, start_row, end_row, list_name), ...]
```

### Bước 4: Với mỗi loop, lấy danh sách từ context

```python
items = context.get(list_name, [])  # ví dụ: context['ds_mo_thau']
n = max(len(items), 1)  # ít nhất 1 cột
```

### Bước 5: Nhân bản cột trong XML

Với mỗi dòng `<w:tr>` từ start_row đến end_row:

```python
template_cell = row.find_all('w:tc')[col_idx]
row.remove(template_cell)

for i in range(n):
    cell_copy = deepcopy(template_cell)
    if items:
        replace_vars_in_cell(cell_copy, items[i])
    else:
        replace_vars_in_cell(cell_copy, {})  # danh sách rỗng → xóa biến
    row.insert(col_idx + i, cell_copy)
```

### Bước 6: Merge header

Dòng chứa `{#col}`:

```python
if n > 1:
    header_cell = row[col_idx]
    # Set gridSpan = n trên cell đầu tiên
    tcPr = header_cell.find_or_create('w:tcPr')
    gridSpan.set('w:val', str(n))
    # Xóa n-1 cells thừa trong dòng header
    for i in range(1, n):
        row.remove(row[col_idx + 1])
```

### Bước 7: Cập nhật `<w:tblGrid>`

```python
# Grid gốc:  [..., MẫuWidth, ...]
# Grid mới:  [..., Width/n, Width/n, ..., Width/n, ...]
original_width = int(grid_cols[col_idx].get('w:w'))
for i in range(n):
    new_width = original_width // n  # chia đều
    insert_grid_col(tblGrid, col_idx + i, new_width)
remove_original_grid_col()
```

### Bước 8: Xóa markers & ghi lại

```python
# Xóa text "{#col ...}" và "{/col ...}" khỏi tất cả cells
# Ghi word/document.xml mới vào zip, các file khác giữ nguyên
```

---

## Thay biến trong cell — Chi tiết xử lý Word text runs

> [!WARNING]
> Word chia text thành nhiều `<w:r><w:t>` elements. Ví dụ `{mt_gia}` có thể bị tách:
> ```xml
> <w:r><w:t>{mt_</w:t></w:r><w:r><w:rPr>...</w:rPr><w:t>gia}</w:t></w:r>
> ```

**Giải pháp** (tương tự `clean_braces` đã có):

```python
def _replace_vars_in_cell(tc_element, item):
    """
    1. Thu thập tất cả <w:t> elements trong cell
    2. Ghép text thành 1 chuỗi liên tục
    3. Tìm {var_name} bằng regex
    4. Thay bằng str(item.get(var_name, ''))
    5. Phân bổ text mới lại cho các <w:t> elements
       (giữ run đầu tiên chứa toàn bộ text, xóa text ở các run sau)
    """
```

---

## Proposed Changes

### [NEW] [docx_column_loop.py](file:///c:/Users/newst/OneDrive%20-%2079401/Bidding/backend/documents/docx_column_loop.py)

File mới ~200-250 dòng, module độc lập, chứa:

| Hàm | Mục đích |
|-----|---------|
| `expand_column_loops(template_bytes, context)` | Entry point chính |
| `_find_column_loops(doc_xml)` | Quét XML tìm markers, trả về danh sách loops |
| `_expand_one_loop(table, col_idx, start, end, items)` | Xử lý 1 loop: nhân bản + merge + thay biến |
| `_cell_plain_text(tc)` | Extract text thuần từ `<w:tc>` |
| `_clean_cell_braces(tc)` | Ghép text bị tách bởi XML tags |
| `_replace_vars_in_cell(tc, item)` | Thay `{var}` bằng giá trị |
| `_remove_text_pattern(tc, regex)` | Xóa marker khỏi cell text |
| `_merge_header_cells(row, col_idx, n)` | Set gridSpan, xóa cell thừa |
| `_update_table_grid(tbl, col_idx, n)` | Cập nhật `<w:tblGrid>` |

---

### [MODIFY] [custom_exporter.py](file:///c:/Users/newst/OneDrive%20-%2079401/Bidding/backend/documents/custom_exporter.py)

**2 thay đổi:**

1. **Import** (dòng ~5):
```python
from backend.documents.docx_column_loop import expand_column_loops
```

2. **Sửa `translate_docx_template()`** (dòng ~606): Thêm column expansion trước khi translate XML tags. Bypass cache khi template có `{#col}`:

```diff
     with open(template_path, 'rb') as template_file:
         template_bytes = template_file.read()
     validate_ooxml_archive(template_bytes, "docx")

+    # Column loops depend on runtime context data → bypass translation cache
+    if b'{#col' in template_bytes:
+        template_bytes = expand_column_loops(template_bytes, context)
+
     temp_bytes = BytesIO()
```

---

### [MODIFY] [word_defaults.py](file:///c:/Users/newst/OneDrive%20-%2079401/Bidding/backend/documents/word_defaults.py)

Không bắt buộc cho cơ chế tổng quát. User đã có thể dùng `{#col}` với **bất kỳ danh sách nào** đã có (`ds_mo_thau`, `ds_nt_tham_du`, `ds_to_chuyen_gia`...).

Nếu sau này muốn thêm danh sách phân loại mới (ví dụ `ds_nha_thau_dat_ky_thuat`), đó là **thay đổi riêng**, không thuộc scope tính năng column loop.

---

### [MODIFY] [docx_mapping_service.py](file:///c:/Users/newst/OneDrive%20-%2079401/Bidding/backend/documents/docx_mapping_service.py)

Không cần sửa. Mapping service đã gán tên biến ánh xạ vào từng item trong danh sách. Column loop engine chỉ cần đọc `item[ten_bien]`.

---

## Edge cases

| Trường hợp | Xử lý |
|------------|-------|
| Không có `{#col}` nào | Trả nguyên template (fast path) |
| Danh sách rỗng | Giữ 1 cột, thay biến bằng `''`, xóa markers |
| Danh sách 1 phần tử | 1 cột, không merge, thay biến, xóa markers |
| Danh sách không tồn tại trong context | Giống rỗng: 1 cột, biến → `''` |
| Nhiều `{#col}` trong 1 bảng (nhiều vùng cột) | Xử lý từ phải→trái để index không lệch |
| Nhiều bảng có `{#col}` | Mỗi bảng xử lý độc lập |
| `{#col}` không có `{/col}` | Log warning, bỏ qua |
| Biến không tồn tại trong item | Giữ nguyên `{biến}` → docxtpl xử lý tiếp (có thể là biến global) |
| Cell chứa cả biến cột và text tĩnh | Text tĩnh giữ nguyên, biến được thay |
| Cell mẫu rỗng | Tạo N cell rỗng |
| Cell mẫu có merge dọc sẵn (vMerge) | Giữ vMerge cho tất cả bản copy |
| Template có cache → mtime không đổi nhưng context khác | Bypass cache khi có `{#col}` |

---

## Tests

### [NEW] [test_column_loop.py](file:///c:/Users/newst/OneDrive%20-%2079401/Bidding/tests/api/test_column_loop.py)

```python
# === Unit tests cho module docx_column_loop ===

# Test 1: Template không có {#col} → bytes trả về nguyên vẹn
def test_no_markers_returns_unchanged(): ...

# Test 2: 3 items → 3 cột, header merged, biến thay đúng
def test_expand_3_items(): ...

# Test 3: Danh sách rỗng → 1 cột, biến thay bằng rỗng
def test_empty_list(): ...

# Test 4: 1 item → 1 cột, không merge
def test_single_item(): ...

# Test 5: Text tĩnh giữ nguyên cho tất cả cột
def test_static_text_preserved(): ...

# Test 6: Markers bị xóa hoàn toàn khỏi output
def test_markers_removed(): ...

# Test 7: tblGrid cập nhật đúng số gridCol
def test_grid_updated(): ...

# Test 8: Danh sách không tồn tại → giống rỗng
def test_missing_list(): ...

# Test 9: Nhiều bảng có {#col} → tất cả đều expand
def test_multiple_tables(): ...

# Test 10: Biến không tồn tại trong item → giữ nguyên cho docxtpl
def test_unknown_var_preserved(): ...
```

Mỗi test tạo file `.docx` in-memory bằng `python-docx`, gọi `expand_column_loops()`, rồi verify kết quả bằng cách parse lại XML.

---

## Verification Plan

### Automated Tests

```bash
python -m pytest tests/api/test_column_loop.py -v
```

### Manual Verification

1. Tạo Word mẫu có bảng với `{#col ds_mo_thau}...{/col ds_mo_thau}` và các biến `{mt_ten_nt}`, `{mt_gia_du_thau}`
2. Upload template vào ứng dụng
3. Tạo gói thầu với 3 nhà thầu có thông tin mở thầu
4. Xuất file Word → kiểm tra bảng có 3 cột nhà thầu, header merged, dữ liệu đúng
5. Thử lại với 1 nhà thầu → không merge, 1 cột
6. Thử lại với 0 nhà thầu → 1 cột rỗng
7. Kiểm tra các phần khác của document không bị ảnh hưởng
