import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

const ITERATIONS = 25_000;
const KEY_LENGTH = 512;
const DIGEST = 'sha256';

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class IncorrectUsernameError extends AuthenticationError {
  constructor() {
    super('Password or username is incorrect');
  }
}
export class IncorrectPasswordError extends AuthenticationError {
  constructor() {
    super('Password or username is incorrect');
  }
}
export class MissingPasswordError extends AuthenticationError {
  constructor() {
    super('No password was given');
  }
}
export class NoSaltValueStoredError extends AuthenticationError {
  constructor() {
    super('Authentication not possible. No salt value stored');
  }
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (error, hash) =>
      error ? reject(error) : resolve(hash),
    );
  });
}

export async function hashPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  if (!password) throw new MissingPasswordError();
  const salt = randomBytes(32).toString('hex');
  return { hash: (await derive(password, salt)).toString('hex'), salt };
}

export async function verifyPassword(
  password: string,
  stored: { hash?: string | null; salt?: string | null },
): Promise<boolean> {
  if (!stored.salt) throw new NoSaltValueStoredError();
  if (!stored.hash) return false;
  const actual = await derive(password, stored.salt);
  const expected = Buffer.from(stored.hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
