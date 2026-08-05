"""Public error contract for the AI gateway."""

from __future__ import annotations


class AiError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class AiProviderError(AiError):
    pass


class AiToolError(AiError):
    pass


ERROR_STATUS = {
    "AI_DISABLED": 404,
    "AI_AUTH_REQUIRED": 401,
    "AI_PERMISSION_DENIED": 403,
    "AI_ENTITLEMENT_REQUIRED": 403,
    "AI_CONVERSATION_NOT_FOUND": 404,
    "AI_CONVERSATION_SCOPE_MISMATCH": 409,
    "AI_SCOPE_VALIDATION_FAILED": 403,
    "AI_INVALID_MESSAGE": 422,
    "AI_RATE_LIMITED": 429,
    "AI_QUOTA_EXCEEDED": 429,
    "AI_PROVIDER_UNAVAILABLE": 503,
    "AI_PROVIDER_TIMEOUT": 504,
    "AI_TOOL_NOT_ALLOWED": 403,
    "AI_TOOL_INVALID_ARGUMENTS": 422,
    "AI_QUERY_TOO_BROAD": 422,
    "AI_UNSUPPORTED_DATE_FIELD": 422,
    "AI_UNSUPPORTED_GROUP_BY": 422,
    "AI_TOOL_TIMEOUT": 504,
    "AI_TOOL_FAILED": 502,
    "AI_DATA_UNAVAILABLE": 503,
    "AI_SOURCE_UNAVAILABLE": 503,
    "AI_UNSUPPORTED_MODE": 422,
}


def ai_error(code: str, message: str) -> AiError:
    return AiError(code, message, ERROR_STATUS.get(code, 500))
