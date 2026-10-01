/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The fixture is a captured Mongo user row. */
import fs from 'node:fs';
import path from 'node:path';

import {
  hashPassword,
  NoSaltValueStoredError,
  verifyPassword,
} from '@/db/password';

const vector = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'password-vector.json'), 'utf8'),
) as { password: string; hash: string; salt: string };

test('verifies a Mongo-registered user password without changing its hash', async () => {
  expect(await verifyPassword(vector.password, vector)).toBe(true);
  expect(await verifyPassword('wrong-password', vector)).toBe(false);
});

test('new hashes use the same PBKDF2 format', async () => {
  const stored = await hashPassword('new-password');
  expect(stored.salt).toMatch(/^[0-9a-f]{64}$/);
  expect(stored.hash).toMatch(/^[0-9a-f]{1024}$/);
  expect(await verifyPassword('new-password', stored)).toBe(true);
  await expect(
    verifyPassword('new-password', { hash: stored.hash }),
  ).rejects.toBeInstanceOf(NoSaltValueStoredError);
});
