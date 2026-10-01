/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to this test's mkdtemp directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeDb, openDb, withTransaction } from '@/db';
import { migrate } from '@/db/migrate';

test('WAL lets another connection read during a write transaction', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdx-wal-'));
  const file = path.join(directory, 'metadata.db');
  const writer = openDb(file);
  migrate();
  expect(writer.prepare('PRAGMA journal_mode').get()).toEqual({
    journal_mode: 'wal',
  });
  const reader = new DatabaseSync(file);
  try {
    withTransaction(() => {
      writer
        .prepare('INSERT INTO sessions(sid,expiresAt,data) VALUES(?,?,?)')
        .run('uncommitted', Date.now() + 1000, '{}');
      expect(
        reader.prepare('SELECT count(*) AS count FROM sessions').get(),
      ).toEqual({
        count: 0,
      });
    });
    expect(
      reader.prepare('SELECT count(*) AS count FROM sessions').get(),
    ).toEqual({
      count: 1,
    });
  } finally {
    reader.close();
    closeDb();
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});

test('refuses a database that cannot enable WAL', () => {
  expect(() => openDb(':memory:')).toThrow('SQLite WAL mode unavailable');
});
