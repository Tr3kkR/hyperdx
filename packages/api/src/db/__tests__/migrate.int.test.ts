/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to this test's mkdtemp directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDb, getDb, openDb, withTransaction } from '@/db';
import { migrate } from '@/db/migrate';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdx-migrate-'));
const file = path.join(directory, 'metadata.db');

afterAll(() => {
  closeDb();
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});

test('migrates a new database once and preserves rows on re-run', () => {
  openDb(file);
  migrate();
  const db = getDb();
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  db.prepare('INSERT INTO sessions(sid,expiresAt,data) VALUES(?,?,?)').run(
    'session',
    Date.now() + 1000,
    '{}',
  );
  migrate();
  expect(db.prepare('SELECT count(*) AS count FROM sessions').get()).toEqual({
    count: 1,
  });
});

test('nested transaction rollback preserves the outer write', () => {
  const db = getDb();
  withTransaction(() => {
    db.prepare('INSERT INTO sessions(sid,expiresAt,data) VALUES(?,?,?)').run(
      'outer',
      Date.now() + 1000,
      '{}',
    );
    expect(() =>
      withTransaction(() => {
        db.prepare(
          'INSERT INTO sessions(sid,expiresAt,data) VALUES(?,?,?)',
        ).run('inner', Date.now() + 1000, '{}');
        throw new Error('abort inner');
      }),
    ).toThrow('abort inner');
  });
  expect(
    db.prepare('SELECT sid FROM sessions WHERE sid=?').get('outer'),
  ).toEqual({ sid: 'outer' });
  expect(
    db.prepare('SELECT sid FROM sessions WHERE sid=?').get('inner'),
  ).toBeUndefined();
});
