/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows are mapped through this repository's fixed schema. */
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { docToRow, rowToDoc } from '@/db/mapper';

export type TeamDoc = {
  _id: string;
  id: string;
  name?: string;
  allowedAuthMethods: string[];
  hookId: string;
  apiKey: string;
  collectorAuthenticationEnforced: boolean;
  isMetricsSeriesTableEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadataMaxRowsToRead?: number;
  searchRowLimit?: number;
  queryTimeout?: number;
  fieldMetadataDisabled?: boolean;
  parallelizeWhenPossible?: boolean;
  filterKeysFetchLimit?: number;
};

const spec = {
  virtuals: true,
  json: ['allowedAuthMethods'],
  dates: ['createdAt', 'updatedAt'],
  booleans: [
    'collectorAuthenticationEnforced',
    'isMetricsSeriesTableEnabled',
    'fieldMetadataDisabled',
    'parallelizeWhenPossible',
  ],
} as const;

function fromRow(row: Record<string, unknown> | undefined): TeamDoc | null {
  if (!row) return null;
  const doc = rowToDoc(row, spec) as TeamDoc;
  doc.allowedAuthMethods ??= [];
  return doc;
}

export function countTeams(): number {
  return (
    getDb().prepare('SELECT count(*) AS count FROM teams').get() as {
      count: number;
    }
  ).count;
}

export function findTheTeam(): TeamDoc | null {
  return fromRow(getDb().prepare('SELECT * FROM teams LIMIT 1').get());
}

export function findById(id: string): TeamDoc | null {
  return fromRow(
    getDb().prepare('SELECT * FROM teams WHERE id = ?').get(normalizeId(id)),
  );
}

export function findByApiKey(apiKey: string): TeamDoc | null {
  return fromRow(
    getDb().prepare('SELECT * FROM teams WHERE apiKey = ?').get(apiKey),
  );
}

export function list(): TeamDoc[] {
  return (
    getDb().prepare('SELECT * FROM teams').all() as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function create(
  input: Pick<TeamDoc, 'name'> & Partial<TeamDoc>,
): TeamDoc {
  const timestamp = Date.now();
  const row = docToRow(
    {
      _id: input._id ?? newId(),
      name: input.name,
      allowedAuthMethods: input.allowedAuthMethods ?? [],
      hookId: input.hookId ?? uuidv4(),
      apiKey: input.apiKey ?? uuidv4(),
      collectorAuthenticationEnforced:
        input.collectorAuthenticationEnforced ?? false,
      isMetricsSeriesTableEnabled: input.isMetricsSeriesTableEnabled ?? false,
      createdAt: input.createdAt ?? new Date(timestamp),
      updatedAt: input.updatedAt ?? new Date(timestamp),
    },
    spec,
  );
  getDb()
    .prepare(
      `INSERT INTO teams
    (id,name,allowedAuthMethods,hookId,apiKey,collectorAuthenticationEnforced,isMetricsSeriesTableEnabled,createdAt,updatedAt)
    VALUES (@id,@name,@allowedAuthMethods,@hookId,@apiKey,@collectorAuthenticationEnforced,@isMetricsSeriesTableEnabled,@createdAt,@updatedAt)`,
    )
    .run(row);
  return findById(row.id as string)!;
}

const updateColumns = new Set([
  'name',
  'allowedAuthMethods',
  'hookId',
  'apiKey',
  'collectorAuthenticationEnforced',
  'isMetricsSeriesTableEnabled',
  'metadataMaxRowsToRead',
  'searchRowLimit',
  'queryTimeout',
  'fieldMetadataDisabled',
  'parallelizeWhenPossible',
  'filterKeysFetchLimit',
]);

export function update(id: string, changes: Partial<TeamDoc>): TeamDoc | null {
  return withTransaction(() => {
    const row = docToRow(changes, spec);
    const keys = Object.keys(row).filter(key => updateColumns.has(key));
    if (keys.length) {
      const columns = keys.map(key => `"${key}" = @${key}`).join(', ');
      getDb()
        .prepare(
          `UPDATE teams SET ${columns}, updatedAt = @updatedAt WHERE id = @id`,
        )
        .run({
          ...row,
          id: normalizeId(id),
          updatedAt: Date.now(),
        });
    }
    return findById(id);
  });
}
