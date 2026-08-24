class AssignmentImpactProvider:
    category = "ASSIGNMENT"

    def assess(self, _left, _right, diff):
        relation = next(
            (item for item in diff.get("relations", []) if item.get("path") == "assignments"),
            None,
        )
        changed = bool(relation and any(
            relation["summary"].get(key, 0) for key in ("added", "removed", "modified")
        ))
        return {
            "category": self.category,
            "assessment": "CONFIRMED" if changed else "NOT_EVALUATED",
            "reasonCode": "ASSIGNMENT_MEMBERSHIP_CHANGED" if changed else "NO_ASSIGNMENT_CHANGE",
            "references": ["assignments"] if changed else [],
        }
