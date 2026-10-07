import type { DatabaseSync } from 'node:sqlite';

import { getDb } from '@/db';

// Readiness checks the SQLite handle shared by the API and OpAMP servers.
let lastDb: DatabaseSync | undefined;
let lastCheckAt = 0;
let lastReady = false;

export const isDbReady = () => {
  try {
    const db = getDb();
    const now = Date.now();
    if (db === lastDb && now - lastCheckAt < 1000) return lastReady;
    const row = db.prepare('PRAGMA quick_check').get() as
      | { quick_check: string }
      | undefined;
    lastDb = db;
    lastCheckAt = now;
    lastReady = row?.quick_check === 'ok';
    return lastReady;
  } catch {
    lastDb = undefined;
    lastReady = false;
    return false;
  }
};
