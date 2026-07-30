"""Domain rules shared by package and bidder-goods synchronization."""


GOODS_WORKFLOW_FIELDS = frozenset({"Hàng hóa", "Hỗn hợp"})


def supports_goods_workflow(field):
    """Return whether a procurement field carries a goods workflow."""
    return str(field or "").strip() in GOODS_WORKFLOW_FIELDS
