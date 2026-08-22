from backend.app import app
from backend.auth.username_validator import validate_username


def test_word_publication_spa_route_is_registered():
    registrations = {
        (route.path, tuple(sorted(getattr(route, "methods", None) or ())))
        for route in app.routes
    }
    assert ("/xuat-ban-word", ("GET", "HEAD")) in registrations


def test_word_publication_template_assignment_api_is_registered():
    registrations = {
        (route.path, tuple(sorted(getattr(route, "methods", None) or ())))
        for route in app.routes
    }
    assert (
        "/api/word-publication-template-assignments",
        ("GET", "HEAD"),
    ) in registrations
    assert (
        "/api/word-publication-template-assignments",
        ("PUT",),
    ) in registrations


def test_word_publication_route_is_reserved_from_usernames():
    valid, message = validate_username("xuat_ban_word")
    assert valid is False
    assert "hệ thống" in message.lower()
