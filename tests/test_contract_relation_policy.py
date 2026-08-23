from backend.versioning.relation_policy import load_contracts_for_package_lineage
from backend.documents import docx_service


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.statement = ""
        self.params = None

    def execute(self, statement, params):
        self.statement = " ".join(statement.split())
        self.params = params
        return _Result(self.rows)


def test_effective_contract_projection_deduplicates_with_exact_precedence():
    cursor = _Cursor([
        {"id": "contract-a", "package_relation": "exact", "relation_rank": 1},
        {"id": "contract-b", "package_relation": "lineage-derived", "relation_rank": 1},
    ])

    contracts = load_contracts_for_package_lineage(cursor, "org", "package")

    assert [row["id"] for row in contracts] == ["contract-a", "contract-b"]
    assert contracts[0]["package_relation"] == "exact"
    assert "ROW_NUMBER() OVER" in cursor.statement
    assert "PARTITION BY contract.id" in cursor.statement
    assert "relation_rank = 1" in cursor.statement
    assert cursor.params == ("org", "package")


def test_contract_relation_order_has_deterministic_tie_breakers():
    cursor = _Cursor([])
    load_contracts_for_package_lineage(cursor, "org", "package")

    assert "(link.goi_thau_id = package.id) DESC" in cursor.statement
    assert "linked_package.is_latest DESC" in cursor.statement
    assert "linked_package.phien_ban DESC" in cursor.statement
    assert "linked_package.id DESC" in cursor.statement
    assert "contract.id" in cursor.statement


def test_docx_contract_context_keeps_all_latest_linked_contracts(monkeypatch):
    monkeypatch.setattr(
        docx_service,
        "load_contracts_for_package_lineage",
        lambda *_args: [
            {"id": "contract-a", "is_latest": 1, "phan_loai": "Thẩm định"},
            {"id": "contract-a-old", "is_latest": 0, "phan_loai": "Thẩm định"},
            {"id": "contract-b", "is_latest": 1, "phan_loai": "Tư vấn"},
        ],
        raising=False,
    )

    contracts = docx_service.load_current_contracts_for_package(
        object(),
        "org",
        "package",
    )

    assert [item["id"] for item in contracts] == ["contract-a", "contract-b"]
