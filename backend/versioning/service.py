"""HTTP orchestration for server-authoritative aggregate version creation."""

from starlette.responses import JSONResponse

from backend.shared.async_io import BlockingIOBusyError
from backend.shared.database_io import run_database_write
from backend.shared.request_validation import read_json_object
from backend.sync.service import execute_sync_mutation


async def process_aggregate_version_request(request, broadcast_callback=None):
    command, json_error = await read_json_object(request)
    if json_error:
        return json_error
    try:
        return await run_database_write(
            execute_sync_mutation,
            request,
            command,
            broadcast_callback,
            aggregate_version_command=True,
        )
    except BlockingIOBusyError:
        response = JSONResponse(
            {
                "code": "DATABASE_WRITE_QUEUE_FULL",
                "error": "Hệ thống đang xử lý quá nhiều thay đổi. Vui lòng thử lại sau.",
            },
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
