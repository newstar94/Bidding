"""Versioned analytical plan-fit classification; never mutates commerce."""

RULE_VERSION = "plan-fit-v1"


def classify_plan_fit(signals):
    values = dict(signals or {})
    active_seats = max(0, int(values.get("active_seats") or 0))
    months = max(0, int(values.get("pressure_months") or 0))
    seat = max(0.0, float(values.get("seat_utilization") or 0))
    quota = max(0.0, float(values.get("quota_utilization") or 0))
    topup = max(0, int(values.get("topup_spend") or 0))
    repeat_topups = max(0, int(values.get("repeat_topups") or 0))
    gap = max(0, int(values.get("price_gap_to_next_plan") or 0))
    evidence = []
    if active_seats > 50:
        classification = "ENTERPRISE_CANDIDATE"
        evidence.append("active_seats_over_50")
    else:
        if seat >= 0.8:
            evidence.append("seat_pressure")
        if quota >= 0.8:
            evidence.append("quota_pressure")
        if gap and topup >= 0.7 * gap:
            evidence.append("topup_near_plan_gap")
        if values.get("variant") == "internal" and "topup_near_plan_gap" in evidence:
            classification = "CONNECTED_CANDIDATE"
        elif evidence and months >= 2:
            classification = "UNDER_SIZED"
        elif seat < 0.3 and quota < 0.2 and months >= 2 and values.get("workflow_volume", 0) in {0, "low"}:
            classification = "OVER_SIZED"
        elif repeat_topups >= 4:
            classification = "TOPUP_HEAVY"
        else:
            classification = "GOOD_FIT"
    return {
        "classification": classification,
        "strength": "strong" if len(evidence) >= 2 and months >= 2 else "candidate",
        "evidence": evidence,
        "ruleVersion": RULE_VERSION,
        "automaticAction": None,
    }
