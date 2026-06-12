import urllib.request
import urllib.parse
import json
import re
import os

BASE_URL = "http://127.0.0.1:8000"
LOG_FILE = "sync_error.log"

def post_json(url, data):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))

def get_latest_otp():
    if not os.path.exists(LOG_FILE):
        return None
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    
    matches = re.findall(r'<span style="font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 4px;">(\d+)</span>', content)
    if matches:
        return matches[-1]
    return None

def get_latest_temp_password():
    if not os.path.exists(LOG_FILE):
        return None
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    
    matches = re.findall(r'<span style="font-size: 22px; font-weight: bold; color: #991b1b; letter-spacing: 2px;">([a-f0-9]+)</span>', content)
    if matches:
        return matches[-1]
    return None

def main():
    print("--- 1. Testing Registration ---")
    reg_payload = {
        "username": "testuser_verif_" + str(int(os.getpid())),
        "password": "mypassword123",
        "name": "Test OTP User",
        "email": "testotp@example.com"
    }
    
    status, res_data = post_json(f"{BASE_URL}/api/auth/register", reg_payload)
    print("Reg Status Code:", status)
    print("Reg Response:", res_data)
    
    if status != 200:
        return
            
    print("\n--- 2. Fetching OTP from Log ---")
    otp = get_latest_otp()
    print("Extracted OTP:", otp)
    if not otp:
        print("Failed to find OTP in log file!")
        return
        
    print("\n--- 3. Testing Verify Email ---")
    verify_payload = {
        "username": reg_payload["username"],
        "code": otp
    }
    status, res_data = post_json(f"{BASE_URL}/api/auth/verify", verify_payload)
    print("Verify Status Code:", status)
    print("Verify Response:", res_data)
    
    print("\n--- 4. Testing Login ---")
    login_payload = {
        "username": reg_payload["username"],
        "password": "mypassword123"
    }
    status, res_data = post_json(f"{BASE_URL}/api/auth/login", login_payload)
    print("Login Status Code:", status)
    print("Login Response Valid:", "success" in res_data)
    
    print("\n--- 5. Testing Forgot Password ---")
    forgot_payload = {
        "username": reg_payload["username"],
        "email": "testotp@example.com"
    }
    status, res_data = post_json(f"{BASE_URL}/api/auth/forgot-password", forgot_payload)
    print("Forgot Status Code:", status)
    print("Forgot Response:", res_data)
    
    print("\n--- 6. Fetching Temporary Password from Log ---")
    temp_pwd = get_latest_temp_password()
    print("Extracted Temp Password:", temp_pwd)
    if not temp_pwd:
        print("Failed to find temporary password in log file!")
        return
        
    print("\n--- 7. Testing Login with Temporary Password ---")
    login_payload["password"] = temp_pwd
    status, res_data = post_json(f"{BASE_URL}/api/auth/login", login_payload)
    print("Temp Password Login Status Code:", status)
    print("Temp Password Login Response Valid:", "success" in res_data)

if __name__ == "__main__":
    main()
