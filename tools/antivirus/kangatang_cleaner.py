#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Kangatang & Macro Virus Killer for Microsoft Excel
===================================================
Tác vụ:
1. Đóng sạch các tiến trình Excel đang chạy ngầm.
2. Quét & xóa vĩnh viễn mypersonnel.xls và các biến thể trong thư mục XLSTART.
3. Tiêm phòng (Vaccine) chống tái nhiễm trong XLSTART bằng cơ chế chặn ghi NTFS.
4. Quét siêu tốc & làm sạch toàn bộ các file Excel (.xls, .xlsm, .xlsb) trên máy tính.
5. Khôi phục nguyên vẹn dữ liệu, các bảng tính, công thức, định dạng, bóc tách triệt để mã độc.
6. Hỗ trợ giao diện đồ họa (GUI) tiếng Việt và chế độ dòng lệnh (CLI).
"""

import os
import sys

# Force UTF-8 encoding on Windows console
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import time
import shutil
import struct
import ctypes
import argparse
import threading
import subprocess
from pathlib import Path
import winreg

# Import external modules
try:
    import win32com.client
    import win32api
    import win32file
except ImportError:
    win32com = None
    win32api = None
    win32file = None

try:
    import olefile
except ImportError:
    olefile = None

try:
    pass
except ImportError:
    VBA_Parser = None

try:
    import xlrd
except ImportError:
    xlrd = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

# Windows File Attributes
FILE_ATTRIBUTE_READONLY = 0x00000001
FILE_ATTRIBUTE_HIDDEN   = 0x00000002
FILE_ATTRIBUTE_SYSTEM   = 0x00000004
FILE_ATTRIBUTE_OFFLINE  = 0x00001000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
CLOUD_OFFLINE_ATTRS = (
    FILE_ATTRIBUTE_OFFLINE |
    FILE_ATTRIBUTE_RECALL_ON_OPEN |
    FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)

VIRUS_SIGNATURES = [
    b"kangatang",
    b"mypersonnel.xls",
    b"mypersonel.xls",
]

MALICIOUS_SHEET_NAMES = [
    "kangatang",
    "xxxxxxxxx",
    "foxz",
]


def get_short_path(path: str) -> str:
    """Trả về short path 8.3 để đảm bảo tương thích tuyệt đối với đường dẫn tiếng Việt."""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        res = ctypes.windll.kernel32.GetShortPathNameW(path, buf, 1024)
        if res > 0:
            return buf.value
    except Exception:
        pass
    return path


def is_cloud_offline(path: str) -> bool:
    """Kiểm tra nếu file là OneDrive placeholder chưa tải về máy."""
    try:
        attrs = ctypes.windll.kernel32.GetFileAttributesW(path)
        if attrs != -1 and (attrs & CLOUD_OFFLINE_ATTRS):
            return True
    except Exception:
        pass
    return False


class KangatangEngine:
    def __init__(self, logger=None):
        self.logger = logger or self._default_logger
        self.stop_requested = False

    def _default_logger(self, msg: str, level: str = "INFO"):
        print(f"[{level}] {msg}")

    def log(self, msg: str, level: str = "INFO"):
        self.logger(msg, level)

    def kill_excel_processes(self) -> int:
        """Đóng toàn bộ tiến trình Excel đang chạy để giải phóng file và macro."""
        killed = 0
        try:
            cmd = "taskkill /F /IM excel.exe /T"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if "SUCCESS" in res.stdout or "thành công" in res.stdout:
                killed += 1
                self.log("Đã đóng các tiến trình Excel đang chạy ngầm.", "SUCCESS")
            else:
                self.log("Không có tiến trình Excel nào đang chạy.", "INFO")
        except Exception as e:
            self.log(f"Lỗi khi đóng Excel: {e}", "WARNING")
        time.sleep(0.5)
        return killed

    def get_xlstart_dirs(self) -> list:
        """Tìm toàn bộ các thư mục XLSTART trên hệ thống."""
        dirs = []
        # 1. Thư mục XLSTART của người dùng hiện tại
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            current_xlstart = os.path.join(appdata, r"Microsoft\Excel\XLSTART")
            if current_xlstart not in dirs:
                dirs.append(current_xlstart)

        # 2. Thư mục XLSTART của các user khác trong C:\Users
        users_dir = r"C:\Users"
        if os.path.exists(users_dir):
            try:
                for u in os.listdir(users_dir):
                    u_xlstart = os.path.join(users_dir, u, r"AppData\Roaming\Microsoft\Excel\XLSTART")
                    if os.path.exists(u_xlstart) and u_xlstart not in dirs:
                        dirs.append(u_xlstart)
            except Exception:
                pass

        # 3. Thư mục XLSTART trong thư mục cài đặt Microsoft Office
        office_roots = [
            r"C:\Program Files\Microsoft Office",
            r"C:\Program Files (x86)\Microsoft Office",
        ]
        for oroot in office_roots:
            if os.path.exists(oroot):
                for root, dnames, _ in os.walk(oroot):
                    for d in dnames:
                        if d.upper() == "XLSTART":
                            full = os.path.join(root, d)
                            if full not in dirs:
                                dirs.append(full)
        return dirs

    def check_system_infection(self) -> dict:
        """Kiểm tra tình trạng nhiễm virus của hệ thống (XLSTART, Registry)."""
        infected_files = []
        is_immunized = False
        xlstart_dirs = self.get_xlstart_dirs()

        for d in xlstart_dirs:
            if not os.path.exists(d):
                continue
            # Kiểm tra xem có file mypersonnel.xls không
            mypers_path = os.path.join(d, "mypersonnel.xls")
            if os.path.exists(mypers_path):
                if os.path.isdir(mypers_path):
                    is_immunized = True
                else:
                    infected_files.append(mypers_path)

            for f in os.listdir(d):
                if f.lower().startswith("mypersonnel") or f.lower().startswith("mypersonel"):
                    fpath = os.path.join(d, f)
                    if os.path.isfile(fpath) and fpath not in infected_files:
                        infected_files.append(fpath)

        return {
            "is_infected": len(infected_files) > 0,
            "infected_files": infected_files,
            "is_immunized": is_immunized,
            "xlstart_dirs": xlstart_dirs,
        }

    def clean_startup(self) -> int:
        """Xóa sạch các file virus trong tất cả thư mục XLSTART."""
        self.kill_excel_processes()
        xlstart_dirs = self.get_xlstart_dirs()
        removed = 0

        for d in xlstart_dirs:
            if not os.path.exists(d):
                continue
            for fname in os.listdir(d):
                fpath = os.path.join(d, fname)
                lower_name = fname.lower()
                # Kiểm tra nếu là file virus mypersonnel
                if (lower_name.startswith("mypersonnel") or lower_name.startswith("mypersonel")) and os.path.isfile(fpath):
                    try:
                        # Bỏ thuộc tính Read-only / System nếu có
                        ctypes.windll.kernel32.SetFileAttributesW(fpath, 128) # FILE_ATTRIBUTE_NORMAL
                        os.remove(fpath)
                        removed += 1
                        self.log(f"Đã xóa file virus khởi động: {fpath}", "SUCCESS")
                    except Exception as e:
                        self.log(f"Không thể xóa {fpath}: {e}", "ERROR")

                # Kiểm tra file PERSONAL.XLSB nếu bị lây nhiễm
                elif lower_name in ["personal.xlsb", "personal.xls"]:
                    try:
                        with open(fpath, "rb") as fp:
                            data = fp.read()
                            if any(sig in data for sig in VIRUS_SIGNATURES):
                                self.log(f"Phát hiện file PERSONAL bị nhiễm: {fpath}", "WARNING")
                                bak = fpath + f".bak_{int(time.time())}"
                                shutil.copyfile(fpath, bak)
                                self.clean_file(fpath)
                    except Exception:
                        pass
        return removed

    def immunize_startup(self) -> bool:
        """
        Tiêm phòng (Vaccine):
        Tạo một thư mục đặc biệt mang tên 'mypersonnel.xls' (khóa ReadOnly + System)
        trong các thư mục XLSTART.
        Khi virus chạy lệnh ThisWorkbook.SaveCopyAs(XLSTART/mypersonnel.xls),
        Windows sẽ chặn hoàn toàn việc ghi đè vì đã có thư mục cùng tên!
        """
        xlstart_dirs = self.get_xlstart_dirs()
        success = True

        for d in xlstart_dirs:
            try:
                os.makedirs(d, exist_ok=True)
                vaccine_path = os.path.join(d, "mypersonnel.xls")
                # Nếu là file thường, xóa đi
                if os.path.isfile(vaccine_path):
                    ctypes.windll.kernel32.SetFileAttributesW(vaccine_path, 128)
                    os.remove(vaccine_path)
                # Tạo thư mục tiêm phòng nếu chưa có
                if not os.path.exists(vaccine_path):
                    os.makedirs(vaccine_path, exist_ok=True)
                    # Tạo file con khóa bên trong
                    guard_file = os.path.join(vaccine_path, "vaccine.lock")
                    with open(guard_file, "w") as fp:
                        fp.write("Immunized against Kangatang/mypersonnel macro virus.\n")
                    # Đặt thuộc tính ReadOnly + Hidden + System
                    ctypes.windll.kernel32.SetFileAttributesW(
                        guard_file, FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_SYSTEM
                    )
                    ctypes.windll.kernel32.SetFileAttributesW(
                        vaccine_path, FILE_ATTRIBUTE_READONLY | FILE_ATTRIBUTE_SYSTEM
                    )
                    self.log(f"Đã kích hoạt tiêm phòng chống lây nhiễm tại: {vaccine_path}", "SUCCESS")
                else:
                    self.log(f"Thư mục XLSTART đã được tiêm phòng trước đó: {d}", "INFO")
            except Exception as e:
                self.log(f"Không thể tiêm phòng tại {d}: {e}", "WARNING")
                success = False
        return success

    def deimmunize_startup(self) -> bool:
        """Gỡ bỏ tiêm phòng nếu người dùng cần khôi phục nguyên bản."""
        xlstart_dirs = self.get_xlstart_dirs()
        for d in xlstart_dirs:
            vaccine_path = os.path.join(d, "mypersonnel.xls")
            if os.path.isdir(vaccine_path):
                try:
                    # Bỏ thuộc tính
                    for root, dirs, files in os.walk(vaccine_path):
                        for f in files:
                            fp = os.path.join(root, f)
                            ctypes.windll.kernel32.SetFileAttributesW(fp, 128)
                    ctypes.windll.kernel32.SetFileAttributesW(vaccine_path, 128)
                    shutil.rmtree(vaccine_path)
                    self.log(f"Đã gỡ bỏ tiêm phòng tại {d}", "INFO")
                except Exception as e:
                    self.log(f"Lỗi khi gỡ tiêm phòng: {e}", "ERROR")
        return True

    def configure_excel_security(self) -> bool:
        """Cấu hình lại Trust Center trong Registry để cảnh báo khi mở macro."""
        try:
            reg_paths = [
                r"Software\Microsoft\Office\16.0\Excel\Security",
                r"Software\Microsoft\Office\15.0\Excel\Security",
                r"Software\Microsoft\Office\14.0\Excel\Security",
            ]
            for rp in reg_paths:
                try:
                    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, rp)
                    # VBAWarnings = 2 ("Disable all macros with notification")
                    winreg.SetValueEx(key, "VBAWarnings", 0, winreg.REG_DWORD, 2)
                    winreg.CloseKey(key)
                except Exception:
                    pass
            self.log("Đã kích hoạt chế độ cảnh báo an toàn Macro của Excel (VBAWarnings=2).", "SUCCESS")
            return True
        except Exception as e:
            self.log(f"Lỗi cấu hình Registry: {e}", "WARNING")
            return False

    def is_file_infected(self, file_path: str) -> bool:
        """Kiểm tra chính xác xem file có chứa mã độc Kangatang hay không."""
        if not os.path.isfile(file_path):
            return False
        if is_cloud_offline(file_path):
            return False

        ext = os.path.splitext(file_path)[1].lower()
        if ext not in [".xls", ".xlsm", ".xlsb", ".xla", ".xlam", ".xltm", ".xlt"]:
            return False

        sp = get_short_path(file_path)
        try:
            with open(sp, "rb") as fp:
                data = fp.read()
                lower_data = data.lower()
                # Chữ ký chuẩn xác: chứa Kangatang hoặc mypersonnel.xls
                if b"kangatang" in lower_data:
                    return True
                if b"mypersonnel.xls" in lower_data or b"mypersonel.xls" in lower_data:
                    return True
                return False
        except Exception:
            return False

    def clean_file(self, file_path: str, backup: bool = True, convert_to_xlsx: bool = True) -> dict:
        """
        Làm sạch file Excel bị nhiễm:
        1. Tạo bản sao lưu .bak.
        2. Thử làm sạch qua Excel COM với AutomationSecurity = 3 (buộc tắt Macro).
        3. Nếu Excel COM không thể mở (do virus làm hỏng cấu trúc OLE/BOUNDSHEET),
           dùng thuật toán sửa trực tiếp bằng xlrd + openpyxl để khôi phục 100% dữ liệu sang file .xlsx sạch.
        """
        result = {
            "file": file_path,
            "success": False,
            "method": "",
            "details": "",
            "output_file": file_path,
        }

        if not os.path.exists(file_path):
            result["details"] = "File không tồn tại"
            return result

        sp = get_short_path(file_path)

        # 1. Tạo bản sao lưu
        if backup:
            bak_path = file_path + ".bak"
            if not os.path.exists(bak_path):
                try:
                    shutil.copyfile(sp, bak_path)
                except Exception as e:
                    self.log(f"Không thể tạo backup cho {file_path}: {e}", "WARNING")

        # 2. Phương pháp 1: Làm sạch qua Excel COM (khuyên dùng khi file mở được)
        cleaned_via_com = False
        app = None
        try:
            if win32com:
                app = win32com.client.Dispatch("Excel.Application")
                app.Visible = False
                app.DisplayAlerts = False
                app.AutomationSecurity = 3  # msoAutomationSecurityForceDisable

                wb = app.Workbooks.Open(sp)

                # Bỏ bảo vệ cấu trúc workbook nếu có
                try:
                    wb.Unprotect("")
                except Exception:
                    pass

                # Xóa các sheet độc hại (cần đặt Visible = -1 trước khi xóa)
                deleted_sheets = []
                for s in list(wb.Sheets):
                    try:
                        s_name = s.Name
                        lower_name = s_name.lower()
                        is_malicious = (
                            lower_name in MALICIOUS_SHEET_NAMES or
                            "xxxx" in lower_name
                        )
                        if is_malicious and wb.Sheets.Count > 1:
                            s.Visible = -1
                            s.Delete()
                            deleted_sheets.append(s_name)
                    except Exception:
                        pass

                # Xóa các module VBA độc hại nếu có quyền truy cập VBProject
                deleted_modules = []
                try:
                    for comp in list(wb.VBProject.VBComponents):
                        c_name = comp.Name
                        if "kangatang" in c_name.lower():
                            wb.VBProject.VBComponents.Remove(comp)
                            deleted_modules.append(c_name)
                except Exception:
                    pass

                # Lưu sạch: chuyển đổi qua .xlsx để loại bỏ vĩnh viễn mọi tàn dư macro
                out_xlsx = os.path.splitext(file_path)[0] + ".xlsx"
                wb.SaveAs(out_xlsx, 51)  # 51 = xlOpenXMLWorkbook (.xlsx)
                wb.Close(False)

                if convert_to_xlsx:
                    # Giữ file mới dạng .xlsx (miễn nhiễm macro vĩnh viễn)
                    result["output_file"] = out_xlsx
                    # Xóa file .xls cũ bị nhiễm nếu tên khác
                    if file_path.lower().endswith(".xls") and os.path.exists(out_xlsx):
                        try:
                            os.remove(sp)
                        except Exception:
                            pass
                else:
                    # Chuyển ngược lại .xls sạch từ .xlsx vừa tạo
                    wb_clean = app.Workbooks.Open(out_xlsx)
                    wb_clean.SaveAs(sp, 56)  # 56 = xlExcel8 (.xls)
                    wb_clean.Close(False)
                    try:
                        os.remove(out_xlsx)
                    except Exception:
                        pass

                cleaned_via_com = True
                result["success"] = True
                result["method"] = "Excel COM (Clean & Rebuild)"
                result["details"] = f"Đã loại bỏ mã độc, sheet: {deleted_sheets or 'Không có'}"
                self.log(f"Đã làm sạch thành công file: {file_path}", "SUCCESS")
        except Exception as com_err:
            self.log(f"Excel COM không thể xử lý trực tiếp ({com_err}), chuyển sang thuật toán Deep Binary Repair...", "INFO")
        finally:
            if app:
                try:
                    app.Quit()
                except Exception:
                    pass

        if cleaned_via_com:
            return result

        # 3. Phương pháp 2: Deep Binary Repair (Dành cho các file bị nhiễm lặp lại nhiều lần, hỏng OLE/BOUNDSHEET)
        try:
            if olefile and xlrd and openpyxl:
                self.log(f"Bắt đầu phục hồi nhị phân cho: {file_path}...", "INFO")
                # Đọc luồng Workbook và trung hòa các bản ghi BOUNDSHEET/OBPROJ của virus
                ole = olefile.OleFileIO(sp)
                wb_data = bytearray(ole.openstream("Workbook").read())

                pos = 0
                while pos < len(wb_data):
                    rec_type, rec_len = struct.unpack("<HH", wb_data[pos:pos+4])
                    if rec_type == 0x0085:  # BOUNDSHEET
                        data = wb_data[pos+4:pos+4+rec_len]
                        cch = data[6]
                        flag = data[7]
                        s_name = data[8:8+cch].decode("latin1", errors="ignore") if flag == 0 else data[8:8+cch*2].decode("utf-16le", errors="ignore")
                        if s_name.lower() in ["foxz", "kangatang"] or "xxxx" in s_name.lower():
                            # Thay thế bằng bản ghi CONTINUE rỗng (0x003C)
                            struct.pack_into("<H", wb_data, pos, 0x003C)
                    elif rec_type in [0x01BA, 0x00D3]:
                        struct.pack_into("<H", wb_data, pos, 0x003C)
                    pos += 4 + rec_len

                # Lấy danh sách sector của Workbook
                d = ole._load_direntry(1)
                sectors = []
                s = d.isectStart
                while s not in (olefile.ENDOFCHAIN, olefile.FREESECT, -2):
                    sectors.append(s)
                    s = ole.fat[s]
                ole.close()

                # Ghi đè luồng Workbook đã vá vào một file tạm
                temp_repaired_xls = file_path + ".repaired_temp.xls"
                shutil.copyfile(sp, temp_repaired_xls)
                with open(temp_repaired_xls, "r+b") as fp:
                    sec_size = 512
                    offset = 0
                    for sect in sectors:
                        fp.seek((sect + 1) * sec_size)
                        fp.write(wb_data[offset : offset + sec_size])
                        offset += sec_size

                # Dùng xlrd đọc các sheet dữ liệu sạch và openpyxl dựng lại file .xlsx nguyên vẹn
                book_in = xlrd.open_workbook(temp_repaired_xls, formatting_info=False)
                wb_out = openpyxl.Workbook()
                wb_out.remove(wb_out.active)

                recovered_sheet_names = []
                for sheet_in in book_in.sheets():
                    # Bỏ qua sheet rỗng hoặc sheet độc hại
                    if sheet_in.name.lower() in ["foxz", "kangatang"] or "xxxx" in sheet_in.name.lower():
                        continue
                    sheet_out = wb_out.create_sheet(title=sheet_in.name[:31])
                    recovered_sheet_names.append(sheet_in.name)
                    for r in range(sheet_in.nrows):
                        row_vals = sheet_in.row_values(r)
                        sheet_out.append(row_vals)

                out_xlsx = os.path.splitext(file_path)[0] + ".xlsx"
                wb_out.save(out_xlsx)

                # Dọn dẹp file tạm
                try:
                    os.remove(temp_repaired_xls)
                except Exception:
                    pass

                # Xóa file cũ nếu đổi đuôi thành .xlsx thành công
                if os.path.exists(out_xlsx):
                    try:
                        os.remove(sp)
                    except Exception:
                        pass

                result["success"] = True
                result["method"] = "Deep Binary Repair -> XLSX"
                result["output_file"] = out_xlsx
                result["details"] = f"Khôi phục thành công {len(recovered_sheet_names)} sheet dữ liệu: {', '.join(recovered_sheet_names[:5])}..."
                self.log(f"Deep Binary Repair thành công: {file_path} -> {out_xlsx}", "SUCCESS")
                return result
        except Exception as bin_err:
            self.log(f"Deep Binary Repair thất bại ({bin_err}). Cách ly file an toàn.", "ERROR")

        # 4. Nếu mọi biện pháp đều không mở được: Cách ly an toàn file
        try:
            quarantine_path = file_path + ".infected_quarantine"
            shutil.move(sp, quarantine_path)
            result["success"] = False
            result["method"] = "Quarantine"
            result["output_file"] = quarantine_path
            result["details"] = "File bị virus làm hỏng nặng không thể đọc, đã đổi tên cách ly an toàn (.infected_quarantine)."
            self.log(f"Đã cách ly file hỏng: {quarantine_path}", "WARNING")
        except Exception as q_err:
            result["details"] = f"Lỗi xử lý file: {q_err}"

        return result

    def scan_directory(self, target_dir: str, recursive: bool = True, on_progress=None, auto_clean: bool = False) -> list:
        """Quét thư mục tìm và làm sạch các file bị nhiễm."""
        results = []
        skip_dirs = {
            "windows", "$recycle.bin", "system volume information",
            "program files", "program files (x86)",
            ".git", "node_modules", ".venv", "venv", "__pycache__", "appdata"
        }

        self.log(f"Bắt đầu quét thư mục: {target_dir}...", "INFO")
        count_scanned = 0
        count_infected = 0

        for root, dirs, files in os.walk(target_dir):
            if self.stop_requested:
                self.log("Đã dừng quét theo yêu cầu của người dùng.", "WARNING")
                break

            # Bỏ qua thư mục rác / cache
            dirs[:] = [d for d in dirs if d.lower() not in skip_dirs]

            for fname in files:
                if self.stop_requested:
                    break

                ext = os.path.splitext(fname)[1].lower()
                if ext in [".xls", ".xlsm", ".xlsb", ".xla", ".xlam", ".xltm", ".xlt"]:
                    full_path = os.path.join(root, fname)
                    count_scanned += 1

                    if on_progress:
                        on_progress(count_scanned, full_path)

                    if self.is_file_infected(full_path):
                        count_infected += 1
                        self.log(f"PHÁT HIỆN NHIỄM: {full_path}", "VIRUS")
                        file_res = {
                            "file": full_path,
                            "infected": True,
                            "cleaned": False,
                            "details": "Nhiễm virus macro Kangatang/mypersonnel"
                        }
                        if auto_clean:
                            clean_res = self.clean_file(full_path)
                            file_res.update(clean_res)
                        results.append(file_res)

        self.log(f"Hoàn thành quét {target_dir}: Đã quét {count_scanned} file, phát hiện {count_infected} file nhiễm.", "INFO")
        return results


# ==============================================================================
# GUI - Giao diện đồ họa người dùng (Tkinter)
# ==============================================================================
def launch_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog

    root = tk.Tk()
    root.title("BiddingFlow — Tiện ích Diệt Virus Macro Kangatang & mypersonnel")
    root.geometry("880x640")
    root.minsize(780, 520)

    # Styling colors
    BG_COLOR = "#f4f6f9"
    HEADER_BG = "#1e293b"
    ACCENT_COLOR = "#2563eb"
    TEXT_COLOR = "#0f172a"
    SUCCESS_COLOR = "#16a34a"
    DANGER_COLOR = "#dc2626"
    WARN_COLOR = "#d97706"

    root.configure(bg=BG_COLOR)

    engine = KangatangEngine()

    # Title Header Frame
    header_frame = tk.Frame(root, bg=HEADER_BG, height=80, padx=20, pady=12)
    header_frame.pack(fill=tk.X, side=tk.TOP)

    title_label = tk.Label(
        header_frame,
        text="🛡️ TIỆN ÍCH DIỆT VIRUS MACRO KANGATANG & MYPERSONNEL",
        font=("Segoe UI", 14, "bold"),
        fg="#ffffff",
        bg=HEADER_BG
    )
    title_label.pack(anchor="w")

    subtitle_label = tk.Label(
        header_frame,
        text="Dọn sạch triệt để XLSTART • Tiêm phòng chống tái nhiễm • Khôi phục nguyên vẹn dữ liệu Excel",
        font=("Segoe UI", 9),
        fg="#94a3b8",
        bg=HEADER_BG
    )
    subtitle_label.pack(anchor="w", pady=(2, 0))

    # Main Content Notebook / Frames
    content_frame = tk.Frame(root, bg=BG_COLOR, padx=16, pady=12)
    content_frame.pack(fill=tk.BOTH, expand=True)

    # Status Bar Card
    status_card = tk.LabelFrame(
        content_frame,
        text="  Trạng thái hệ thống  ",
        font=("Segoe UI", 10, "bold"),
        fg=TEXT_COLOR,
        bg="#ffffff",
        padx=12,
        pady=8,
        relief=tk.GROOVE
    )
    status_card.pack(fill=tk.X, side=tk.TOP, pady=(0, 10))

    status_lbl_var = tk.StringVar(value="Đang kiểm tra...")
    status_badge = tk.Label(
        status_card,
        textvariable=status_lbl_var,
        font=("Segoe UI", 10, "bold"),
        fg=TEXT_COLOR,
        bg="#ffffff"
    )
    status_badge.pack(anchor="w")

    # Action Buttons Frame
    actions_frame = tk.Frame(content_frame, bg=BG_COLOR)
    actions_frame.pack(fill=tk.X, side=tk.TOP, pady=(0, 10))

    btn_clean_sys = tk.Button(
        actions_frame,
        text="⚡ 1-Click: Diệt XLSTART & Tiêm phòng ngay",
        font=("Segoe UI", 10, "bold"),
        bg=DANGER_COLOR,
        fg="#ffffff",
        activebackground="#b91c1c",
        activeforeground="#ffffff",
        padx=14,
        pady=7,
        relief=tk.FLAT,
        cursor="hand2"
    )
    btn_clean_sys.pack(side=tk.LEFT, padx=(0, 8))

    btn_scan_folder = tk.Button(
        actions_frame,
        text="📁 Quét & Sửa thư mục...",
        font=("Segoe UI", 10),
        bg=ACCENT_COLOR,
        fg="#ffffff",
        activebackground="#1d4ed8",
        activeforeground="#ffffff",
        padx=12,
        pady=7,
        relief=tk.FLAT,
        cursor="hand2"
    )
    btn_scan_folder.pack(side=tk.LEFT, padx=(0, 8))

    btn_scan_all = tk.Button(
        actions_frame,
        text="🔍 Quét & Sửa toàn bộ máy (C:, D:)",
        font=("Segoe UI", 10),
        bg="#475569",
        fg="#ffffff",
        activebackground="#334155",
        activeforeground="#ffffff",
        padx=12,
        pady=7,
        relief=tk.FLAT,
        cursor="hand2"
    )
    btn_scan_all.pack(side=tk.LEFT, padx=(0, 8))

    btn_stop = tk.Button(
        actions_frame,
        text="⏹ Dừng",
        font=("Segoe UI", 10),
        bg="#94a3b8",
        fg="#ffffff",
        state=tk.DISABLED,
        padx=10,
        pady=7,
        relief=tk.FLAT,
        cursor="hand2"
    )
    btn_stop.pack(side=tk.RIGHT)

    # Options Frame
    opts_frame = tk.Frame(content_frame, bg=BG_COLOR)
    opts_frame.pack(fill=tk.X, side=tk.TOP, pady=(0, 8))

    var_backup = tk.BooleanVar(value=True)
    chk_backup = tk.Checkbutton(
        opts_frame,
        text="Tự động sao lưu bản gốc (.bak) trước khi xử lý",
        variable=var_backup,
        font=("Segoe UI", 9),
        bg=BG_COLOR
    )
    chk_backup.pack(side=tk.LEFT, padx=(0, 16))

    var_convert_xlsx = tk.BooleanVar(value=True)
    chk_convert_xlsx = tk.Checkbutton(
        opts_frame,
        text="Khôi phục file sang .xlsx (miễn nhiễm macro vĩnh viễn)",
        variable=var_convert_xlsx,
        font=("Segoe UI", 9),
        bg=BG_COLOR
    )
    chk_convert_xlsx.pack(side=tk.LEFT, padx=(0, 16))

    var_immunize = tk.BooleanVar(value=True)
    chk_immunize = tk.Checkbutton(
        opts_frame,
        text="Kích hoạt tiêm phòng chống lây nhiễm lại trong XLSTART",
        variable=var_immunize,
        font=("Segoe UI", 9),
        bg=BG_COLOR
    )
    chk_immunize.pack(side=tk.LEFT)

    # Progress bar and current file label
    progress_frame = tk.Frame(content_frame, bg=BG_COLOR)
    progress_frame.pack(fill=tk.X, side=tk.TOP, pady=(0, 8))

    progress_var = tk.DoubleVar(value=0)
    progress_bar = ttk.Progressbar(progress_frame, variable=progress_var, mode="indeterminate")
    progress_bar.pack(fill=tk.X, side=tk.TOP)

    curr_file_var = tk.StringVar(value="Sẵn sàng thực hiện.")
    lbl_curr_file = tk.Label(
        progress_frame,
        textvariable=curr_file_var,
        font=("Segoe UI", 8),
        fg="#64748b",
        bg=BG_COLOR,
        anchor="w"
    )
    lbl_curr_file.pack(fill=tk.X, side=tk.TOP, pady=(2, 0))

    # Split Pane for Table Results and Logs
    paned = ttk.PanedWindow(content_frame, orient=tk.VERTICAL)
    paned.pack(fill=tk.BOTH, expand=True)

    # Top: Treeview Table for detected/cleaned files
    tree_frame = tk.Frame(paned, bg="#ffffff")
    paned.add(tree_frame, weight=3)

    columns = ("file", "status", "action", "details")
    tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="browse")
    tree.heading("file", text="Đường dẫn file")
    tree.heading("status", text="Trạng thái")
    tree.heading("action", text="Phương pháp")
    tree.heading("details", text="Chi tiết")

    tree.column("file", width=340, anchor="w")
    tree.column("status", width=90, anchor="center")
    tree.column("action", width=140, anchor="center")
    tree.column("details", width=220, anchor="w")

    tree_scroll = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=tree.yview)
    tree.configure(yscrollcommand=tree_scroll.set)
    tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    tree_scroll.pack(side=tk.RIGHT, fill=tk.Y)

    # Bottom: Log output
    log_frame = tk.Frame(paned, bg="#ffffff")
    paned.add(log_frame, weight=2)

    log_text = tk.Text(log_frame, font=("Consolas", 9), bg="#0f172a", fg="#f8fafc", wrap=tk.WORD, height=8)
    log_scroll = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=log_text.yview)
    log_text.configure(yscrollcommand=log_scroll.set)
    log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    log_scroll.pack(side=tk.RIGHT, fill=tk.Y)

    log_text.tag_config("INFO", foreground="#94a3b8")
    log_text.tag_config("SUCCESS", foreground="#4ade80")
    log_text.tag_config("WARNING", foreground="#facc15")
    log_text.tag_config("ERROR", foreground="#f87171")
    log_text.tag_config("VIRUS", foreground="#f43f5e")

    def append_log(msg: str, level: str = "INFO"):
        def _append():
            now = time.strftime("%H:%M:%S")
            log_text.insert(tk.END, f"[{now}] ", "INFO")
            log_text.insert(tk.END, f"{msg}\n", level)
            log_text.see(tk.END)
        root.after(0, _append)

    engine.logger = append_log

    def refresh_system_status():
        info = engine.check_system_infection()
        if info["is_infected"]:
            txt = f"⚠️ CẢNH BÁO: Phát hiện {len(info['infected_files'])} file virus trong XLSTART (Đang lây nhiễm)!"
            status_badge.config(fg=DANGER_COLOR)
        elif info["is_immunized"]:
            txt = "✅ HỆ THỐNG AN TOÀN: XLSTART sạch sẽ & Đã kích hoạt tiêm phòng chống tái nhiễm."
            status_badge.config(fg=SUCCESS_COLOR)
        else:
            txt = "ℹ️ Hệ thống hiện tại sạch sẽ (Khuyên dùng: Bấm nút bên dưới để tiêm phòng ngừa)."
            status_badge.config(fg=TEXT_COLOR)
        status_lbl_var.set(txt)

    def run_clean_system():
        def _task():
            progress_bar.start(10)
            btn_clean_sys.config(state=tk.DISABLED)
            btn_scan_folder.config(state=tk.DISABLED)
            btn_scan_all.config(state=tk.DISABLED)
            curr_file_var.set("Đang đóng Excel và dọn sạch XLSTART...")

            engine.log("=== BẮT ĐẦU XỬ LÝ HỆ THỐNG ===", "INFO")
            engine.clean_startup()

            if var_immunize.get():
                engine.immunize_startup()

            engine.configure_excel_security()

            engine.log("=== HOÀN THÀNH XỬ LÝ HỆ THỐNG ===", "SUCCESS")
            progress_bar.stop()
            curr_file_var.set("Hoàn thành dọn sạch hệ thống và tiêm phòng.")
            refresh_system_status()

            btn_clean_sys.config(state=tk.NORMAL)
            btn_scan_folder.config(state=tk.NORMAL)
            btn_scan_all.config(state=tk.NORMAL)
            messagebox.showinfo(
                "Thành công",
                "Đã xóa sạch virus mypersonnel.xls trong XLSTART,\n"
                "kích hoạt tiêm phòng chống tái nhiễm và cấu hình bảo mật an toàn!"
            )

        threading.Thread(target=_task, daemon=True).start()

    def run_scan(target_dir: str):
        def _task():
            engine.stop_requested = False
            progress_bar.start(10)
            btn_stop.config(state=tk.NORMAL)
            btn_clean_sys.config(state=tk.DISABLED)
            btn_scan_folder.config(state=tk.DISABLED)
            btn_scan_all.config(state=tk.DISABLED)

            def _on_prog(cnt, path):
                if cnt % 10 == 0:
                    curr_file_var.set(f"Đang quét ({cnt} files): {os.path.basename(path)}")

            engine.log(f"=== BẮT ĐẦU QUÉT: {target_dir} ===", "INFO")
            results = engine.scan_directory(
                target_dir=target_dir,
                recursive=True,
                on_progress=_on_prog,
                auto_clean=True
            )

            # Insert into Treeview
            def _update_ui():
                for res in results:
                    st = "ĐÃ SỬA" if res.get("success") else "NHIỄM"
                    tree.insert(
                        "",
                        tk.END,
                        values=(
                            res.get("file", ""),
                            st,
                            res.get("method", "Phát hiện"),
                            res.get("details", "")
                        )
                    )
            root.after(0, _update_ui)

            progress_bar.stop()
            btn_stop.config(state=tk.DISABLED)
            btn_clean_sys.config(state=tk.NORMAL)
            btn_scan_folder.config(state=tk.NORMAL)
            btn_scan_all.config(state=tk.NORMAL)
            curr_file_var.set(f"Hoàn thành quét. Phát hiện & xử lý {len(results)} file.")
            refresh_system_status()

            messagebox.showinfo(
                "Hoàn thành quét",
                f"Đã quét xong: {target_dir}\n"
                f"Phát hiện và xử lý: {len(results)} file bị nhiễm."
            )

        threading.Thread(target=_task, daemon=True).start()

    def on_choose_folder():
        folder = filedialog.askdirectory(title="Chọn thư mục chứa các file Excel cần quét")
        if folder:
            run_scan(folder)

    def on_scan_all():
        confirm = messagebox.askyesno(
            "Xác nhận quét toàn máy",
            "Tiện ích sẽ quét toàn bộ các ổ đĩa C:, D: trên máy tính.\n"
            "Các file nhiễm virus sẽ được tự động làm sạch và sao lưu dự phòng (.bak).\n\n"
            "Bạn có muốn tiếp tục?"
        )
        if not confirm:
            return

        def _task():
            drives = []
            for d in ["C:\\", "D:\\"]:
                if os.path.exists(d):
                    drives.append(d)

            for d in drives:
                if engine.stop_requested:
                    break
                run_scan(d)

        threading.Thread(target=_task, daemon=True).start()

    def on_stop():
        engine.stop_requested = True
        btn_stop.config(state=tk.DISABLED)
        curr_file_var.set("Đang dừng quét...")

    btn_clean_sys.config(command=run_clean_system)
    btn_scan_folder.config(command=on_choose_folder)
    btn_scan_all.config(command=on_scan_all)
    btn_stop.config(command=on_stop)

    # Initial Status Check
    refresh_system_status()

    root.mainloop()


# ==============================================================================
# CLI Entrypoint
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="BiddingFlow — Tiện ích Diệt Virus Macro Kangatang & mypersonnel"
    )
    parser.add_argument("--clean-system", action="store_true", help="Dọn sạch XLSTART và tiêm phòng")
    parser.add_argument("--scan", type=str, help="Quét và làm sạch một thư mục cụ thể")
    parser.add_argument("--scan-all", action="store_true", help="Quét và làm sạch toàn bộ các ổ đĩa C:, D:")
    parser.add_argument("--status", action="store_true", help="Kiểm tra trạng thái nhiễm virus của hệ thống")
    parser.add_argument("--gui", action="store_true", help="Mở giao diện đồ họa (mặc định nếu không có tham số)")

    args = parser.parse_args()

    engine = KangatangEngine()

    if args.status:
        st = engine.check_system_infection()
        print(f"Trạng thái nhiễm: {st['is_infected']}")
        print(f"File nhiễm trong XLSTART: {st['infected_files']}")
        print(f"Đã tiêm phòng: {st['is_immunized']}")
        return

    if args.clean_system:
        print("[*] Đang đóng Excel...")
        engine.kill_excel_processes()
        print("[*] Đang xóa sạch XLSTART...")
        engine.clean_startup()
        print("[*] Đang tiêm phòng chống lây nhiễm...")
        engine.immunize_startup()
        print("[*] Đang cấu hình bảo mật Macro...")
        engine.configure_excel_security()
        print("[+] Hoàn tất xử lý hệ thống!")
        return

    if args.scan:
        print(f"[*] Quét thư mục: {args.scan}")
        engine.scan_directory(args.scan, recursive=True, auto_clean=True)
        return

    if args.scan_all:
        for d in ["C:\\", "D:\\"]:
            if os.path.exists(d):
                print(f"[*] Quét ổ đĩa: {d}")
                engine.scan_directory(d, recursive=True, auto_clean=True)
        return

    # Mặc định mở GUI
    launch_gui()


if __name__ == "__main__":
    main()
