/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns. */
import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';

import { getDb } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type PinnedFilterDoc = {
  _id: string;
  team: string;
  source: string;
  fields: string[];
  filters: PinnedFiltersValue;
  createdAt: Date;
  updatedAt: Date;
};

const spec = {
  json: ['fields', 'filters'],
  dates: ['createdAt', 'updatedAt'],
} as const;
function fromRow(
  row: Record<string, unknown> | undefined,
): PinnedFilterDoc | null {
  return row ? (rowToDoc(row, spec) as PinnedFilterDoc) : null;
}

export function find(teamId: string, sourceId: string): PinnedFilterDoc | null {
  return fromRow(
    getDb()
      .prepare('SELECT * FROM pinnedfilters WHERE team = ? AND source = ?')
      .get(normalizeId(teamId), normalizeId(sourceId)),
  );
}

export function upsert(
  teamId: string,
  sourceId: string,
  data: Pick<PinnedFilterDoc, 'fields' | 'filters'>,
): PinnedFilterDoc {
  const timestamp = Date.now();
  // sqlite-port: findOneAndUpdate({upsert:true,new:true}) becomes a conflict upsert.
  const row = getDb()
    .prepare(
      `INSERT INTO pinnedfilters
    (id,team,source,fields,filters,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(team,source) DO UPDATE SET fields=excluded.fields,filters=excluded.filters,updatedAt=excluded.updatedAt
    RETURNING *`,
    )
    .get(
      newId(),
      normalizeId(teamId),
      normalizeId(sourceId),
      JSON.stringify(data.fields),
      JSON.stringify(data.filters),
      timestamp,
      timestamp,
    );
  return fromRow(row)!;
}
