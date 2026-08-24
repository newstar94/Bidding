"""Read-only inventory for ProcurementCase shadow/cutover review."""

import json
import os

from backend.db.db_helper import PostgresDatabase


def inventory(database):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        cases = connection.execute(
            """SELECT case_type, state, COUNT(*)
                 FROM procurement_case GROUP BY case_type, state
                 ORDER BY case_type, state"""
        ).fetchall()
        legacy = connection.execute(
            """SELECT loai, COUNT(*) FROM goi_thau_lam_ro
                GROUP BY loai ORDER BY loai"""
        ).fetchall()
        observations = connection.execute(
            """SELECT case_type, COUNT(*),
                      COUNT(*) FILTER (WHERE linked_case_id IS NULL)
                 FROM procurement_case_source_observation
                GROUP BY case_type ORDER BY case_type"""
        ).fetchall()
        return {
            "mode": "READ_ONLY_NO_HEURISTIC_PAIRING",
            "cases": [{"caseType": row[0], "state": row[1], "count": int(row[2])}
                      for row in cases],
            "legacy": [{"kind": row[0], "count": int(row[1])} for row in legacy],
            "sourceObservations": [
                {"caseType": row[0], "count": int(row[1]),
                 "unlinked": int(row[2])} for row in observations
            ],
            "automaticPairsCreated": 0,
        }
    finally:
        connection.rollback()
        connection.close()


def main():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise SystemExit("DATABASE_URL is required")
    database = PostgresDatabase(url)
    try:
        print(json.dumps(inventory(database), ensure_ascii=False, indent=2))
    finally:
        database.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

