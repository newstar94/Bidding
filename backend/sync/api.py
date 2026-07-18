"""HTTP route adapters for the synchronization domain."""

from backend.sync.websocket import (
    active_connections,
    broadcast_websocket_event,
    disconnect_user_websockets,
    sync_websocket_endpoint,
)


async def sync_api(request):
    from backend.sync.service import process_sync_request
    return await process_sync_request(request, broadcast_websocket_event)


async def get_all_data_api(request):
    from backend.sync.read_service import read_sync_data
    return await read_sync_data(request)


async def record_api(request):
    from backend.sync.read_service import read_single_record
    return await read_single_record(request)


async def paginate_api(request):
    from backend.sync.pagination import paginate_records
    return await paginate_records(request)


async def current_sync_version_api(request):
    from backend.sync.version_api import current_sync_version_api as read_version
    return await read_version(request)


__all__ = [
    "active_connections",
    "broadcast_websocket_event",
    "current_sync_version_api",
    "disconnect_user_websockets",
    "get_all_data_api",
    "paginate_api",
    "record_api",
    "sync_api",
    "sync_websocket_endpoint",
]
