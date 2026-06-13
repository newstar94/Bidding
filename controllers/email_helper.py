import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_SENDER = os.environ.get("SMTP_SENDER", SMTP_USER)

def gui_email(email_nhan, tieu_de, noi_dung_html):
    # Dynamic import to avoid circular dependency
    try:
        from helpers import log_error
    except ImportError:
        def log_error(msg, context="System"):
            print(f"[{context}] {msg}")

    if not SMTP_USER or not SMTP_PASSWORD:
        msg = f"[MOCK MAIL] Gửi tới: {email_nhan}\nTiêu đề: {tieu_de}\nNội dung:\n{noi_dung_html}\n"
        log_error(msg, context="EmailMock")
        return True
    
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_SENDER
        msg['To'] = email_nhan
        msg['Subject'] = tieu_de
        msg.attach(MIMEText(noi_dung_html, 'html', 'utf-8'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_SENDER, email_nhan, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        log_error(f"Lỗi gửi email tới {email_nhan}: {str(e)}", context="EmailSender")
        return False
