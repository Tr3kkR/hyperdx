/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQL projections define the three row shapes below. */
import session from 'express-session';

import { getDb } from './index';

function expiresAt(data: session.SessionData): number {
  const expires = data.cookie?.expires;
  if (expires) return new Date(expires).getTime();
  return Date.now() + (data.cookie?.maxAge ?? 30 * 24 * 60 * 60 * 1000);
}

export default class SqliteSessionStore extends session.Store {
  get(
    sid: string,
    callback: (err: unknown, data?: session.SessionData | null) => void,
  ): void {
    let data: session.SessionData | null;
    try {
      const row = getDb()
        .prepare('SELECT data FROM sessions WHERE sid=? AND expiresAt>?')
        .get(sid, Date.now()) as { data: string } | undefined;
      data = row ? JSON.parse(row.data) : null;
    } catch (error) {
      callback(error);
      return;
    }
    callback(null, data);
  }

  set(
    sid: string,
    data: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    try {
      getDb()
        .prepare(
          'INSERT INTO sessions(sid,expiresAt,data) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expiresAt=excluded.expiresAt,data=excluded.data',
        )
        .run(sid, expiresAt(data), JSON.stringify(data));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid: string, data: session.SessionData, callback?: () => void): void {
    try {
      getDb()
        .prepare('UPDATE sessions SET expiresAt=? WHERE sid=?')
        .run(expiresAt(data), sid);
      callback?.();
    } catch (error) {
      this.emit('error', error);
      callback?.();
    }
  }

  all(callback: (err: unknown, data?: session.SessionData[]) => void): void {
    try {
      const rows = getDb()
        .prepare('SELECT data FROM sessions WHERE expiresAt>?')
        .all(Date.now()) as { data: string }[];
      callback(
        null,
        rows.map(row => JSON.parse(row.data)),
      );
    } catch (error) {
      callback(error);
    }
  }

  clear(callback?: (err?: unknown) => void): void {
    try {
      getDb().exec('DELETE FROM sessions');
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  length(callback: (err: unknown, count?: number) => void): void {
    try {
      const row = getDb()
        .prepare('SELECT count(*) AS count FROM sessions WHERE expiresAt>?')
        .get(Date.now()) as { count: number };
      callback(null, row.count);
    } catch (error) {
      callback(error);
    }
  }
}
