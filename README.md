# BiddingFlow

BiddingFlow is the procurement package and bid-evaluation workspace.

Build and package the production release only through the secure gate:

```text
npm run package:production
```

Initialize PostgreSQL once per release with:

```text
python scripts/manage_database.py
```
