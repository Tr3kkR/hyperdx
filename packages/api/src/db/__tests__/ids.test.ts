import { assertId, isId, newId, normalizeId } from '@/db/ids';

test('generates and normalizes 24-character hex IDs', () => {
  const id = newId();
  expect(isId(id)).toBe(true);
  expect(normalizeId(id.toUpperCase())).toBe(id);
  expect(() => assertId('abcdefghijkl', 'id')).toThrow();
});
