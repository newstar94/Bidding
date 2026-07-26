from __future__ import annotations

from backend.partners import partner_lookup_service


def test_partner_worker_drain_continues_after_one_failed_job(monkeypatch) -> None:
    jobs = iter([{"id": "failed"}, {"id": "completed"}, None])
    processed_ids = []
    logged = []

    monkeypatch.setattr(
        partner_lookup_service,
        "_claim_partner_enrichment_job",
        lambda: next(jobs),
    )

    def process(job):
        processed_ids.append(job["id"])
        if job["id"] == "failed":
            raise RuntimeError("upstream failed")

    monkeypatch.setattr(
        partner_lookup_service,
        "_process_partner_enrichment_job",
        process,
    )
    monkeypatch.setattr(
        partner_lookup_service,
        "log_error",
        lambda error, context: logged.append((str(error), context)),
    )

    assert partner_lookup_service._drain_partner_enrichment_jobs() == 2
    assert processed_ids == ["failed", "completed"]
    assert logged == [("upstream failed", "PartnerLookup.DurableWorker")]
