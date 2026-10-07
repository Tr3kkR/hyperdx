/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows are mapped from this repository's fixed columns. */
import type { DashboardWithoutIdSchema } from '@hyperdx/common-utils/dist/types';
import type { z } from 'zod';

import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type DashboardInput = z.infer<typeof DashboardWithoutIdSchema>;
export type DashboardDoc = DashboardInput & {
  id: string;
  _id: string;
  team: string;
  createdBy?: string;
  updatedBy?: string;
  provisioned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const spec = {
  virtuals: true,
  dates: ['createdAt', 'updatedAt'],
  booleans: ['provisioned'],
  json: [
    'tiles',
    'tags',
    'filters',
    'savedFilterValues',
    'savedDateRange',
    'containers',
  ],
} as const;

function fromRow(
  row: Record<string, unknown> | undefined,
): DashboardDoc | null {
  if (!row) return null;
  const doc = rowToDoc(row, spec);
  doc.tags ??= [];
  doc.filters ??= [];
  doc.savedFilterValues ??= [];
  doc.containers ??= [];
  return doc as DashboardDoc;
}

export function list(team: string): DashboardDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM dashboards WHERE team=? ORDER BY id')
      .all(normalizeId(team)) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function search(
  team: string,
  query: string | undefined,
  tags: string[] | undefined,
  limit: number,
): DashboardDoc[] {
  const pattern = query?.replace(/[\\%_]/g, '\\$&');
  // sqlite-port: Mongo $regex (case-insensitive substring) and $all tags.
  const rows = getDb()
    .prepare(
      `SELECT * FROM dashboards d WHERE d.team=?
    AND (? IS NULL OR d.name LIKE ? ESCAPE '\\' COLLATE NOCASE)
    AND (? IS NULL OR NOT EXISTS (
      SELECT 1 FROM json_each(?) required WHERE NOT EXISTS (
        SELECT 1 FROM json_each(d.tags) actual WHERE actual.value=required.value
      ))) ORDER BY d.id LIMIT ?`,
    )
    .all(
      normalizeId(team),
      pattern == null ? null : 1,
      pattern == null ? null : `%${pattern}%`,
      tags == null ? null : 1,
      tags == null ? null : JSON.stringify(tags),
      limit,
    ) as Record<string, unknown>[];
  return rows.map(row => fromRow(row)!);
}

export function page(
  team: string,
  limit: number,
  offset: number,
): DashboardDoc[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM dashboards WHERE team=? ORDER BY id LIMIT ? OFFSET ?',
      )
      .all(normalizeId(team), limit, offset) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function count(team: string): number {
  return (
    getDb()
      .prepare('SELECT count(*) AS n FROM dashboards WHERE team=?')
      .get(normalizeId(team)) as { n: number }
  ).n;
}

export function findById(id: string, team: string): DashboardDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare('SELECT * FROM dashboards WHERE id=? AND team=?')
      .get(normalizeId(id), normalizeId(team)),
  );
}

export function findByIdAnyTeam(id: string): DashboardDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb().prepare('SELECT * FROM dashboards WHERE id=?').get(normalizeId(id)),
  );
}

export function findManyByIds(ids: string[]): DashboardDoc[] {
  const validIds = ids.filter(isId).map(normalizeId);
  if (!validIds.length) return [];
  return (
    getDb()
      .prepare(
        `SELECT * FROM dashboards WHERE id IN (${validIds.map(() => '?').join(',')})`,
      )
      .all(...validIds) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function hasUnprovisionedName(team: string, name: string): boolean {
  return (
    getDb()
      .prepare(
        'SELECT 1 FROM dashboards WHERE team=? AND name=? AND provisioned=0 LIMIT 1',
      )
      .get(normalizeId(team), name) != null
  );
}

export function upsertProvisioned(
  team: string,
  input: DashboardInput,
): { dashboard: DashboardDoc; created: boolean } {
  return withTransaction(() => {
    const old = getDb()
      .prepare(
        'SELECT id FROM dashboards WHERE team=? AND name=? AND provisioned=1',
      )
      .get(normalizeId(team), input.name) as { id: string } | undefined;
    const id = old?.id ?? newId();
    const stamp = Date.now();
    // sqlite-port: findOneAndUpdate({provisioned:true}, {$set,$setOnInsert}, {upsert:true,new:false}).
    const row = getDb()
      .prepare(
        `INSERT INTO dashboards
      (id,team,name,tiles,tags,filters,savedQuery,savedQueryLanguage,savedFilterValues,containers,provisioned,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(name,team) WHERE provisioned=1 DO UPDATE SET
      tiles=excluded.tiles,tags=excluded.tags,filters=excluded.filters,savedQuery=excluded.savedQuery,
      savedQueryLanguage=excluded.savedQueryLanguage,savedFilterValues=excluded.savedFilterValues,
      containers=excluded.containers,updatedAt=excluded.updatedAt RETURNING *`,
      )
      .get(
        id,
        normalizeId(team),
        input.name,
        JSON.stringify(input.tiles ?? []),
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.filters ?? []),
        input.savedQuery ?? null,
        input.savedQueryLanguage ?? null,
        JSON.stringify(input.savedFilterValues ?? []),
        JSON.stringify(input.containers ?? []),
        stamp,
        stamp,
      ) as Record<string, unknown>;
    return { dashboard: fromRow(row)!, created: !old };
  });
}

export function create(
  team: string,
  input: DashboardInput & {
    _id?: string;
    provisioned?: boolean;
    createdBy?: string;
    updatedBy?: string;
  },
): DashboardDoc {
  const id = input._id ?? newId();
  const stamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO dashboards
    (id,team,name,tiles,tags,filters,savedQuery,savedQueryLanguage,savedFilterValues,savedDateRange,containers,
     createdBy,updatedBy,provisioned,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      normalizeId(id),
      normalizeId(team),
      input.name,
      JSON.stringify(input.tiles),
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.filters ?? []),
      input.savedQuery ?? null,
      input.savedQueryLanguage ?? null,
      JSON.stringify(input.savedFilterValues ?? []),
      input.savedDateRange == null
        ? null
        : JSON.stringify(input.savedDateRange),
      JSON.stringify(input.containers ?? []),
      input.createdBy == null ? null : normalizeId(input.createdBy),
      input.updatedBy == null ? null : normalizeId(input.updatedBy),
      input.provisioned ? 1 : 0,
      stamp,
      stamp,
    );
  return findById(id, team)!;
}

export function update(
  id: string,
  team: string,
  updates: Partial<DashboardInput> & {
    updatedBy?: string;
    provisioned?: boolean;
  },
): DashboardDoc | null {
  return withTransaction(() => {
    const old = findById(id, team);
    if (!old) return null;
    const next = { ...old, ...updates };
    // sqlite-port: findOneAndUpdate applied a partial $set while retaining omitted fields.
    return fromRow(
      getDb()
        .prepare(
          `UPDATE dashboards SET
      name=?,tiles=?,tags=?,filters=?,savedQuery=?,savedQueryLanguage=?,savedFilterValues=?,savedDateRange=?,containers=?,
      updatedBy=?,provisioned=?,updatedAt=? WHERE id=? AND team=? RETURNING *`,
        )
        .get(
          next.name,
          JSON.stringify(next.tiles),
          JSON.stringify(next.tags ?? []),
          JSON.stringify(next.filters ?? []),
          next.savedQuery ?? null,
          next.savedQueryLanguage ?? null,
          next.savedFilterValues == null
            ? null
            : JSON.stringify(next.savedFilterValues),
          next.savedDateRange == null
            ? null
            : JSON.stringify(next.savedDateRange),
          next.containers == null ? null : JSON.stringify(next.containers),
          next.updatedBy == null ? null : normalizeId(next.updatedBy),
          next.provisioned ? 1 : 0,
          Date.now(),
          normalizeId(id),
          normalizeId(team),
        ),
    );
  });
}

export function patchTile(
  id: string,
  team: string,
  tileId: string | undefined,
  tile: DashboardInput['tiles'][number] | undefined,
  updates: Partial<DashboardInput>,
): DashboardDoc | null {
  return withTransaction(() => {
    const old = findById(id, team);
    if (!old) return null;
    if (tileId === undefined) return update(id, team, updates);
    const index = old.tiles.findIndex(t => t.id === tileId);
    if (index < 0 || !tile) return null;
    // sqlite-port: Mongo positional tiles.$ update reads and replaces the matching tile atomically.
    const tiles = [...old.tiles];
    tiles[index] = tile;
    return update(id, team, { ...updates, tiles });
  });
}

export function remove(id: string, team: string): DashboardDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare('DELETE FROM dashboards WHERE id=? AND team=? RETURNING *')
      .get(normalizeId(id), normalizeId(team)),
  );
}
