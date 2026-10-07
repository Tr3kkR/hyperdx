/** Direct SQLite and ClickHouse access helpers for full-stack E2E tests. */
import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Run one named fixture operation through the API's normal openDb/migrate path.
 * Passing JSON as an argument avoids shell quoting and SQL injection.
 */
export function runSqliteFixture(
  action: string,
  input: Record<string, unknown> = {},
): string {
  const apiDir = path.resolve(__dirname, '../../../../api');
  return execFileSync(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      '-r',
      'tsconfig-paths/register',
      'scripts/e2e-db.ts',
      action,
      JSON.stringify(input),
    ],
    {
      encoding: 'utf-8',
      cwd: apiDir,
      env: {
        ...process.env,
        SQLITE_PATH:
          process.env.SQLITE_PATH ||
          path.join(
            apiDir,
            `hyperdx-e2e-${process.env.HDX_E2E_SLOT || '0'}.db`,
          ),
      },
    },
  );
}

/**
 * Sets a boolean field directly on the (single, seeded) e2e team row.
 * There's no settings UI or API endpoint for team feature flags yet, so
 * direct DB writes are the only way to toggle them for a test.
 *
 * This app only ever has one team per deployment (`/register/password`
 * 409s with `teamAlreadyExists` once any team exists — see
 * `isTeamExisting` in packages/api/src/controllers/team.ts), so there's
 * nothing to scope by. Tests that toggle a flag here should still avoid
 * racing each other — e.g. via `test.describe.serial(...)` — since
 * `fullyParallel: true` lets tests in the same file run concurrently.
 */
export function setTeamFlag(flagName: string, value: boolean): void {
  runSqliteFixture('set-team-flag', { flag: flagName, value });
}

const CLICKHOUSE_HOST =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;

/** ClickHouse HTTP endpoint with credentials, as the E2E stack exposes it. */
function clickhouseUrl(): string {
  const url = new URL(CLICKHOUSE_HOST);
  url.searchParams.set('user', process.env.CLICKHOUSE_USER || 'default');
  if (process.env.CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', process.env.CLICKHOUSE_PASSWORD);
  }
  return url.toString();
}

/** Runs a SELECT and returns one trimmed line per row (TSV). */
export async function clickhouseSelect(sql: string): Promise<string[]> {
  const response = await fetch(clickhouseUrl(), {
    method: 'POST',
    body: `${sql} FORMAT TSV`,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(
      `ClickHouse query failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.text()).trim().split('\n').filter(Boolean);
}
