"""Add the tenant-scoped keyset index used by package pagination."""


VERSION = 8
NAME = "0008_package_pagination_index"


def apply(cursor, context):
    cursor.execute(
        """CREATE INDEX idx_goi_thau_owner_code_id
           ON goi_thau (organization_id, ma_goi_thau, id)"""
    )
    context.assert_foreign_key_integrity(cursor)
