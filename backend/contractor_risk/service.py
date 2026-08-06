"""Deep module coordinating identity resolution, provider data and snapshots."""

from __future__ import annotations

from dataclasses import dataclass

from backend.contractor_risk.repository import ContractorRiskRepository, ResolutionContext
from backend.contractor_risk.types import (
    IdentityMatchType,
    ViolationStatus,
)
from backend.contractor_risk.violation_rules import (
    VIOLATION_RULE_VERSION,
    evaluate_violation_records,
    match_violation_records,
)
from backend.integrations.vneps.errors import VnepsError
from backend.partners.partner_lookup_service import (
    PartnerLookupBusyError,
    PartnerUpstreamError,
)


@dataclass(frozen=True, slots=True)
class ContractorRiskResolution:
    contractor: dict
    violation_status: ViolationStatus
    bid_closing_at: str | None


class ContractorRiskService:
    def __init__(self, repository: ContractorRiskRepository, contractor_provider, violation_provider):
        self.repository = repository
        self.contractor_provider = contractor_provider
        self.violation_provider = violation_provider

    def resolve(
        self,
        context: ResolutionContext,
        *,
        actor_user_id: str,
        request=None,
    ) -> ContractorRiskResolution:
        identifier = context.contractor_identifier
        tax_code = context.tax_code
        name = context.contractor_name
        contractor_id = context.contractor_id

        if not contractor_id or not name or not tax_code:
            try:
                info = self.contractor_provider.resolve(
                    contractor_identifier=identifier,
                    tax_code=tax_code,
                )
            except (PartnerLookupBusyError, PartnerUpstreamError):
                info = None
            if isinstance(info, dict):
                identifier = str(info.get("org_code") or identifier).strip()
                tax_code = str(info.get("tax_code") or tax_code).strip()
                name = str(info.get("name") or name).strip()

        if context.bid_closing_at is None:
            status = ViolationStatus.REVIEW_REQUIRED
            provider_result = None
            match_type = IdentityMatchType.NONE
        else:
            status, match_type, provider_result = self._evaluate(
                context,
                contractor_identifier=identifier,
                tax_code=tax_code,
            )

        self.repository.save_snapshot(
            context,
            actor_user_id=actor_user_id,
            status=status,
            match_type=match_type,
            rule_version=VIOLATION_RULE_VERSION,
            result=provider_result,
            contractor_identifier=identifier,
            tax_code=tax_code,
            request=request,
        )
        return ContractorRiskResolution(
            contractor={
                "id": contractor_id,
                "identifier": identifier,
                "taxCode": tax_code or None,
                "name": name,
            },
            violation_status=status,
            bid_closing_at=(
                context.bid_closing_at.isoformat() if context.bid_closing_at else None
            ),
        )

    def _evaluate(self, context, *, contractor_identifier, tax_code):
        provider_result = self.repository.latest_snapshot_result(
            context,
            contractor_identifier=contractor_identifier,
            tax_code=tax_code,
        )
        if provider_result is None:
            provider_result = self.repository.get_cached_provider_result(
                provider=self.violation_provider.name,
                contractor_identifier=contractor_identifier,
                tax_code=tax_code,
                schema_version=self.violation_provider.schema_version,
            )
        if provider_result is None:
            try:
                provider_result = self.violation_provider.lookup(
                    contractor_identifier=contractor_identifier,
                    tax_code=tax_code,
                )
                self.repository.put_cached_provider_result(
                    provider_result,
                    contractor_identifier=contractor_identifier,
                    tax_code=tax_code,
                )
            except VnepsError:
                return (
                    ViolationStatus.LOOKUP_FAILED,
                    IdentityMatchType.NONE,
                    None,
                )

        if not provider_result.records:
            return (
                ViolationStatus.NO_ACTIVE_VIOLATION,
                IdentityMatchType.NONE,
                provider_result,
            )
        match = match_violation_records(
            provider_result.records,
            contractor_identifier=contractor_identifier,
            tax_code=tax_code,
        )
        if match.conflict:
            return (
                ViolationStatus.IDENTITY_CONFLICT,
                IdentityMatchType.NONE,
                provider_result,
            )
        if not match.records:
            return (
                ViolationStatus.REVIEW_REQUIRED,
                IdentityMatchType.NONE,
                provider_result,
            )
        evaluation = evaluate_violation_records(
            match.records,
            context.bid_closing_at,
        )
        return evaluation.status, match.match_type, provider_result
