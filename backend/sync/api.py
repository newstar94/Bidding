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


async def restore_record_api(request):
    from backend.sync.restore_service import process_restore_request
    return await process_restore_request(request, broadcast_websocket_event)


async def get_all_data_api(request):
    from backend.sync.read_service import read_sync_data
    return await read_sync_data(request)


async def delta_sync_api(request):
    from backend.sync.delta_paging import read_delta_page
    return await read_delta_page(request)


async def record_api(request):
    from backend.sync.read_service import read_single_record
    return await read_single_record(request)


async def paginate_api(request):
    from backend.sync.pagination import paginate_records
    return await paginate_records(request)


async def current_sync_version_api(request):
    from backend.sync.version_api import current_sync_version_api as read_version
    return await read_version(request)


def sync_http_routes(Route):
    return [
        Route("/api/sync", sync_api, methods=["POST"]),
        Route("/api/sync/restore", restore_record_api, methods=["POST"]),
        Route("/api/sync/delta", delta_sync_api, methods=["GET"]),
        Route("/api/sync-version", current_sync_version_api, methods=["GET"]),
        Route("/api/paginate", paginate_api, methods=["GET"]),
        Route("/api/record", record_api, methods=["GET"]),
        Route("/api/get-all-data", get_all_data_api, methods=["GET"]),
    ]


__all__ = [
    "active_connections",
    "broadcast_websocket_event",
    "current_sync_version_api",
    "delta_sync_api",
    "disconnect_user_websockets",
    "get_all_data_api",
    "paginate_api",
    "record_api",
    "restore_record_api",
    "sync_api",
    "sync_http_routes",
    "sync_websocket_endpoint",
]
