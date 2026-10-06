"""Translate bounded database lane failures at HTTP route boundaries."""

from backend.shared.async_io import BlockingIOTimeoutError
from backend.shared.logging_utils import error_response


def database_unavailable_response(request, exception, *, write=False):
    timed_out = isinstance(exception, BlockingIOTimeoutError)
    lane = "WRITE" if write else "READ"
    response = error_response(
        request,
        f"DATABASE_{lane}_TIMEOUT" if timed_out else f"DATABASE_{lane}_QUEUE_FULL",
        "Truy vấn dữ liệu vượt quá thời gian cho phép. Vui lòng thử lại."
        if timed_out
        else "Hệ thống đang xử lý nhiều yêu cầu. Vui lòng thử lại sau.",
        status_code=503,
    )
    response.headers["Retry-After"] = "1"
    return response
