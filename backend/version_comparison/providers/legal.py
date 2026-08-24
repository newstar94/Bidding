"""Deterministic legal-impact provider over exact immutable target bindings."""


class LegalImpactProvider:
    category = "LEGAL_RULES"

    def __init__(self, *, enabled):
        self.enabled = bool(enabled)

    @staticmethod
    def _binding(snapshot):
        return (snapshot.get("context") or {}).get("legalBinding")

    @staticmethod
    def _reference(binding):
        if not binding:
            return None
        return {
            "bindingId": binding.get("id"),
            "bindingRevision": binding.get("bindingRevision"),
            "profileVersionId": binding.get("profileVersionId"),
            "policyVersionId": binding.get("policyVersionId"),
            "status": binding.get("status"),
        }

    def assess(self, left, right, _diff):
        if not self.enabled:
            return {
                "category": self.category,
                "assessment": "NOT_EVALUATED",
                "reasonCode": "LEGAL_VERSIONING_DISABLED",
                "references": [],
            }
        left_binding = self._binding(left)
        right_binding = self._binding(right)
        references = [
            value for value in (
                self._reference(left_binding), self._reference(right_binding)
            ) if value is not None
        ]
        if left_binding is None or right_binding is None:
            return {
                "category": self.category,
                "assessment": "NOT_EVALUATED",
                "reasonCode": "LEGAL_BINDING_UNAVAILABLE",
                "references": references,
            }
        if (
            left_binding.get("status") != "RESOLVED"
            or right_binding.get("status") != "RESOLVED"
            or not left_binding.get("profileVersionId")
            or not right_binding.get("profileVersionId")
        ):
            return {
                "category": self.category,
                "assessment": "NOT_EVALUATED",
                "reasonCode": "LEGAL_BINDING_NOT_RESOLVED",
                "references": references,
            }
        left_authority = (
            left_binding.get("profileVersionId"),
            left_binding.get("policyVersionId"),
        )
        right_authority = (
            right_binding.get("profileVersionId"),
            right_binding.get("policyVersionId"),
        )
        changed = left_authority != right_authority
        return {
            "category": self.category,
            "assessment": "CONFIRMED" if changed else "NOT_EVALUATED",
            "reasonCode": (
                "EXACT_LEGAL_BINDING_CHANGED"
                if changed else "NO_LEGAL_BINDING_CHANGE"
            ),
            "references": references,
        }
