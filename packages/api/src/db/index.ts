import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as config from '@/config';

let database: DatabaseSync | undefined;
let databasePath: string | undefined;
let transactionDepth = 0;

export function openDb(filePath?: string): DatabaseSync {
  const requestedPath = filePath ?? config.SQLITE_PATH;
  const resolvedPath =
    requestedPath === ':memory:' ? requestedPath : path.resolve(requestedPath);
  if (database) {
    if (filePath !== undefined && databasePath !== resolvedPath) {
      throw new Error(`SQLite database already open at ${databasePath}`);
    }
    return database;
  }

  if (resolvedPath !== ':memory:') {
    // The operator explicitly chooses SQLITE_PATH; this directory must exist for SQLite.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  try {
    const mode = db.prepare('PRAGMA journal_mode=WAL').get() as
      | { journal_mode: string }
      | undefined;
    if (mode?.journal_mode.toLowerCase() !== 'wal') {
      throw new Error(`SQLite WAL mode unavailable at ${resolvedPath}`);
    }
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('PRAGMA wal_autocheckpoint=1000');
  } catch (error) {
    db.close();
    throw error;
  }

  database = db;
  databasePath = resolvedPath;
  return db;
}

export function getDb(): DatabaseSync {
  if (!database) throw new Error('SQLite database is not open');
  return database;
}

export function closeDb(checkpoint = false): void {
  if (!database) return;
  if (transactionDepth !== 0) throw new Error('SQLite transaction is open');
  try {
    if (checkpoint) database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    database.close();
    database = undefined;
    databasePath = undefined;
  }
}

export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  const depth = transactionDepth;
  const savepoint = `sqlite_nested_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  transactionDepth++;
  try {
    const result = fn();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    if (depth === 0) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  } finally {
    transactionDepth--;
  }
}
