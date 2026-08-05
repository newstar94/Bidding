from backend.sync.serializer import iter_sync_table_payloads


def test_sync_orders_incoming_rebid_source_before_dependent_package():
    source = {"id": "cancelled-copy", "trangThai": "CANCELLED"}
    rebid = {
        "id": "rebid-copy",
        "rebidFromPackageId": "cancelled-copy",
    }

    payloads = list(iter_sync_table_payloads({"goithau": [rebid, source]}))

    assert [item["id"] for item in payloads[0][2]] == [
        "cancelled-copy",
        "rebid-copy",
    ]
