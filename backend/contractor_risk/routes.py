"""Owner-scoped HTTP interface for bid-opening contractor risk resolution."""

from __future__ import annotations

from dataclasses import dataclass
import os

from starlette.responses import JSONResponse

from backend.contractor_risk.repository import ContractorRiskRepository
from backend.contractor_risk.service import ContractorRiskService
from backend.integrations.vneps import VnepsContractorProvider, VnepsViolationProvider
from backend.integrations.vneps.fake_provider import FixtureViolationProvider
from backend.shared.access_policy import authorize_record_write
from backend.shared.async_io import BlockingIOBusyError
from backend.shared.database_io import run_database_write
from backend.shared.helpers import OrgPermissionError, clean_id, database, get_active_org, verify_session
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.request_validation import read_json_object, validate_or_response


@dataclass(frozen=True, slots=True)
class ContractorRiskRouteError(RuntimeError):
    code: str
    message: str
    status_code: int

    def __str__(self):
        return self.message


def build_contractor_provider():
    return VnepsContractorProvider()


def build_violation_provider():
    fixture_path = str(os.environ.get("VNEPS_VIOLATION_FIXTURE_PATH", "")).strip()
    if fixture_path:
        if str(os.environ.get("APP_ENV", "")).strip().casefold() == "production":
            raise RuntimeError("VNEPS violation fixtures are forbidden in production")
        return FixtureViolationProvider(fixture_path)
    return VnepsViolationProvider()


def _resolve_blocking(request, package_id: str, payload: dict):
    valid, session = verify_session(request)
    if not valid:
        raise ContractorRiskRouteError("AUTHENTICATION_REQUIRED", str(session), 401)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN")
        organization_id = get_active_org(request, session.user_id, cursor=cursor)
        package_id = clean_id(package_id)
        if not package_id:
            raise ContractorRiskRouteError(
                "PACKAGE_ID_INVALID", "MÃ£ gÃ³i tháº§u khÃ´ng há»£p lá»‡.", 400
            )
        decision = authorize_record_write(
            cursor,
            session,
            session.user_id,
            organization_id,
            "goithau",
            "goi_thau",
            {"id": package_id},
        )
        if not decision.allowed:
            raise ContractorRiskRouteError(
                "BID_OPENING_WRITE_DENIED",
                "KhÃ´ng cÃ³ quyá»n chá»‰nh sá»­a biÃªn báº£n má»Ÿ tháº§u cá»§a gÃ³i tháº§u nÃ y.",
                403,
            )
        repository = ContractorRiskRepository(connection)
        try:
            context = repository.load_resolution_context(
                organization_id=organization_id,
                package_id=package_id,
                opening_id=clean_id(payload.get("bidOpeningRecordId")),
                member_id=clean_id(payload.get("jointVentureMemberId")),
                requested_identifier=payload["contractorIdentifier"],
                lot_id=clean_id(payload.get("lotId")),
            )
        except LookupError as error:
            code = str(error)
            status = 404 if code in {
                "PACKAGE_NOT_FOUND",
                "BID_OPENING_NOT_FOUND",
                "JOINT_VENTURE_MEMBER_NOT_FOUND",
                "LOT_NOT_FOUND",
            } else 400
            raise ContractorRiskRouteError(
                code,
                "KhÃ´ng tÃ¬m tháº¥y pháº¡m vi biÃªn báº£n má»Ÿ tháº§u tÆ°Æ¡ng á»©ng.",
                status,
            ) from error
        resolution = ContractorRiskService(
            repository,
            build_contractor_provider(),
            build_violation_provider(),
        ).resolve(
            context,
            actor_user_id=session.user_id,
            request=request,
        )
        connection.commit()
        return {
            "contractor": resolution.contractor,
            "violationStatus": resolution.violation_status.value,
            "bidClosingAt": resolution.bid_closing_at,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def resolve_bid_opening_contractor(request):
    payload, invalid_json = await read_json_object(request)
    if invalid_json:
        return invalid_json
    validation_error = validate_or_response(
        request,
        payload,
        {
            "contractorIdentifier": {
                "type": "string",
                "required": True,
                "min_length": 1,
                "max_length": 128,
            },
            "lotId": {"type": "string", "nullable": True, "max_length": 128},
            "bidOpeningRecordId": {
                "type": "string",
                "nullable": True,
                "max_length": 128,
            },
            "jointVentureId": {
                "type": "string",
                "nullable": True,
                "max_length": 128,
            },
            "jointVentureMemberId": {
                "type": "string",
                "nullable": True,
                "max_length": 128,
            },
        },
    )
    if validation_error:
        return validation_error
    try:
        result = await run_database_write(
            _resolve_blocking,
            request,
            request.path_params.get("package_id", ""),
            payload,
        )
        return JSONResponse(result)
    except ContractorRiskRouteError as error:
        return error_response(
            request,
            error.code,
            error.message,
            status_code=error.status_code,
        )
    except OrgPermissionError:
        return error_response(
            request,
            "ORGANIZATION_ACCESS_DENIED",
            "KhÃ´ng cÃ³ quyá»n truy cáº­p tá»• chá»©c nÃ y.",
            status_code=403,
        )
    except BlockingIOBusyError:
        response = error_response(
            request,
            "CONTRACTOR_RISK_BUSY",
            "Dá»‹ch vá»¥ tra cá»©u Ä‘ang báº­n. Vui lÃ²ng thá»­ láº¡i sau.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    except Exception as error:  # noqa: BLE001 -- sanitize the HTTP boundary response.
        return log_and_error(
            request,
            error,
            "resolve_bid_opening_contractor",
            "CONTRACTOR_RISK_LOOKUP_FAILED",
            "KhÃ´ng thá»ƒ tra cá»©u nhÃ  tháº§u lÃºc nÃ y.",
            status_code=503,
        )


def contractor_risk_routes(Route):
    return [
        Route(
            "/api/packages/{package_id}/bid-opening/contractors/resolve",
            resolve_bid_opening_contractor,
            methods=["POST"],
        )
    ]
