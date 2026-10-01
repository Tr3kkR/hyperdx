import { getDb, withTransaction } from './index';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function pruneExpired(at = Date.now()): void {
  const db = getDb();
  withTransaction(() => {
    db.prepare('DELETE FROM alerthistories WHERE createdAt < ?').run(
      at - THIRTY_DAYS_MS,
    );
    db.prepare('DELETE FROM teaminvites WHERE createdAt < ?').run(
      at - THIRTY_DAYS_MS,
    );
    db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(at);
  });
}
