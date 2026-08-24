from backend.timeline.effective_timeline import build_effective_timeline


def _projection(snapshot):
    if snapshot.get("entityType") == "goithau":
        records = [(snapshot.get("record") or {}, snapshot.get("context") or {})]
    else:
        plan = snapshot.get("record") or {}
        records = [
            (package, {"plan": plan})
            for package in (snapshot.get("relations") or {}).get("packages", [])
        ]
    projected = []
    for package, related in records:
        if snapshot.get("entityType") == "goithau":
            snapshot_relations = snapshot.get("relations") or {}
            related = {
                **related,
                "ehsmtAdjustments": snapshot_relations.get("ehsmtAdjustments", []),
                "clarificationRequests": snapshot_relations.get("yeuCauLamRoList", []),
                "clarificationResponses": snapshot_relations.get("traLoiLamRoList", []),
                "extensions": snapshot_relations.get("giaHanList", []),
                "expertTeam": snapshot_relations.get("toChuyenGia", []),
                "appraisalTeam": snapshot_relations.get("toThamDinh", []),
            }
        saved_entries = (
            (snapshot.get("relations") or {}).get("timelineItems", [])
            if snapshot.get("entityType") == "goithau"
            else package.get("timelineItems") or []
        )
        for row in build_effective_timeline(package, related, saved_entries):
            projected.append((
                str(package.get("rootId") or package.get("maGoiThau") or ""),
                row.get("milestone_key"),
                row.get("instance_key"),
                row.get("applicability"),
                row.get("ngay_du_kien"),
                row.get("ngay_thuc_te"),
                row.get("effective_closing_time"),
            ))
    return sorted(projected)


class TimelineImpactProvider:
    category = "TIMELINE"

    def assess(self, left, right, _diff):
        changed = _projection(left) != _projection(right)
        return {
            "category": self.category,
            "assessment": "CONFIRMED" if changed else "NOT_EVALUATED",
            "reasonCode": "TIMELINE_PROJECTION_CHANGED" if changed else "NO_TIMELINE_CHANGE",
            "references": ["effectiveTimeline"] if changed else [],
        }
