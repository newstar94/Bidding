"""PreviewStore stays bounded in memory without changing preview semantics."""

from datetime import datetime, timedelta, timezone
from threading import Thread

import pytest

from backend.procurement_import.service import PreviewStore


def _put(store, user="u1", org="org-1", lease="lease-1", payload=None):
    return store.put(
        payload or {"kind": "plan"},
        organization_id=org,
        user_id=user,
        workspace_lease=lease,
    )


def _get(store, stored, **overrides):
    scope = {
        "organization_id": stored.organization_id,
        "user_id": stored.user_id,
        "workspace_lease": stored.workspace_lease,
    }
    scope.update(overrides)
    return store.get(stored.preview_id, **scope)


def test_per_user_cap_evicts_that_users_oldest_preview_as_expired():
    store = PreviewStore(max_items=50, max_per_user=2)
    first, second, third = (_put(store) for _ in range(3))
    other_user = _put(store, user="u2")

    with pytest.raises(LookupError, match="PROCUREMENT_PREVIEW_EXPIRED"):
        _get(store, first)
    assert _get(store, second) is second
    assert _get(store, third) is third
    assert _get(store, other_user) is other_user
    assert store.evictions == 1


def test_global_cap_evicts_least_recently_used_preview():
    store = PreviewStore(max_items=3, max_per_user=3)
    a = _put(store, user="a")
    b = _put(store, user="b")
    c = _put(store, user="c")
    _get(store, a)  # a becomes most recently used
    d = _put(store, user="d")

    assert len(store) == 3
    with pytest.raises(LookupError):
        _get(store, b)
    for stored in (a, c, d):
        assert _get(store, stored) is stored


def test_scope_and_ttl_semantics_are_unchanged():
    store = PreviewStore(ttl_seconds=120)
    stored = _put(store)
    with pytest.raises(PermissionError, match="PROCUREMENT_PREVIEW_SCOPE_INVALID"):
        _get(store, stored, user_id="intruder")
    later = datetime.now(timezone.utc) + timedelta(seconds=121)
    with pytest.raises(LookupError, match="PROCUREMENT_PREVIEW_EXPIRED"):
        store.get(
            stored.preview_id,
            organization_id=stored.organization_id,
            user_id=stored.user_id,
            workspace_lease=stored.workspace_lease,
            now=later,
        )
    assert len(store) == 0


def test_periodic_sweep_drops_expired_entries_on_reads():
    store = PreviewStore(ttl_seconds=1, max_items=100, max_per_user=100)
    stale = [_put(store, user=f"user-{index}") for index in range(10)]
    fresh = _put(store, user="fresh")
    later = datetime.now(timezone.utc) + timedelta(seconds=5)
    for _ in range(PreviewStore._SWEEP_EVERY):
        with pytest.raises(LookupError):
            store.get(
                fresh.preview_id,
                organization_id=fresh.organization_id,
                user_id=fresh.user_id,
                workspace_lease=fresh.workspace_lease,
                now=later,
            )
    assert all(item.preview_id not in store._items for item in stale)


def test_concurrent_puts_respect_bounds():
    store = PreviewStore(max_items=20, max_per_user=3)

    def worker(index):
        for _ in range(25):
            _put(store, user=f"user-{index % 4}")

    threads = [Thread(target=worker, args=(index,)) for index in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(store) <= 12
    per_user = {}
    for item in store._items.values():
        per_user[item.user_id] = per_user.get(item.user_id, 0) + 1
    assert max(per_user.values()) <= 3
