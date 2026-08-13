"""Canonical cross-version relation predicates."""

import re


_SQL_ALIAS = re.compile(r"^[a-z][a-z0-9_]*$")


def contract_package_relation_predicate(package_alias="goi_thau", link_alias="h"):
    """Match exact package evidence or another snapshot in the same tenant lineage."""

    if not _SQL_ALIAS.fullmatch(package_alias) or not _SQL_ALIAS.fullmatch(link_alias):
        raise ValueError("SQL relation aliases must be fixed identifiers.")
    return f"""{link_alias}.organization_id = {package_alias}.organization_id
        AND EXISTS (
            SELECT 1
            FROM goi_thau AS linked_package
            WHERE linked_package.organization_id = {package_alias}.organization_id
              AND linked_package.id = {link_alias}.goi_thau_id
              AND linked_package.archived_at IS NULL
              AND COALESCE(NULLIF(linked_package.id_goc, ''), linked_package.id)
                  = COALESCE(NULLIF({package_alias}.id_goc, ''), {package_alias}.id)
        )"""  # noqa: S608 - aliases pass the strict identifier allowlist


def load_contracts_for_package_lineage(cursor, organization_id, package_id):
    """Load one effective row per contract, preferring exact link evidence."""

    rows = cursor.execute(
        f"""WITH ranked_contracts AS (
                SELECT contract.*,
                       CASE WHEN link.goi_thau_id = package.id
                            THEN 'exact' ELSE 'lineage-derived'
                       END AS package_relation,
                       ROW_NUMBER() OVER (
                           PARTITION BY contract.id
                           ORDER BY (link.goi_thau_id = package.id) DESC,
                                    linked_package.is_latest DESC,
                                    linked_package.phien_ban DESC,
                                    linked_package.id DESC,
                                    link.hop_dong_id,
                                    link.goi_thau_id
                       ) AS relation_rank
                FROM goi_thau AS package
                JOIN hop_dong_goi_thau AS link
                  ON {contract_package_relation_predicate('package', 'link')}
                JOIN goi_thau AS linked_package
                  ON linked_package.organization_id = link.organization_id
                 AND linked_package.id = link.goi_thau_id
                 AND linked_package.archived_at IS NULL
                JOIN hop_dong AS contract
                  ON contract.organization_id = link.organization_id
                 AND contract.id = link.hop_dong_id
                WHERE package.organization_id = ? AND package.id = ?
                  AND package.archived_at IS NULL
                  AND contract.archived_at IS NULL
            )
            SELECT * FROM ranked_contracts
            WHERE relation_rank = 1
            ORDER BY is_latest DESC, ngay_ky DESC, id""",  # noqa: S608 - fixed allowlisted aliases/predicate
        (organization_id, package_id),
    ).fetchall()
    return [dict(row) for row in rows]
