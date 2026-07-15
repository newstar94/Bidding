from starlette.testclient import TestClient

from backend.app import app


def test_homepage_serves_compiled_html():
    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "BiddingFlow" in response.text
    assert 'id="form-auth-login"' in response.text
    assert '<body class="bf-init-loading">' in response.text
    assert 'href="/css/initial-route.css?v=1.0"' in response.text
    assert "<style" not in response.text
    assert 'id="initial-route-loading-state"' in response.text
    assert 'src="/vendor/initial-route.js?v=1.0.2"' in response.text
    assert 'role="progressbar"' in response.text
    assert '__BF_SESSION_BOOTSTRAP__' not in response.text
    assert 'id="bf-session-bootstrap"' in response.text
    assert '"valid":false' in response.text
    assert "session-bootstrap" in response.headers["server-timing"]
    assert response.headers["vary"] == "Cookie"
    assert response.headers["x-content-type-options"] == "nosniff"
    csp = response.headers["content-security-policy"]
    assert "style-src 'self' https://fonts.googleapis.com" in csp
    assert "style-src-elem 'self'" in csp
    assert "style-src-attr 'unsafe-inline'" in csp
    assert "style-src 'self' 'unsafe-inline'" not in csp
    assert "require-trusted-types-for 'script'" in response.headers["content-security-policy-report-only"]


def test_holidays_api_returns_json_object():
    with TestClient(app) as client:
        response = client.get("/api/holidays")

    assert response.status_code == 200
    assert "application/json" in response.headers["content-type"]
    assert isinstance(response.json(), dict)


def test_check_session_without_cookie_is_anonymous():
    with TestClient(app) as client:
        response = client.post("/api/auth/check-session", json={"remember": False})

    assert response.status_code == 200
    assert response.json() == {"valid": False, "reason": "missing_auth"}
