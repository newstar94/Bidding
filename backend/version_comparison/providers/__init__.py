from backend.version_comparison.providers.assignment import AssignmentImpactProvider
from backend.version_comparison.providers.legal import LegalImpactProvider
from backend.version_comparison.providers.timeline import TimelineImpactProvider
from backend.version_comparison.providers.documents import GeneratedDocumentImpactProvider

__all__ = ["AssignmentImpactProvider", "GeneratedDocumentImpactProvider", "LegalImpactProvider", "TimelineImpactProvider"]
