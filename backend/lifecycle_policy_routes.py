from starlette.responses import JSONResponse

from backend.shared.lifecycle_policy import lifecycle_contract


async def lifecycle_policy_api(_request):
    return JSONResponse(
        lifecycle_contract(),
        headers={"Cache-Control": "public, max-age=300"},
    )


def lifecycle_policy_routes(Route):
    return [Route("/api/contracts/package-lifecycle", lifecycle_policy_api, methods=["GET"])]
