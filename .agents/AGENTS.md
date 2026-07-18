# Project Agent Instructions

## Data Field Changes

Whenever a data field is added, renamed, or removed, treat the change as an end-to-end contract update. Check and update every applicable layer before considering the work complete:

- Database schema and existing-database migration/alignment behavior.
- Generated schema contracts and database-to-application field maps in both directions.
- API payloads, synchronization mappers, validation, serialization, and merge logic.
- Application model/state, form load/save, automatic lookup, detail views, tables, and filters.
- Excel template, import aliases, import save adapters, export configuration, and validation.
- Word mapping selectors, backend Word sources, default variable names, and the default mapping version so existing organizations receive new mappings.
- Tests for persistence and each applicable import/export or document mapping path.
- Generated frontend/backend artifacts and documentation where applicable.

Search for both the database field name and application field name to verify coverage. Do not mark a field change complete until applicable tests and builds pass.
## Database Assumption

- When code changes affect database behavior, assume the database can be recreated from the current code/schema for production.
- Do not preserve compatibility only for the current local data in `models/bidding.db`.
- Keep changes that support future schema evolution, such as adding, editing, or deleting tables/fields through code/schema/migrations.
- Prefer fixing code to match the canonical app schema over adding aliases or compatibility shims for old local data.