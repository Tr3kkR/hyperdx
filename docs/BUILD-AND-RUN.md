# Build and run this SQLite fork

HyperDX stores accounts, sessions, dashboards, alerts, and other application
state in one SQLite file. ClickHouse stores telemetry. Start with an empty
SQLite file for a fresh installation; schema migrations run automatically.

## Prerequisites

Use Node.js 22.23.1 (`nvm use` reads `.nvmrc`) and Yarn 4.13.0:

```sh
corepack enable
corepack prepare yarn@4.13.0 --activate
```

Run ClickHouse either with Docker (`docker compose up -d ch-server`) or with a
locally installed ClickHouse binary (`clickhouse server`). Set the connection
host to `http://localhost:8123` in the registration flow. Docker is optional
for source builds if ClickHouse is already running locally.

## Development from source (macOS and Linux)

From the repository root:

```sh
yarn install --immutable
yarn build:common-utils
yarn app:dev
```

Open `http://localhost:8080` and register. The API uses `SQLITE_PATH`, defaulting
to `./hyperdx.db` relative to its working directory. To put the file elsewhere,
set an absolute `SQLITE_PATH` for both the API and the alert task. For the
worktree-isolated `yarn dev` stack, `scripts/dev-env.sh` assigns a per-slot
path under `.volumes/` and starts ClickHouse and the collector.

## Production without Docker

Build all three packages from the repository root:

```sh
yarn install --immutable
yarn --cwd packages/common-utils build
yarn --cwd packages/api build
yarn --cwd packages/app build
```

Use the same absolute SQLite path and session secret in every API/task process.
In three terminals, from the repository root:

```sh
export NODE_ENV=production SQLITE_PATH=/var/lib/hyperdx/hyperdx.db
export EXPRESS_SESSION_SECRET='replace-with-a-random-secret'
export FRONTEND_URL=http://localhost:8080 PORT=8000 OPAMP_PORT=4320
node packages/api/build/index.js
```

```sh
export NODE_ENV=production SQLITE_PATH=/var/lib/hyperdx/hyperdx.db
node packages/api/build/tasks/index.js check-alerts
```

```sh
SERVER_URL=http://localhost:8000 PORT=8080 yarn --cwd packages/app start
```

The API, alert task, and optional dashboard provisioner must be able to write
the same file on **local disk**. Do not put SQLite on NFS. Set the ClickHouse
connection in the UI after registration. The API serves MCP and OpAMP alongside
its HTTP routes. The environment defaults and image commands are in
`docker/hyperdx/entry.prod.sh`.

## Docker

`docker compose up -d --build` starts the standard stack with SQLite at
`/data/hyperdx.db` on the `hyperdx-data` volume. The all-in-one image also
uses `/data/hyperdx.db`; build it with `docker buildx bake --load`, then run it
with `docker run -p 8080:8080 -p 4317:4317 -p 4318:4318 -v hyperdx-data:/data hyperdx-all-in-one:sqlite`.
Neither mode needs a separate application-state database server.

## Backup and restore

For a live database, use SQLite's online backup command from a process with
access to the file:

```sh
sqlite3 /var/lib/hyperdx/hyperdx.db ".backup /var/lib/hyperdx/backup.db"
```

Alternatively, stop every API/task process, copy `hyperdx.db`, and restart.
SQLite uses WAL mode while running. The `hyperdx.db`, `hyperdx.db-wal`, and
`hyperdx.db-shm` files are one unit; never copy them separately while processes
are running. Restore by stopping the processes and replacing the database file
with a verified backup.

## Restricted networks

The source build needs GitHub over HTTPS and the public npm registry. If your
network uses a mirror or proxy, set `YARN_NPM_REGISTRY_SERVER` and/or
`HTTPS_PROXY` before `yarn install --immutable`. No other outbound download is
required during the build. ClickHouse and HyperDX can then run locally.
