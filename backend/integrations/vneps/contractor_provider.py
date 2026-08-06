"""Contractor-information adapter over BiddingFlow's existing lookup module."""

from backend.partners.partner_lookup_service import (
    extract_clean_tax_code,
    lookup_partner_info,
    normalize_procurement_org_code,
)


class VnepsContractorProvider:
    name = "MuaSamCong"

    def resolve(self, *, contractor_identifier: str = "", tax_code: str = ""):
        normalized_identifier = normalize_procurement_org_code(contractor_identifier) or ""
        normalized_tax_code = extract_clean_tax_code(tax_code) or ""
        if not normalized_identifier and not normalized_tax_code:
            normalized_tax_code = extract_clean_tax_code(contractor_identifier) or ""
        return lookup_partner_info(
            normalized_tax_code,
            org_code=normalized_identifier,
            role_name="NT",
        )
