/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns. */
import { getDb } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type FavoriteDoc = {
  _id: string;
  id: string;
  user: string;
  team: string;
  resourceType: 'dashboard' | 'savedSearch';
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
};

const spec = { virtuals: true, dates: ['createdAt', 'updatedAt'] } as const;
function fromRow(row: Record<string, unknown> | undefined): FavoriteDoc | null {
  return row ? (rowToDoc(row, spec) as FavoriteDoc) : null;
}

export function list(userId: string, teamId: string): FavoriteDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM favorites WHERE user = ? AND team = ?')
      .all(normalizeId(userId), normalizeId(teamId)) as Record<
      string,
      unknown
    >[]
  ).map(row => fromRow(row)!);
}

export function upsert(
  userId: string,
  teamId: string,
  resourceType: FavoriteDoc['resourceType'],
  resourceId: string,
): FavoriteDoc {
  const timestamp = Date.now();
  // sqlite-port: findOneAndUpdate({upsert:true,new:true}) becomes a conflict upsert.
  const row = getDb()
    .prepare(
      `INSERT INTO favorites
    (id,user,team,resourceType,resourceId,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(team,user,resourceType,resourceId) DO UPDATE SET updatedAt=excluded.updatedAt
    RETURNING *`,
    )
    .get(
      newId(),
      normalizeId(userId),
      normalizeId(teamId),
      resourceType,
      normalizeId(resourceId),
      timestamp,
      timestamp,
    );
  return fromRow(row)!;
}

export function remove(
  userId: string,
  teamId: string,
  resourceType: FavoriteDoc['resourceType'],
  resourceId: string,
): void {
  getDb()
    .prepare(
      'DELETE FROM favorites WHERE user = ? AND team = ? AND resourceType = ? AND resourceId = ?',
    )
    .run(
      normalizeId(userId),
      normalizeId(teamId),
      resourceType,
      normalizeId(resourceId),
    );
}
