from backend.version_comparison.providers import (
    AssignmentImpactProvider,
    GeneratedDocumentImpactProvider,
    LegalImpactProvider,
    TimelineImpactProvider,
)


class UnsupportedImpactProvider:
    def __init__(self, category):
        self.category = category

    def assess(self, *_args):
        return {
            "category": self.category,
            "assessment": "NOT_EVALUATED",
            "reasonCode": "AUTHORITATIVE_PROVIDER_NOT_AVAILABLE",
            "references": [],
        }


def default_impact_providers(*, legal_versioning_enabled=False):
    return (
        TimelineImpactProvider(),
        AssignmentImpactProvider(),
        LegalImpactProvider(enabled=legal_versioning_enabled),
        GeneratedDocumentImpactProvider(),
        *(UnsupportedImpactProvider(category) for category in (
            "PROGRESS",
            "WORKFLOW",
            "DOCUMENT",
            "EVALUATION",
            "CONTRACT",
            "NOTIFICATION",
            "COMPLIANCE",
        )),
    )
