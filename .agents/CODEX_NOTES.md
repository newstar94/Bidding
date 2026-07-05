# Codex Notes

## Database Assumption

- When code changes affect database behavior, assume the database can be recreated from the current code/schema for production.
- Do not preserve compatibility only for the current local data in `models/bidding.db`.
- Keep changes that support future schema evolution, such as adding, editing, or deleting tables/fields through code/schema/migrations.
- Prefer fixing code to match the canonical app schema over adding aliases or compatibility shims for old local data.
