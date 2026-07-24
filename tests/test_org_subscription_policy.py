from backend.api import org_routes


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((" ".join(sql.split()), parameters))
        return _Result(
            {
                "organization_id": "org-1",
                "package_id": "package-1",
                "status": "active",
                "starts_at": 1,
                "expires_at": 2,
                "member_quota": 5,
                "revision": 1,
                "member_count": 2,
            }
        )


def test_subscription_payload_can_lock_the_subscription_row() -> None:
    cursor = _Cursor()

    payload = org_routes._subscription_payload(
        cursor, "org-1", for_update=True
    )

    assert payload["organization_id"] == "org-1"
    assert "FOR UPDATE OF sub" in cursor.calls[0][0]
