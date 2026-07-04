import os
import base64
import re

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))

# Dict dùng cho image cache (hoạt động như LRU thủ công)
_load_image_cache: dict = {}
MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_SUBFOLDERS = {"chuyen_gia"}
ALLOWED_IMAGE_MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


def _safe_file_part(value: str, fallback: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or fallback))
    safe = safe.strip("._")
    return safe or fallback

def save_base64_image(base64_str: str, subfolder: str, filename_prefix: str) -> str:
    if not base64_str:
        return ""
    if not isinstance(base64_str, str):
        return base64_str
    if len(base64_str) > 7000000:
        raise ValueError("Dung lượng ảnh vượt quá giới hạn 5MB cho phép!")
    if not (base64_str.startswith("data:image") or len(base64_str) > 100):
        return base64_str
    if subfolder not in ALLOWED_IMAGE_SUBFOLDERS:
        raise ValueError("Thư mục lưu ảnh không hợp lệ")
        
    header = ""
    data_str = base64_str
    if base64_str.startswith("data:image"):
        try:
            parts = base64_str.split(";base64,")
            header = parts[0]
            data_str = parts[1]
        except Exception:
            return base64_str
            
    mime = header.replace("data:", "").lower() if header else "image/png"
    ext = ALLOWED_IMAGE_MIME_TO_EXT.get(mime)
    if not ext:
        raise ValueError("Chỉ cho phép ảnh PNG, JPG hoặc WebP")
        
    try:
        uploads_root = os.path.realpath(os.path.join(project_root, "templates", "uploads"))
        upload_dir = os.path.realpath(os.path.join(uploads_root, subfolder))
        if not upload_dir.startswith(uploads_root + os.sep):
            raise ValueError("Đường dẫn lưu ảnh không hợp lệ")
        os.makedirs(upload_dir, exist_ok=True)
        
        file_data = base64.b64decode(data_str, validate=True)
        if len(file_data) > MAX_IMAGE_UPLOAD_BYTES:
            raise ValueError("Dung lượng ảnh vượt quá giới hạn 5MB cho phép!")
        filename = f"{_safe_file_part(filename_prefix, 'image')}.{ext}"
        filepath = os.path.realpath(os.path.join(upload_dir, filename))
        if not filepath.startswith(upload_dir + os.sep):
            raise ValueError("Đường dẫn lưu ảnh không hợp lệ")
        
        try:
            from PIL import Image
            import io
            
            img = Image.open(io.BytesIO(file_data))
            img.verify()
            img = Image.open(io.BytesIO(file_data))
            max_size = 1200
            if "sig" in filename_prefix:
                max_size = 600
                
            if img.width > max_size or img.height > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                
            save_format = "PNG" if ext == "png" else ("JPEG" if ext in ["jpg", "jpeg"] else "WEBP")
            save_kwargs = {}
            if save_format == "JPEG":
                save_kwargs["quality"] = 85  # 85 = cân bằng tối ưu giữa chất lượng & dung lượng (tiết kiệm ~50%)
                save_kwargs["optimize"] = True
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
            elif save_format == "PNG":
                save_kwargs["optimize"] = True
            elif save_format == "WEBP":
                save_kwargs["quality"] = 85
                
            img.save(filepath, format=save_format, **save_kwargs)
        except Exception as pil_err:
            raise ValueError("Nội dung ảnh không hợp lệ") from pil_err
                
        return f"uploads/{subfolder}/{filename}"
    except Exception as e:
        print(f"Error saving base64 image: {e}")
        return base64_str

def load_base64_image(db_value: str) -> str:
    if not db_value or not isinstance(db_value, str):
        return ""
    if not db_value.startswith("uploads/"):
        return db_value
    # Cache key bao gồm mời lần file được chỉnh sửa (mà tử vựa) — tự invalidate khi upload ảnh mới
    try:
        filepath = os.path.join(
            project_root,
            db_value.replace("uploads/", "templates/uploads/", 1)
        )
        if not os.path.exists(filepath):
            return db_value
        mtime = os.path.getmtime(filepath)
        cache_key = (db_value, mtime)
    except Exception:
        cache_key = (db_value, 0)
        filepath = os.path.join(
            project_root,
            db_value.replace("uploads/", "templates/uploads/", 1)
        )
    
    if cache_key in _load_image_cache:
        return _load_image_cache[cache_key]
    try:
        if os.path.exists(filepath):
            with open(filepath, "rb") as f:
                file_data = f.read()
            ext = db_value.split(".")[-1].lower()
            mime = "image/png"
            if ext in ["jpg", "jpeg"]:
                mime = "image/jpeg"
            elif ext == "webp":
                mime = "image/webp"
            elif ext == "gif":
                mime = "image/gif"
            b64 = f"data:{mime};base64,{base64.b64encode(file_data).decode('utf-8')}"
            # Cache kết quả (giới hạn 256 entry — LRU thủ công)
            if len(_load_image_cache) >= 256:
                _load_image_cache.pop(next(iter(_load_image_cache)))
            _load_image_cache[cache_key] = b64
            return b64
    except Exception as e:
        print(f"Error loading image path {db_value}: {e}")
    return db_value
