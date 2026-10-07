/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The CLI accepts only named fixture operations; table names are checked before interpolation. */
// Small, local-only database fixture commands used by Playwright.
import { closeDb, openDb, withTransaction } from '@/db';
import { newId } from '@/db/ids';
import { migrate } from '@/db/migrate';

const action = process.argv[2];
const input = JSON.parse(process.argv[3] ?? '{}') as Record<string, unknown>;
const db = openDb();
try {
  migrate();
  const result = withTransaction(() => {
    switch (action) {
      case 'clear': {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[];
        for (const { name } of tables) {
          if (!/^[a-z_]+$/.test(name))
            throw new Error(`Unexpected table: ${name}`);
          db.exec(`DELETE FROM "${name}"`);
        }
        return { cleared: tables.length };
      }
      case 'set-team-flag': {
        if (input.flag !== 'isMetricsSeriesTableEnabled')
          throw new Error('Unsupported team flag');
        const changed = db
          .prepare('UPDATE teams SET isMetricsSeriesTableEnabled=?')
          .run(Number(input.value)).changes;
        return {
          matchedCount: Number(changed),
          modifiedCount: Number(changed),
        };
      }
      case 'dashboard-filter': {
        const changed = db
          .prepare(
            "UPDATE dashboards SET filters=json_set(filters,'$[0].isVariableEnabled',json('false')) WHERE id=?",
          )
          .run(String(input.id)).changes;
        return {
          matchedCount: Number(changed),
          modifiedCount: Number(changed),
        };
      }
      case 'dashboard-provisioned': {
        const changed = db
          .prepare('UPDATE dashboards SET provisioned=1 WHERE id=?')
          .run(String(input.id)).changes;
        return {
          matchedCount: Number(changed),
          modifiedCount: Number(changed),
        };
      }
      case 'dashboard-promql-tile': {
        const tiles = [
          {
            id: 'promql-1',
            x: 0,
            y: 0,
            w: 4,
            h: 2,
            config: {
              configType: 'promql',
              promqlExpression: 'up',
              connection: 'c1',
              displayType: 'line',
            },
          },
        ];
        const changed = db
          .prepare('UPDATE dashboards SET tiles=? WHERE id=?')
          .run(JSON.stringify(tiles), String(input.id)).changes;
        return {
          matchedCount: Number(changed),
          modifiedCount: Number(changed),
        };
      }
      case 'alert-errors': {
        const id = String(input.id);
        const now = new Date();
        db.prepare(
          'UPDATE alerts SET executionErrors=?, state=? WHERE id=?',
        ).run(
          JSON.stringify([
            {
              timestamp: now,
              type: input.errorType,
              message: input.errorMessage,
            },
          ]),
          'OK',
          id,
        );
        db.prepare('DELETE FROM alerthistories WHERE alert=?').run(id);
        const insert = db.prepare(
          'INSERT INTO alerthistories (id,alert,createdAt,state,counts,lastValues,errors) VALUES (?,?,?,?,?,?,?)',
        );
        const windowMs = 5 * 60 * 1000;
        const errorStart = Math.floor(now.getTime() / windowMs) * windowMs;
        const okStart = errorStart - windowMs;
        insert.run(
          newId(),
          id,
          okStart,
          'OK',
          0,
          JSON.stringify([
            { startTime: new Date(okStart - windowMs), count: 0 },
          ]),
          null,
        );
        insert.run(
          newId(),
          id,
          errorStart,
          'ERROR',
          0,
          '[]',
          JSON.stringify([
            {
              timestamp: now,
              type: input.historyErrorType,
              message: input.historyErrorMessage,
            },
          ]),
        );
        return { seeded: id };
      }
      default:
        throw new Error(`Unknown E2E database action: ${action}`);
    }
  });
  console.log(JSON.stringify(result));
} finally {
  closeDb();
}
