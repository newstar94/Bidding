import warnings
# Suppress StarletteDeprecationWarning about httpx
warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient` is deprecated")

# pyrefly: ignore [missing-import]
import pytest
from starlette.testclient import TestClient
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../helpers_py')))

from app import app

client = TestClient(app)

def test_login_api_failure():
    """Kiểm tra API đăng nhập thất bại khi sai tài khoản/mật khẩu"""
    response = client.post("/api/auth/login", json={
        "username": "wrong_user",
        "password": "wrong_password"
    })
    assert response.status_code == 400
    assert "error" in response.json()
