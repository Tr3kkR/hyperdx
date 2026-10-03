/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows are mapped from this repository's fixed columns. */
import type { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import type { z } from 'zod';

import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type SavedSearchInput = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;
export type SavedSearchDoc = SavedSearchInput & {
  id: string;
  _id: string;
  team: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

const spec = {
  virtuals: true,
  dates: ['createdAt', 'updatedAt'],
  json: ['tags', 'filters'],
} as const;

function fromRow(
  row: Record<string, unknown> | undefined,
): SavedSearchDoc | null {
  if (!row) return null;
  const doc = rowToDoc(row, spec);
  doc.tags ??= [];
  doc.filters ??= [];
  return doc as SavedSearchDoc;
}

export function list(team: string): SavedSearchDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM savedsearches WHERE team = ? ORDER BY id')
      .all(normalizeId(team)) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function count(team: string): number {
  return (
    getDb()
      .prepare('SELECT count(*) AS n FROM savedsearches WHERE team = ?')
      .get(normalizeId(team)) as { n: number }
  ).n;
}

export function page(
  team: string,
  limit: number,
  offset: number,
): SavedSearchDoc[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM savedsearches WHERE team = ? ORDER BY id LIMIT ? OFFSET ?',
      )
      .all(normalizeId(team), limit, offset) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function findById(id: string, team: string): SavedSearchDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare('SELECT * FROM savedsearches WHERE id = ? AND team = ?')
      .get(normalizeId(id), normalizeId(team)),
  );
}

export function findManyByIds(ids: string[]): SavedSearchDoc[] {
  const validIds = ids.filter(isId).map(normalizeId);
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return (
    getDb()
      .prepare(`SELECT * FROM savedsearches WHERE id IN (${placeholders})`)
      .all(...validIds) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function create(
  team: string,
  input: SavedSearchInput & {
    _id?: string;
    createdBy?: string;
    updatedBy?: string;
  },
  userId?: string,
): SavedSearchDoc {
  const id = input._id ?? newId();
  const stamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO savedsearches
    (id,team,name,"select","where",whereLanguage,orderBy,source,tags,filters,createdBy,updatedBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      normalizeId(id),
      normalizeId(team),
      input.name ?? null,
      input.select ?? null,
      input.where ?? null,
      input.whereLanguage ?? null,
      input.orderBy ?? null,
      normalizeId(input.source),
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.filters ?? []),
      userId || input.createdBy
        ? normalizeId(userId ?? input.createdBy!)
        : null,
      userId || input.updatedBy
        ? normalizeId(userId ?? input.updatedBy!)
        : null,
      stamp,
      stamp,
    );
  return findById(id, team)!;
}

export function update(
  id: string,
  team: string,
  input: SavedSearchInput,
  userId?: string,
): SavedSearchDoc | null {
  return withTransaction(() => {
    if (!findById(id, team)) return null;
    // sqlite-port: findOneAndUpdate replaced the editable search fields while
    // retaining id, team, createdBy, and createdAt.
    return fromRow(
      getDb()
        .prepare(
          `UPDATE savedsearches SET
      name=?,"select"=?,"where"=?,whereLanguage=?,orderBy=?,source=?,tags=?,filters=?,updatedBy=?,updatedAt=?
      WHERE id=? AND team=? RETURNING *`,
        )
        .get(
          input.name ?? null,
          input.select ?? null,
          input.where ?? null,
          input.whereLanguage ?? null,
          input.orderBy ?? null,
          normalizeId(input.source),
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.filters ?? []),
          userId ? normalizeId(userId) : null,
          Date.now(),
          normalizeId(id),
          normalizeId(team),
        ),
    );
  });
}

export function remove(id: string, team: string): SavedSearchDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare(
        'DELETE FROM savedsearches WHERE id = ? AND team = ? RETURNING *',
      )
      .get(normalizeId(id), normalizeId(team)),
  );
}

export function toExternalJSON(doc: SavedSearchDoc) {
  return {
    id: doc.id,
    name: doc.name ?? '',
    select: doc.select,
    where: doc.where,
    whereLanguage: doc.whereLanguage,
    orderBy: doc.orderBy,
    sourceId: doc.source,
    tags: doc.tags,
    filters: doc.filters,
    teamId: doc.team,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
