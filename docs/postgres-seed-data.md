## Postgres seed data snapshot for local stack

This document shows how to **export** the current Postgres data from the local stack and how to **recreate** it after a fresh restart.

The commands below assume:

- Docker compose file: `docker/compose.app.local.yml`
- Env file: `docker/.env.app.local`
- Postgres service name: `postgres`
- Database: `trading_bot`
- User: `trading_bot_admin`

If you change any of those, adjust the commands accordingly.

---

### 1. Export current data to a seed file

Run this from the `trading-bot` repo root while the local stack is up:

```bash
docker compose \
  --env-file docker/.env.app.local \
  -f docker/compose.app.local.yml \
  exec -T postgres \
  pg_dump \
    -U trading_bot_admin \
    -d trading_bot \
    --data-only \
    --inserts \
    --no-owner \
    --no-privileges \
    --schema=public \
  > docker/postgres-seed-data.sql
```

This will create (or overwrite) `docker/postgres-seed-data.sql` with `INSERT` statements for all tables in the `public` schema, matching **exactly** whatever data is in Postgres at the time you run it.

You can re-run this command any time you change configuration and want to refresh the snapshot.

---

### 2. Restore the seed data into a fresh local stack

After you have restarted the stack and Postgres is empty (or freshly migrated), run:

```bash
docker compose \
  --env-file docker/.env.app.local \
  -f docker/compose.app.local.yml \
  exec -T postgres \
  psql \
    -U trading_bot_admin \
    -d trading_bot \
    -v ON_ERROR_STOP=1 \
  < docker/postgres-seed-data.sql
```

This will replay all the `INSERT` statements from `docker/postgres-seed-data.sql` and recreate the exact same data (IDs, names, relations) that you had when you exported the snapshot.

If migrations add new tables/columns later, run the export command again once the system is in the desired state to refresh the seed file.

