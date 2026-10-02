import { DatabaseSync } from 'node:sqlite';

import { isUniqueViolation } from '@/db/errors';

test('recognizes node:sqlite unique violations and no other SQL errors', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE test (value TEXT UNIQUE)');
    db.exec("INSERT INTO test VALUES ('a')");
    try {
      db.exec("INSERT INTO test VALUES ('a')");
      throw new Error('Expected a constraint error');
    } catch (error) {
      expect(isUniqueViolation(error)).toBe(true);
    }
    expect(isUniqueViolation(new Error('other'))).toBe(false);
  } finally {
    db.close();
  }
});
