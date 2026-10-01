/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, security/detect-non-literal-fs-filename -- Version rows and packaged migration paths are internal. */
import fs from 'node:fs';
import path from 'node:path';

import { getDb, withTransaction } from './index';

const migrationsDir = path.resolve(__dirname, '../../migrations/sqlite');

export function migrate(): void {
  const db = getDb();
  const files = fs
    .readdirSync(migrationsDir)
    .filter(file => /^\d+_.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.slice(0, file.indexOf('_')), 10);
    withTransaction(() => {
      // Another process may have migrated while BEGIN IMMEDIATE waited for its writer lock.
      const current = db.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };
      if (version <= current.user_version) return;
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      db.exec(`PRAGMA user_version=${version}`);
    });
  }
}
