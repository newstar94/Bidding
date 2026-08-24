"""Impact provider backed by exact generated-document provenance."""


class GeneratedDocumentImpactProvider:
    category = "GENERATED_WORD"

    @staticmethod
    def _documents(snapshot):
        return (snapshot.get("context") or {}).get("generatedDocuments") or []

    def assess(self, left, right, diff):
        left_documents = self._documents(left)
        right_documents = self._documents(right)
        references = [{
            "artifactId": item.get("artifactId"),
            "templateVersionId": item.get("templateVersionId"),
            "templateSha256": item.get("templateSha256"),
            "recordRowVersion": item.get("recordRowVersion"),
            "side": side,
        } for side, documents in (("LEFT", left_documents), ("RIGHT", right_documents))
          for item in documents]
        changed = sum(
            int((diff.get("summary") or {}).get(key, 0))
            for key in ("added", "removed", "modified")
        ) > 0
        if not left_documents:
            return {"category": self.category, "assessment": "NOT_EVALUATED",
                    "reasonCode": "NO_GENERATED_DOCUMENT_PROVENANCE",
                    "references": references}
        if not changed:
            return {"category": self.category, "assessment": "NOT_EVALUATED",
                    "reasonCode": "NO_BUSINESS_CHANGE",
                    "references": references}
        return {"category": self.category, "assessment": "CONFIRMED",
                "reasonCode": "GENERATED_DOCUMENT_SOURCE_VERSION_CHANGED",
                "references": references}

