/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows are mapped from the fixed alerts table. */
import { isRangeThresholdType } from '@hyperdx/common-utils/dist/types';

import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';
import { AlertSource, AlertState, IAlert, IAlertError } from '@/models/alert';

type Ref = { toString(): string };
export type AlertFields = Partial<
  Omit<IAlert, 'id' | 'createdAt' | 'updatedAt' | 'team'>
> & { threshold: number; interval: IAlert['interval'] };
export type AlertDoc = Omit<
  IAlert,
  'id' | 'team' | 'createdBy' | 'savedSearch' | 'dashboard' | 'silenced'
> & {
  id: string;
  _id: string;
  team: string;
  createdBy?: string;
  savedSearch?: string | null;
  dashboard?: string | null;
  silenced?: { by?: string; at: Date; until: Date };
};

const columns = [
  'threshold',
  'thresholdMax',
  'thresholdType',
  'interval',
  'scheduleOffsetMinutes',
  'scheduleStartAt',
  'channel',
  'channels',
  'state',
  'source',
  'createdBy',
  'name',
  'message',
  'note',
  'displayName',
  'tags',
  'savedSearch',
  'groupBy',
  'dashboard',
  'tileId',
  'chartConfig',
  'numConsecutiveWindows',
  'silencedBy',
  'silencedAt',
  'silencedUntil',
  'executionErrors',
] as const;

const jsonColumns = new Set<string>([
  'channel',
  'channels',
  'tags',
  'chartConfig',
  'executionErrors',
]);
const dateColumns = new Set<string>([
  'scheduleStartAt',
  'silencedAt',
  'silencedUntil',
]);
const refColumns = new Set<string>([
  'createdBy',
  'savedSearch',
  'dashboard',
  'silencedBy',
]);

function sqlValue(column: string, value: unknown): string | number | null {
  if (value == null) return null;
  if (jsonColumns.has(column)) return JSON.stringify(value);
  if (dateColumns.has(column)) return new Date(value as string).getTime();
  if (refColumns.has(column)) return normalizeId(String(value));
  return value as string | number;
}

function values(fields: Partial<AlertFields>) {
  const silenced = fields.silenced;
  const source = {
    ...fields,
    silencedBy: silenced?.by,
    silencedAt: silenced?.at,
    silencedUntil: silenced?.until,
  } as Record<string, unknown>;
  return columns.map(column => sqlValue(column, source[column]));
}

function fromRow(row: Record<string, unknown> | undefined): AlertDoc | null {
  if (!row) return null;
  const doc = rowToDoc(row, {
    virtuals: true,
    json: [...jsonColumns],
    dates: ['createdAt', 'updatedAt', ...dateColumns],
  });
  // These fields are explicitly cleared to null by makeAlert; preserve their
  // public response shape. NULL in tags/channels/executionErrors instead means
  // "never set" (D8) and remains absent from the mapped document.
  for (const column of [
    'name',
    'message',
    'note',
    'savedSearch',
    'groupBy',
    'dashboard',
    'tileId',
    'chartConfig',
    'numConsecutiveWindows',
  ]) {
    if (row[column] === null) doc[column] = null;
  }
  if (doc.silencedAt instanceof Date && doc.silencedUntil instanceof Date) {
    doc.silenced = {
      ...(doc.silencedBy ? { by: doc.silencedBy } : {}),
      at: doc.silencedAt,
      until: doc.silencedUntil,
    };
  }
  delete doc.silencedBy;
  delete doc.silencedAt;
  delete doc.silencedUntil;
  if (Array.isArray(doc.executionErrors)) {
    doc.executionErrors = doc.executionErrors.map((error: IAlertError) => ({
      ...error,
      timestamp: new Date(error.timestamp),
    }));
  }
  return doc as AlertDoc;
}

export function findById(id: Ref, team?: Ref): AlertDoc | null {
  if (!isId(String(id))) return null;
  const row =
    team == null
      ? getDb()
          .prepare('SELECT * FROM alerts WHERE id=?')
          .get(normalizeId(String(id)))
      : getDb()
          .prepare('SELECT * FROM alerts WHERE id=? AND team=?')
          .get(normalizeId(String(id)), normalizeId(String(team)));
  return fromRow(row);
}

export function list(team?: Ref): AlertDoc[] {
  const rows =
    team == null
      ? getDb().prepare('SELECT * FROM alerts ORDER BY id').all()
      : getDb()
          .prepare('SELECT * FROM alerts WHERE team=? ORDER BY id')
          .all(normalizeId(String(team)));
  return (rows as Record<string, unknown>[]).map(row => fromRow(row)!);
}

export function count(team: Ref): number {
  return (
    getDb()
      .prepare('SELECT count(*) AS n FROM alerts WHERE team=?')
      .get(normalizeId(String(team))) as { n: number }
  ).n;
}

export function page(
  team: Ref,
  filters: {
    createdBy?: string;
    tags?: string[];
    states?: AlertState[];
    sources?: AlertSource[];
    search?: string;
    cursor?: { name: string | null; id: string };
    limit?: number;
  },
): AlertDoc[] {
  const where = ['team=?'];
  const args: (string | number)[] = [normalizeId(String(team))];
  if (filters.createdBy) {
    where.push('createdBy=?');
    args.push(normalizeId(filters.createdBy));
  }
  if (filters.tags) {
    where.push(`EXISTS (SELECT 1 FROM json_each(alerts.tags) tag
      WHERE tag.value IN (${filters.tags.map(() => '?').join(',')}))`);
    args.push(...filters.tags);
  }
  if (filters.states) {
    where.push(`state IN (${filters.states.map(() => '?').join(',')})`);
    args.push(...filters.states);
  }
  if (filters.sources) {
    where.push(`source IN (${filters.sources.map(() => '?').join(',')})`);
    args.push(...filters.sources);
  }
  if (filters.search) {
    // sqlite-port: Mongo case-insensitive $regex substring search.
    where.push("displayName LIKE ? ESCAPE '\\' COLLATE NOCASE");
    args.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (filters.cursor) {
    const { name, id } = filters.cursor;
    if (name === null) {
      // SQLite sorts NULL before text, matching Mongo's null cursor branch.
      where.push('((displayName IS NULL AND id>?) OR displayName IS NOT NULL)');
      args.push(normalizeId(id));
    } else {
      where.push('(displayName>? OR (displayName=? AND id>?))');
      args.push(name, name, normalizeId(id));
    }
  }
  const sql = `SELECT * FROM alerts WHERE ${where.join(' AND ')}
    ORDER BY displayName,id ${filters.limit == null ? '' : 'LIMIT ?'}`;
  if (filters.limit != null) args.push(filters.limit);
  return (
    getDb()
      .prepare(sql)
      .all(...args) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function create(team: Ref, fields: AlertFields, id = newId()): AlertDoc {
  const stamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO alerts (id,team,${columns.join(',')},createdAt,updatedAt)
     VALUES (${Array.from({ length: columns.length + 4 }, () => '?').join(',')})`,
    )
    .run(
      normalizeId(id),
      normalizeId(String(team)),
      ...values({
        state: AlertState.OK,
        source: AlertSource.SAVED_SEARCH,
        ...fields,
      }),
      stamp,
      stamp,
    );
  return findById(id, team)!;
}

export function update(
  id: Ref,
  team: Ref,
  fields: Partial<AlertFields>,
): AlertDoc | null {
  return withTransaction(() => {
    const previous = findById(id, team);
    if (!previous) return null;
    const next = { ...previous, ...fields };
    if (fields.thresholdType && !isRangeThresholdType(fields.thresholdType)) {
      next.thresholdMax = undefined;
    }
    // sqlite-port: Mongo $set/$unset; a non-range comparator clears thresholdMax.
    getDb()
      .prepare(
        `UPDATE alerts SET ${columns.map(column => `${column}=?`).join(',')},updatedAt=?
       WHERE id=? AND team=?`,
      )
      .run(
        ...values(next),
        Date.now(),
        normalizeId(String(id)),
        normalizeId(String(team)),
      );
    return findById(id, team);
  });
}

export function remove(id: Ref, team: Ref): boolean {
  if (!isId(String(id))) return false;
  return (
    getDb()
      .prepare('DELETE FROM alerts WHERE id=? AND team=?')
      .run(normalizeId(String(id)), normalizeId(String(team))).changes === 1
  );
}

export function removeBySavedSearch(savedSearch: Ref, team: Ref): number {
  return Number(
    getDb()
      .prepare('DELETE FROM alerts WHERE savedSearch=? AND team=?')
      .run(normalizeId(String(savedSearch)), normalizeId(String(team))).changes,
  );
}

export function removeByDashboard(
  dashboard: Ref,
  team: Ref,
  tileIds?: string[],
): number {
  const tiles =
    tileIds == null
      ? ''
      : ` AND tileId IN (${tileIds.map(() => '?').join(',')})`;
  if (tileIds?.length === 0) return 0;
  return Number(
    getDb()
      .prepare(
        `DELETE FROM alerts WHERE dashboard=? AND team=? AND source=?${tiles}`,
      )
      .run(
        normalizeId(String(dashboard)),
        normalizeId(String(team)),
        AlertSource.TILE,
        ...(tileIds ?? []),
      ).changes,
  );
}

export function countReferencingWebhook(team: Ref, webhookId: Ref): number {
  // sqlite-port: Mongo 'channel.webhookId' and 'channels.webhookId' predicates.
  return (
    getDb()
      .prepare(
        `SELECT count(*) AS n FROM alerts WHERE team=? AND (
      json_extract(channel,'$.webhookId')=? OR EXISTS (
        SELECT 1 FROM json_each(channels) c
        WHERE json_extract(c.value,'$.webhookId')=?
      ))`,
      )
      .get(normalizeId(String(team)), String(webhookId), String(webhookId)) as {
      n: number;
    }
  ).n;
}

export function findTileAlert(
  team: Ref,
  dashboard: Ref,
  tileId: string,
): AlertDoc | null {
  return fromRow(
    getDb()
      .prepare(
        'SELECT * FROM alerts WHERE team=? AND dashboard=? AND tileId=? AND source=?',
      )
      .get(
        normalizeId(String(team)),
        normalizeId(String(dashboard)),
        tileId,
        AlertSource.TILE,
      ),
  );
}

export function upsertTileAlert(
  team: Ref,
  dashboard: Ref,
  tileId: string,
  fields: AlertFields,
): AlertDoc {
  return withTransaction(() => {
    const previous = findTileAlert(team, dashboard, tileId);
    if (previous) return update(previous.id, team, fields)!;
    return create(team, {
      ...fields,
      source: AlertSource.TILE,
      dashboard: dashboard as IAlert['dashboard'],
      tileId,
      state: AlertState.OK,
    });
  });
}
