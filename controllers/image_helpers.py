import os
import base64

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)

def save_base64_image(base64_str: str, subfolder: str, filename_prefix: str) -> str:
    if not base64_str:
        return ""
    if not isinstance(base64_str, str):
        return base64_str
    if not (base64_str.startswith("data:image") or len(base64_str) > 100):
        return base64_str
        
    header = ""
    data_str = base64_str
    if base64_str.startswith("data:image"):
        try:
            parts = base64_str.split(";base64,")
            header = parts[0]
            data_str = parts[1]
        except Exception:
            return base64_str
            
    ext = "png"
    if "jpeg" in header or "jpg" in header:
        ext = "jpg"
    elif "webp" in header:
        ext = "webp"
    elif "gif" in header:
        ext = "gif"
        
    try:
        upload_dir = os.path.join(project_root, "uploads", subfolder)
        os.makedirs(upload_dir, exist_ok=True)
        
        file_data = base64.b64decode(data_str)
        filename = f"{filename_prefix}.{ext}"
        filepath = os.path.join(upload_dir, filename)
        
        try:
            from PIL import Image
            import io
            
            img = Image.open(io.BytesIO(file_data))
            max_size = 1200
            if "sig" in filename_prefix:
                max_size = 600
                
            if img.width > max_size or img.height > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                
            save_format = "PNG" if ext == "png" else ("JPEG" if ext in ["jpg", "jpeg"] else img.format)
            save_kwargs = {}
            if save_format == "JPEG":
                save_kwargs["quality"] = 100
                save_kwargs["optimize"] = True
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
            elif save_format == "PNG":
                save_kwargs["optimize"] = True
                
            img.save(filepath, format=save_format, **save_kwargs)
        except Exception as pil_err:
            print(f"Pillow optimization failed, falling back to raw save: {pil_err}")
            with open(filepath, "wb") as f:
                f.write(file_data)
                
        return f"uploads/{subfolder}/{filename}"
    except Exception as e:
        print(f"Error saving base64 image: {e}")
        return base64_str

def load_base64_image(db_value: str) -> str:
    if not db_value or not isinstance(db_value, str):
        return ""
    if db_value.startswith("uploads/"):
        try:
            filepath = os.path.join(project_root, db_value)
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
                
                base64_data = base64.b64encode(file_data).decode("utf-8")
                return f"data:{mime};base64,{base64_data}"
        except Exception as e:
            print(f"Error loading image path {db_value}: {e}")
    return db_value
