# Immutable audit coverage matrix

| Aggregate/table | Create/update | Delete | Restore | Evidence |
|---|---|---|---|---|
| `goi_thau`, `hop_dong`, `thong_tin_mo_thau` | sync mutation audit | sync delete audit | explicit restore | `test_immutable_mutation_audit.py`, `test_sync_restore.py` |
| Lot/goods/bidder goods | sync mutation audit | sync delete audit | explicit restore where table permits | mutation audit + bidder goods tests |
| Evaluation round/criteria/results/report | sync mutation audit | sync delete audit | explicit restore where table permits | mutation audit matrix |
| Contractor/JV/expert | sync mutation audit | sync delete audit | explicit restore | redaction/hash tests |
| Assignment/permission matrix | sync audit + assignment activity | sync delete + removal history | not applicable: state recreated by authorized command | multi-assignee/activity tests |
| Package document | route transactional audit | route transactional audit | replacement/upload is new event, no binary restore | package document tests |
| Lifecycle/award | underlying package/lot mutation audit | cancellation remains material update | rebid/restore command audit | lifecycle/low-price/lot tests |
| Protected export/media access | access/export audit where policy requires | not applicable | not applicable | record access + document job tests |

Audit event stores field names and hashes only; UI timeline resolves reviewed business labels and never falls back to technical IDs/unknown column names.
