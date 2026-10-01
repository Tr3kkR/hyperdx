/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to this test's mkdtemp directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import session from 'express-session';

import { closeDb, openDb } from '@/db';
import { migrate } from '@/db/migrate';
import SqliteSessionStore from '@/db/sessionStore';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdx-session-'));
const file = path.join(directory, 'metadata.db');
const store = new SqliteSessionStore();

beforeAll(() => {
  openDb(file);
  migrate();
});
afterAll(() => {
  closeDb();
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});

test('stores, touches, expires and destroys sessions', () => {
  const cookie = new session.Cookie();
  cookie.maxAge = 60_000;
  const data = {
    cookie,
    passport: { user: 'abc' },
  };
  store.set('sid', data, error => expect(error).toBeUndefined());
  store.get('sid', (error, found) => {
    expect(error).toBeNull();
    expect(found).toEqual(JSON.parse(JSON.stringify(data)));
  });
  store.length?.((error, count) => expect(count).toBe(1));
  const expiredCookie = new session.Cookie();
  expiredCookie.expires = new Date(0);
  store.touch?.('sid', { cookie: expiredCookie });
  store.get('sid', (_error, found) => expect(found).toBeNull());
  store.destroy('sid');
  store.length?.((_error, count) => expect(count).toBe(0));
});
