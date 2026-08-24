"""Small orchestration boundary for authorized version comparison."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from backend.version_comparison.diff_kernel import compare_snapshots
from backend.version_comparison.errors import VersionComparisonError


_IMPACT_EXECUTOR = ThreadPoolExecutor(
    max_workers=4,
    thread_name_prefix="version-comparison-impact",
)


class VersionComparisonService:
    def __init__(
        self,
        repository,
        *,
        impact_providers=(),
        provider_timeout_seconds=1.0,
        impact_executor=None,
    ):
        self.repository = repository
        self.impact_providers = tuple(impact_providers)
        self.provider_timeout_seconds = max(float(provider_timeout_seconds), 0.001)
        self.impact_executor = impact_executor or _IMPACT_EXECUTOR

    def compare(
        self,
        *,
        entity_type,
        left_version_id,
        right_version_id,
        include_unchanged=False,
        relation_page_request=None,
    ):
        left = self.repository.authorize_version(entity_type, left_version_id)
        right = self.repository.authorize_version(entity_type, right_version_id)
        if left is None or right is None:
            raise VersionComparisonError(
                "VERSION_COMPARISON_NOT_FOUND",
                "Không tìm thấy một phiên bản trong phạm vi được phép đọc.",
                status_code=404,
            )
        if (
            str(left.get("entityType") or "") != entity_type
            or str(right.get("entityType") or "") != entity_type
        ):
            raise VersionComparisonError(
                "VERSION_COMPARISON_ENTITY_MISMATCH",
                "Both versions must have the requested entity type.",
                status_code=400,
            )
        left_org = str(left.get("organizationId") or "")
        right_org = str(right.get("organizationId") or "")
        left_root = str(left.get("rootId") or left.get("id") or "")
        right_root = str(right.get("rootId") or right.get("id") or "")
        if left_org != right_org:
            raise VersionComparisonError(
                "VERSION_COMPARISON_TENANT_MISMATCH",
                "Hai phiên bản không thuộc cùng tổ chức.",
                status_code=400,
            )
        if left_root != right_root:
            raise VersionComparisonError(
                "VERSION_COMPARISON_FAMILY_MISMATCH",
                "Hai phiên bản không thuộc cùng dòng phiên bản.",
                status_code=400,
            )

        left_snapshot = self.repository.load_snapshot(entity_type, left)
        right_snapshot = self.repository.load_snapshot(entity_type, right)
        diff = compare_snapshots(
            left_snapshot,
            right_snapshot,
            include_unchanged=include_unchanged,
            relation_page_request=relation_page_request,
        )
        impacts = []
        for provider in self.impact_providers:
            future = self.impact_executor.submit(
                provider.assess,
                left_snapshot,
                right_snapshot,
                diff,
            )
            try:
                impacts.append(future.result(timeout=self.provider_timeout_seconds))
            except FutureTimeoutError:
                future.cancel()
                impacts.append({
                    "category": provider.category,
                    "assessment": "NOT_EVALUATED",
                    "reasonCode": "PROVIDER_TIMEOUT",
                    "references": [],
                })
            except Exception:  # noqa: BLE001 - provider isolation is the port contract.
                # Provider degradation is an explicit result, not a diff failure.
                impacts.append({
                    "category": provider.category,
                    "assessment": "NOT_EVALUATED",
                    "reasonCode": "PROVIDER_UNAVAILABLE",
                    "references": [],
                })
        return {
            "entityType": entity_type,
            "familyId": left_root,
            "left": {
                "id": left.get("id"),
                "version": left.get("phienBan"),
                "rowVersion": left.get("rowVersion"),
            },
            "right": {
                "id": right.get("id"),
                "version": right.get("phienBan"),
                "rowVersion": right.get("rowVersion"),
            },
            **diff,
            "impacts": impacts,
        }
