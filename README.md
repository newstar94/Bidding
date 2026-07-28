# BiddingFlow

BiddingFlow is the procurement package and bid-evaluation workspace.

Build and package the production release only through the secure gate:

```text
npm run package:production
```

Development and test startup automatically initialize or upgrade PostgreSQL.
Set `DATABASE_AUTO_MIGRATE=false` to opt out. Production keeps automatic
migration disabled and must initialize PostgreSQL once per release with:

```text
python scripts/manage_database.py
```
