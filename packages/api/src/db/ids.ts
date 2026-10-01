import { ObjectId } from 'bson';

export const newId = (): string => new ObjectId().toHexString();

export const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);

export function normalizeId(value: string): string {
  assertId(value, 'id');
  return value.toLowerCase();
}

export function assertId(
  value: unknown,
  label: string,
): asserts value is string {
  if (!isId(value))
    throw new Error(`Invalid ${label}: expected 24 hex characters`);
}
