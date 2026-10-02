export function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  // sqlite-port: Mongo E11000 duplicate key. Node 22's node:sqlite reports
  // ERR_SQLITE_ERROR with the extended constraint in the message, rather
  // than exposing SQLITE_CONSTRAINT_UNIQUE as its code.
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'ERR_SQLITE_ERROR' &&
    typeof candidate.message === 'string' &&
    candidate.message.startsWith('UNIQUE constraint failed:')
  );
}
