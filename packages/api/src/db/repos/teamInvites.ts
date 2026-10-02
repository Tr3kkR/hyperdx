/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns. */
import { getDb, withTransaction } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type TeamInviteDoc = {
  _id: string;
  teamId: string;
  name?: string;
  email: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
};

const spec = { dates: ['createdAt', 'updatedAt'] } as const;
function fromRow(
  row: Record<string, unknown> | undefined,
): TeamInviteDoc | null {
  return row ? (rowToDoc(row, spec) as TeamInviteDoc) : null;
}

export function findById(id: string): TeamInviteDoc | null {
  return fromRow(
    getDb()
      .prepare('SELECT * FROM teaminvites WHERE id = ?')
      .get(normalizeId(id)),
  );
}

export function findByToken(token: string): TeamInviteDoc | null {
  return fromRow(
    getDb().prepare('SELECT * FROM teaminvites WHERE token = ?').get(token),
  );
}

export function findByEmail(email: string): TeamInviteDoc | null {
  return fromRow(
    getDb()
      .prepare('SELECT * FROM teaminvites WHERE email = ? LIMIT 1')
      .get(email.toLowerCase()),
  );
}

export function listByEmail(email: string): TeamInviteDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM teaminvites WHERE email = ?')
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function findByTeamEmail(
  teamId: string,
  email: string,
): TeamInviteDoc | null {
  return fromRow(
    getDb()
      .prepare('SELECT * FROM teaminvites WHERE teamId = ? AND email = ?')
      .get(normalizeId(teamId), email.toLowerCase()),
  );
}

export function listByTeam(teamId: string): TeamInviteDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM teaminvites WHERE teamId = ?')
      .all(normalizeId(teamId)) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function create(input: {
  teamId: string;
  email: string;
  name?: string;
  token: string;
}): TeamInviteDoc {
  const id = newId();
  const timestamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO teaminvites
    (id,teamId,name,email,token,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      normalizeId(input.teamId),
      input.name ?? null,
      input.email.toLowerCase(),
      input.token,
      timestamp,
      timestamp,
    );
  return findById(id)!;
}

export function createIfAbsent(
  input: Parameters<typeof create>[0],
): TeamInviteDoc {
  return withTransaction(() => {
    // sqlite-port: findOne followed by save, serialized by BEGIN IMMEDIATE.
    return findByTeamEmail(input.teamId, input.email) ?? create(input);
  });
}

export function deleteById(id: string, teamId?: string): TeamInviteDoc | null {
  const args = teamId
    ? [normalizeId(id), normalizeId(teamId)]
    : [normalizeId(id)];
  const sql = teamId
    ? 'DELETE FROM teaminvites WHERE id = ? AND teamId = ? RETURNING *'
    : 'DELETE FROM teaminvites WHERE id = ? RETURNING *';
  return fromRow(
    getDb()
      .prepare(sql)
      .get(...args),
  );
}
