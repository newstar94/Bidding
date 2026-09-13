"""Local HTTPS contract verifier for the BiddingFlow -> Chuẩn Hóa seam."""

from __future__ import annotations

import asyncio
import os

from backend.integrations.chuan_hoa import ChuanHoaAdminClient, ChuanHoaIntegrationSettings


async def main() -> None:
    settings = ChuanHoaIntegrationSettings(
        base_url=os.environ["CHUAN_HOA_ADMIN_BASE_URL"],
        client_id=os.environ["CHUAN_HOA_ADMIN_CLIENT_ID"],
        shared_secret=os.environ["CHUAN_HOA_ADMIN_SHARED_SECRET"],
        mapped_user_ids=frozenset(),
        timeout_seconds=5,
        enabled=True,
        ca_bundle=os.environ["CHUAN_HOA_ADMIN_CA_BUNDLE"],
    )
    client = ChuanHoaAdminClient(settings)
    capabilities = await client.capabilities()
    assert capabilities["schema"] == "chuanhoa.admin.integration.v1"
    assert capabilities["application"] == "chuan-hoa"
    audit = await client.read_collection("audit", page=1, page_size=25)
    assert audit["schema"] == "chuanhoa.admin.integration.v1"
    mutation = await client.extend_entitlement(
        {
            "userId": "11111111-1111-1111-1111-111111111111",
            "productId": "22222222-2222-2222-2222-222222222222",
            "featureCodes": ["feature.contract"],
            "durationDays": 30,
            "reason": "local HTTPS contract verification",
            "actorId": "bidding-admin-e2e",
            "correlationId": "33333333-3333-3333-3333-333333333333",
        },
        "https-contract-00000001",
    )
    assert mutation["application"] == "chuan-hoa"
    assert mutation["data"]["status"] == "ACTIVE"
    print("CHUAN-HOA-HTTPS-CONTRACT=PASS")


if __name__ == "__main__":
    asyncio.run(main())
