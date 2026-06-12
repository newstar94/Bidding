import os
import re
import json
import sqlite3
import zipfile
from io import BytesIO
from docxtpl import DocxTemplate
from datetime import datetime

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
TEMPLATE_DIR = os.path.join(current_dir, 'templates')
CONFIG_PATH = os.path.join(TEMPLATE_DIR, 'config.json')

def get_user_template_dir(user_id=None):
    if user_id:
        clean_user_id = str(user_id).replace('..', '').replace('/', '').replace('\\', '').strip()
        path = os.path.join(TEMPLATE_DIR, clean_user_id)
        os.makedirs(path, exist_ok=True)
        return path
    return TEMPLATE_DIR

def get_active_template(user_id=None):
    user_dir = get_user_template_dir(user_id)
    config_path = os.path.join(user_dir, 'config.json')
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return config.get('active_template', 'mau_bao_cao_dau_thau.docx')
        except Exception:
            pass
    return 'mau_bao_cao_dau_thau.docx'

def set_active_template(filename, user_id=None):
    user_dir = get_user_template_dir(user_id)
    config_path = os.path.join(user_dir, 'config.json')
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump({'active_template': filename}, f, ensure_ascii=False, indent=4)

def list_templates(user_id=None):
    templates = []
    # Add default system template
    templates.append({
        'filename': 'mau_bao_cao_dau_thau.docx',
        'name': 'Bản báo cáo đánh giá mặc định',
        'is_system': True,
        'is_active': get_active_template(user_id) == 'mau_bao_cao_dau_thau.docx'
    })
    
    user_dir = get_user_template_dir(user_id)
    if os.path.exists(user_dir):
        for f in os.listdir(user_dir):
            if f.endswith('.docx') and f != 'mau_bao_cao_dau_thau.docx':
                templates.append({
                    'filename': f,
                    'name': f,
                    'is_system': False,
                    'is_active': get_active_template(user_id) == f
                })
    return templates

def validate_template_syntax(file_bytes):
    """
    Validate curly braces symmetry and tag symmetry correctness inside docx XML.
    """
    try:
        # Read the document XML directly from docx zip
        with zipfile.ZipFile(BytesIO(file_bytes)) as z:
            doc_xml = z.read('word/document.xml').decode('utf-8')
            
            # 1. Brace symmetry check
            open_braces = 0
            for i, char in enumerate(doc_xml):
                if char == '{':
                    open_braces += 1
                elif char == '}':
                    open_braces -= 1
                    if open_braces < 0:
                        return False, "Phát hiện dấu đóng ngoặc '}' không khớp với dấu mở ngoặc trước đó."
            
            if open_braces > 0:
                return False, f"Phát hiện {open_braces} dấu mở ngoặc '{{' chưa được đóng."
            
            # 2. Tag matching check (e.g. {#Tag} and {/Tag})
            tags = re.findall(r'\{([^}]+)\}', doc_xml)
            stack = []
            for tag in tags:
                tag = tag.strip()
                if tag.startswith('#'):
                    loop_name = tag[1:].strip()
                    stack.append((loop_name, tag))
                elif tag.startswith('/'):
                    loop_name = tag[1:].strip()
                    if not stack:
                        return False, f"Phát hiện thẻ đóng '{{/{loop_name}}}' mà không có thẻ mở tương ứng."
                    top_name, top_tag = stack.pop()
                    if top_name != loop_name:
                        return False, f"Thẻ đóng '{{/{loop_name}}}' không khớp với thẻ mở '{{#{top_name}}}'."
            
            if stack:
                unclosed_tags = ", ".join([f"'{{#{t[0]}}}'" for t in stack])
                return False, f"Phát hiện các thẻ vòng lặp chưa được đóng: {unclosed_tags}."
                
            return True, "Cú pháp biểu mẫu hoàn toàn hợp lệ."
    except Exception as e:
        return False, f"Không thể đọc tệp tin Word: {str(e)}"

def translate_xml_tags(xml_content):
    """
    Translates user-friendly tags into Jinja2/docxtpl syntax inside XML content.
    - Dynamically detects whether a loop tag is inside a table row (<w:tr>) or in block/page loop context.
    """
    # 0. Chuẩn hóa các thẻ cấp đoạn văn bản như "{% p if" thành "{%p if" để docxtpl biên dịch chính xác
    xml_content = re.sub(r'\{%\s+p\s+', r'{%p ', xml_content)

    # 1. Translate variables within their respective loop contexts first to avoid global variable namespace collision
    
    # Contractor Loop Block
    def replace_contractor_block(match):
        block_content = match.group(1)
        contractor_vars = ['Ten_Nha_Thau', 'Loai_Nha_Thau', 'Ma_So_Thue', 'Nguoi_Dai_Dien', 'So_Dien_Thoai', 'Gia_Trung_Thau']
        for var in contractor_vars:
            block_content = re.sub(r'\{' + var + r'\}', r'{{ nt.' + var + r' }}', block_content)
        return f"{{#Danh_Sach_Nha_Thau}}{block_content}{{/Danh_Sach_Nha_Thau}}"
        
    xml_content = re.sub(r'\{#Danh_Sach_Nha_Thau\}(.*?)\{/Danh_Sach_Nha_Thau\}', replace_contractor_block, xml_content, flags=re.DOTALL)
    
    # Expert Loop Block
    def replace_expert_block(match):
        block_content = match.group(1)
        expert_vars = ['Ho_Ten', 'So_CCCD', 'So_Chung_Chi', 'Ngay_Cap_Chung_Chi', 'Don_Vi_Cap_Chung_Chi', 'Chuc_Vu']
        for var in expert_vars:
            block_content = re.sub(r'\{' + var + r'\}', r'{{ cg.' + var + r' }}', block_content)
        return f"{{#Danh_Sach_Chuyen_Gia}}{block_content}{{/Danh_Sach_Chuyen_Gia}}"
        
    xml_content = re.sub(r'\{#Danh_Sach_Chuyen_Gia\}(.*?)\{/Danh_Sach_Chuyen_Gia\}', replace_expert_block, xml_content, flags=re.DOTALL)
    
    # Contract Loop Block
    def replace_contract_block(match):
        block_content = match.group(1)
        contract_vars = ['Ten_Hop_Dong', 'So_Hop_Dong', 'Ngay_Ky', 'Gia_Tri']
        for var in contract_vars:
            block_content = re.sub(r'\{' + var + r'\}', r'{{ hd.' + var + r' }}', block_content)
        return f"{{#Danh_Sach_Hop_Dong}}{block_content}{{/Danh_Sach_Hop_Dong}}"
        
    xml_content = re.sub(r'\{#Danh_Sach_Hop_Dong\}(.*?)\{/Danh_Sach_Hop_Dong\}', replace_contract_block, xml_content, flags=re.DOTALL)

    # 2. Find and translate all loop open/close tags {#Danh_Sach_...}
    # We iterate and replace each loop tag based on its position in a table row
    def replace_open_loop(match):
        loop_name = match.group(1)
        index = match.start()
        
        # Check backward for nearest w:tr start/end to see if we are in a table row
        pos_start = xml_content.rfind('<w:tr', 0, index)
        pos_end = xml_content.rfind('</w:tr>', 0, index)
        in_table_row = pos_start > pos_end
        
        # Loop variables mapping prefix
        prefix = 'cg' if 'Chuyen_Gia' in loop_name else ('nt' if 'Nha_Thau' in loop_name else 'hd')
        
        if in_table_row:
            return f'{{% tr for {prefix} in {loop_name} %}}'
        else:
            return f'{{% for {prefix} in {loop_name} %}}'

    def replace_close_loop(match):
        loop_name = match.group(1)
        index = match.start()
        
        pos_start = xml_content.rfind('<w:tr', 0, index)
        pos_end = xml_content.rfind('</w:tr>', 0, index)
        in_table_row = pos_start > pos_end
        
        if in_table_row:
            return '{% tr endfor %}'
        else:
            return '{% endfor %}'

    # Translate open and close loops dynamically
    xml_content = re.sub(r'\{#([A-Za-z0-9_]+)\}', replace_open_loop, xml_content)
    xml_content = re.sub(r'\{/([A-Za-z0-9_]+)\}', replace_close_loop, xml_content)

    # 3. Translate all remaining global variables
    global_vars = [
        'Ten_Chu_Dau_Tu', 'So_Quyet_Dinh', 'Ngay_Phe_Duyet', 'Ten_Ke_Hoach',
        'Ma_Ke_Hoach', 'Tong_Muc_Dau_Tu', 'Ten_Goi_Thau', 'Ma_Goi_Thau',
        'Gia_Goi_Thau', 'Phuong_Thuc_Lua_Chon', 'Loai_Hop_Dong', 'Thoi_Gian_Thuc_Hien', 'Nguon_Von',
        'Dia_Chi_Day_Du_CDT', 'Tinh_Rieng_CDT', 'Xa_Rieng_CDT', 'Dia_Chi_Rut_Gon_CDT', 'Loai_Nha_Thau'
    ]
    for var in global_vars:
        xml_content = re.sub(r'\{' + var + r'\}', r'{{ ' + var + r' }}', xml_content)
        
    return xml_content

def translate_docx_template(template_path):
    """
    Reads the docx, extracts XMLs, translates custom syntax to Jinja2, and returns a DocxTemplate.
    """
    temp_bytes = BytesIO()
    with zipfile.ZipFile(template_path, 'r') as yin:
        with zipfile.ZipFile(temp_bytes, 'w', zipfile.ZIP_DEFLATED) as yout:
            for item in yin.infolist():
                data = yin.read(item.filename)
                if item.filename in ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml']:
                    xml_str = data.decode('utf-8')
                    translated_xml = translate_xml_tags(xml_str)
                    data = translated_xml.encode('utf-8')
                yout.writestr(item, data)
                
    temp_bytes.seek(0)
    return DocxTemplate(temp_bytes)

def generate_report_from_custom_template(template_path, context):
    """
    Translates, compiles, and renders custom template, returning output docx BytesIO stream.
    """
    doc = translate_docx_template(template_path)
    
    # Pre-process context to avoid missing variable errors (Jinja2 StrictUndefined behavior safeguard)
    # Define fallback defaults for all data dictionary variables
    defaults = {
        'Ten_Chu_Dau_Tu': '--', 'So_Quyet_Dinh': '--', 'Ngay_Phe_Duyet': '--',
        'Ten_Ke_Hoach': '--', 'Ma_Ke_Hoach': '--', 'Tong_Muc_Dau_Tu': '0 VND',
        'Ten_Goi_Thau': '--', 'Ma_Goi_Thau': '--', 'Gia_Goi_Thau': '0 VND',
        'Phuong_Thuc_Lua_Chon': '--', 'Loai_Hop_Dong': '--', 'Thoi_Gian_Thuc_Hien': 0, 'Nguon_Von': '--',
        'Dia_Chi_Day_Du_CDT': '--', 'Tinh_Rieng_CDT': '--', 'Xa_Rieng_CDT': '--', 'Dia_Chi_Rut_Gon_CDT': '--',
        'Loai_Nha_Thau': '--', 'Thanh_Vien_Lien_Danh': [],
        'Danh_Sach_Chuyen_Gia': [], 'Danh_Sach_Nha_Thau': []
    }
    
    for key, default_val in defaults.items():
        if key not in context:
            context[key] = default_val
            
    doc.render(context)
    out_stream = BytesIO()
    doc.save(out_stream)
    out_stream.seek(0)
    return out_stream
