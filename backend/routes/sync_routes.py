"""HTTP route adapters for the synchronization domain."""

from sync.websocket import (
    active_connections,
    broadcast_websocket_event,
    disconnect_user_websockets,
    sync_websocket_endpoint,
)


async def sync_api(request):
    from sync.service import process_sync_request
    return await process_sync_request(request, broadcast_websocket_event)


async def get_all_data_api(request):
    from sync.read_service import read_sync_data
    return await read_sync_data(request)


async def record_api(request):
    from sync.read_service import read_single_record
    return await read_single_record(request)


async def paginate_api(request):
    from sync.pagination import paginate_records
    return await paginate_records(request)


__all__ = [
    "active_connections",
    "broadcast_websocket_event",
    "disconnect_user_websockets",
    "get_all_data_api",
    "paginate_api",
    "record_api",
    "sync_api",
    "sync_websocket_endpoint",
]
