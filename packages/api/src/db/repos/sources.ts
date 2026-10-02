/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns and JSON config. */
import type { TSource, TSourceNoId } from '@hyperdx/common-utils/dist/types';

import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type SourceDoc = TSource & {
  _id: string;
  team: string;
  createdAt: Date;
  updatedAt: Date;
};

const spec = {
  virtuals: true,
  dates: ['createdAt', 'updatedAt'],
  booleans: ['disabled'],
  json: ['querySettings', 'config'],
} as const;
const commonKeys = new Set([
  'id',
  '_id',
  'team',
  'connection',
  'kind',
  'name',
  'section',
  'disabled',
  'from',
  'timestampValueExpression',
  'querySettings',
  'createdAt',
  'updatedAt',
]);

function fromRow(row: Record<string, unknown> | undefined): SourceDoc | null {
  if (!row) return null;
  const { config, fromDatabaseName, fromTableName, ...common } = rowToDoc(
    row,
    spec,
  );
  const doc = { ...common, ...(config as Record<string, unknown>) };
  if (fromDatabaseName !== undefined || fromTableName !== undefined) {
    doc.from = { databaseName: fromDatabaseName, tableName: fromTableName };
  }
  doc.querySettings ??= [];
  if (doc.kind === 'log' || doc.kind === 'trace') {
    doc.highlightedTraceAttributeExpressions ??= [];
    doc.highlightedRowAttributeExpressions ??= [];
    doc.materializedViews ??= [];
  }
  return doc as SourceDoc;
}

function configFor(input: Record<string, unknown>): string {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!commonKeys.has(key) && value !== undefined) config[key] = value;
  }
  return JSON.stringify(config);
}

function validateQuerySettings(settings: unknown): void {
  if (settings === undefined || settings === null) return;
  if (
    !Array.isArray(settings) ||
    settings.length > 10 ||
    settings.some(
      item =>
        item == null ||
        typeof item !== 'object' ||
        typeof item.setting !== 'string' ||
        item.setting.length === 0 ||
        typeof item.value !== 'string' ||
        item.value.length === 0,
    )
  ) {
    throw new Error(
      'querySettings exceeds the limit of 10 or contains an invalid item',
    );
  }
}

export function list(team?: string): SourceDoc[] {
  const rows = team
    ? getDb()
        .prepare('SELECT * FROM sources WHERE team = ?')
        .all(normalizeId(team))
    : getDb().prepare('SELECT * FROM sources').all();
  return (rows as Record<string, unknown>[]).map(row => fromRow(row)!);
}

export function findById(id: string, team?: string): SourceDoc | null {
  if (!isId(id)) return null;
  const sql = team
    ? 'SELECT * FROM sources WHERE id = ? AND team = ?'
    : 'SELECT * FROM sources WHERE id = ?';
  const params = team
    ? [normalizeId(id), normalizeId(team)]
    : [normalizeId(id)];
  return fromRow(
    getDb()
      .prepare(sql)
      .get(...params),
  );
}

export function create(
  team: string,
  input: TSourceNoId & { _id?: string },
): SourceDoc {
  validateQuerySettings(input.querySettings);
  const id = input._id ?? newId();
  const timestamp = Date.now();
  const from = input.from;
  getDb()
    .prepare(
      `INSERT INTO sources
    (id,team,connection,kind,name,section,disabled,fromDatabaseName,fromTableName,timestampValueExpression,querySettings,config,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      normalizeId(id),
      normalizeId(team),
      normalizeId(input.connection),
      input.kind,
      input.name ?? null,
      input.section ?? null,
      Number(input.disabled ?? false),
      from?.databaseName ?? null,
      from?.tableName ?? null,
      input.timestampValueExpression ?? null,
      JSON.stringify(input.querySettings ?? []),
      configFor(input),
      timestamp,
      timestamp,
    );
  return findById(id, team)!;
}

export function replace(
  id: string,
  team: string,
  input: TSourceNoId,
): SourceDoc | null {
  validateQuerySettings(input.querySettings);
  return withTransaction(() => {
    if (!findById(id, team)) return null;
    // sqlite-port: discriminator findOneAndReplace and collection.replaceOne
    // both replace all kind-specific fields while retaining id and createdAt.
    return fromRow(
      getDb()
        .prepare(
          `UPDATE sources SET
      connection=?,kind=?,name=?,section=?,disabled=?,fromDatabaseName=?,fromTableName=?,
      timestampValueExpression=?,querySettings=?,config=?,updatedAt=?
      WHERE id=? AND team=? RETURNING *`,
        )
        .get(
          normalizeId(input.connection),
          input.kind,
          input.name ?? null,
          input.section ?? null,
          Number(input.disabled ?? false),
          input.from?.databaseName ?? null,
          input.from?.tableName ?? null,
          input.timestampValueExpression ?? null,
          JSON.stringify(input.querySettings ?? []),
          configFor(input),
          Date.now(),
          normalizeId(id),
          normalizeId(team),
        ),
    );
  });
}

export function remove(id: string, team: string): SourceDoc | null {
  return fromRow(
    getDb()
      .prepare('DELETE FROM sources WHERE id = ? AND team = ? RETURNING *')
      .get(normalizeId(id), normalizeId(team)),
  );
}
