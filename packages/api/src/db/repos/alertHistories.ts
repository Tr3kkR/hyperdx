/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows come from the fixed alerthistories table. */
import { getDb, withTransaction } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';
import { AlertState, IAlertError } from '@/models/alert';
import { IAlertHistory, IAlertHistoryAnalytics } from '@/models/alertHistory';

type Ref = { toString(): string };
export type HistoryDoc = Omit<IAlertHistory, 'alert'> & {
  _id: string;
  alert: string;
};
export type HistoryInput = Omit<
  IAlertHistory,
  'alert' | 'errors' | 'state' | 'counts' | 'lastValues'
> & {
  alert: Ref;
  state: string;
  counts?: number;
  lastValues?: IAlertHistory['lastValues'];
  errors?: { timestamp: Date; type: string; message: string }[];
  _id?: string;
};

function reviveErrors(
  errors: IAlertError[] | undefined,
): IAlertError[] | undefined {
  return errors?.map(error => ({
    ...error,
    timestamp: new Date(error.timestamp),
  }));
}

function fromRow(row: Record<string, unknown> | undefined): HistoryDoc | null {
  if (!row) return null;
  const doc = rowToDoc(row, {
    dates: ['createdAt'],
    booleans: ['fired'],
    json: ['lastValues', 'errors', 'analytics'],
  });
  doc.lastValues = ((doc.lastValues ?? []) as IAlertHistory['lastValues']).map(
    value => ({ ...value, startTime: new Date(value.startTime) }),
  );
  if (doc.errors) doc.errors = reviveErrors(doc.errors as IAlertError[]);
  return doc as HistoryDoc;
}

export function create(input: HistoryInput): HistoryDoc {
  const id = input._id ?? newId();
  getDb()
    .prepare(
      `INSERT INTO alerthistories
     (id,alert,counts,createdAt,state,lastValues,"group",fired,errors,analytics)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      normalizeId(String(id)),
      normalizeId(String(input.alert)),
      input.counts ?? 0,
      input.createdAt.getTime(),
      input.state,
      JSON.stringify(input.lastValues ?? []),
      input.group ?? null,
      input.fired == null ? null : Number(input.fired),
      input.errors == null ? null : JSON.stringify(input.errors),
      input.analytics == null ? null : JSON.stringify(input.analytics),
    );
  return fromRow(
    getDb()
      .prepare('SELECT * FROM alerthistories WHERE id=?')
      .get(normalizeId(String(id))),
  )!;
}

export function createMany(inputs: HistoryInput[]): HistoryDoc[] {
  return withTransaction(() => inputs.map(create));
}

export function upsertError(
  alert: Ref,
  createdAt: Date,
  errors: IAlertError[],
  analytics?: IAlertHistoryAnalytics,
): HistoryDoc {
  const id = newId();
  // sqlite-port: Mongo updateOne({alert,createdAt,state:ERROR},
  // {$set: errors/analytics, $setOnInsert:{counts:0,lastValues:[]}}, {upsert:true}).
  const row = getDb()
    .prepare(
      `INSERT INTO alerthistories
     (id,alert,counts,createdAt,state,lastValues,errors,analytics)
     VALUES (?,?,0,?,'ERROR','[]',?,?)
     ON CONFLICT(alert,createdAt,state) WHERE state='ERROR'
     DO UPDATE SET errors=excluded.errors,
       analytics=COALESCE(excluded.analytics,alerthistories.analytics)
     RETURNING *`,
    )
    .get(
      id,
      normalizeId(String(alert)),
      createdAt.getTime(),
      JSON.stringify(errors),
      analytics == null ? null : JSON.stringify(analytics),
    );
  return fromRow(row)!;
}

export function deleteErrors(alert: Ref, through: Date, after?: Date): number {
  const clause = after == null ? 'createdAt=?' : 'createdAt>? AND createdAt<=?';
  return Number(
    getDb()
      .prepare(
        `DELETE FROM alerthistories WHERE alert=? AND state='ERROR' AND ${clause}`,
      )
      .run(
        normalizeId(String(alert)),
        ...(after == null
          ? [through.getTime()]
          : [after.getTime(), through.getTime()]),
      ).changes,
  );
}

export function removeByAlert(alert: Ref): number {
  return Number(
    getDb()
      .prepare('DELETE FROM alerthistories WHERE alert=?')
      .run(normalizeId(String(alert))).changes,
  );
}

export function listByAlert(alert: Ref): HistoryDoc[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM alerthistories WHERE alert=? ORDER BY createdAt DESC,id',
      )
      .all(normalizeId(String(alert))) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export type GroupedWindow = { createdAt: Date; rows: HistoryDoc[] };

export function groupedWindows({
  alert,
  from,
  to,
  exclusiveTo = false,
  limit,
  ascending = false,
  excludeErrors = false,
}: {
  alert: Ref;
  from: Date;
  to: Date;
  exclusiveTo?: boolean;
  limit?: number;
  ascending?: boolean;
  excludeErrors?: boolean;
}): GroupedWindow[] {
  const sql = `SELECT createdAt, json_group_array(id) AS ids
    FROM alerthistories WHERE alert=? AND createdAt>=? AND createdAt${exclusiveTo ? '<' : '<='}?
    ${excludeErrors ? "AND state<>'ERROR'" : ''}
    GROUP BY createdAt ORDER BY createdAt ${ascending ? 'ASC' : 'DESC'}
    ${limit == null ? '' : 'LIMIT ?'}`;
  // sqlite-port: Mongo $match/$group/$push; SQL groups windows before LIMIT.
  const groups = getDb()
    .prepare(sql)
    .all(
      normalizeId(String(alert)),
      from.getTime(),
      to.getTime(),
      ...(limit == null ? [] : [limit]),
    ) as { createdAt: number; ids: string }[];
  if (!groups.length) return [];
  const ids = groups.flatMap(group => JSON.parse(group.ids) as string[]);
  const rows = getDb()
    .prepare(
      `SELECT * FROM alerthistories WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as Record<string, unknown>[];
  const byId = new Map(rows.map(row => [String(row.id), fromRow(row)!]));
  return groups.map(group => ({
    createdAt: new Date(group.createdAt),
    rows: (JSON.parse(group.ids) as string[]).map(id => byId.get(id)!),
  }));
}

export function groupedWindowsBatch(
  requests: { alert: Ref; from: Date }[],
  limit: number,
): Map<string, GroupedWindow[]> {
  const result = new Map<string, GroupedWindow[]>();
  if (!requests.length) return result;
  const args = requests.flatMap(request => [
    normalizeId(String(request.alert)),
    request.from.getTime(),
  ]);
  // sqlite-port: DocumentDB's per-alert PQueue fan-out becomes one SQL query
  // with per-alert lookback bounds and a ranked window count.
  const groups = getDb()
    .prepare(
      `WITH requests(alert,minTime) AS (VALUES ${requests.map(() => '(?,?)').join(',')}),
     grouped AS (
       SELECT h.alert,h.createdAt,json_group_array(h.id) AS ids
       FROM requests r JOIN alerthistories h
         ON h.alert=r.alert AND h.createdAt>=r.minTime
       GROUP BY h.alert,h.createdAt
     ), ranked AS (
       SELECT *,ROW_NUMBER() OVER (PARTITION BY alert ORDER BY createdAt DESC) rn
       FROM grouped
     ) SELECT alert,createdAt,ids FROM ranked WHERE rn<=?
       ORDER BY alert,createdAt DESC`,
    )
    .all(...args, limit) as { alert: string; createdAt: number; ids: string }[];
  if (!groups.length) return result;
  const ids = groups.flatMap(group => JSON.parse(group.ids) as string[]);
  const rows = getDb()
    .prepare(
      `SELECT * FROM alerthistories WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as Record<string, unknown>[];
  const byId = new Map(rows.map(row => [String(row.id), fromRow(row)!]));
  for (const group of groups) {
    const windows = result.get(group.alert) ?? [];
    windows.push({
      createdAt: new Date(group.createdAt),
      rows: (JSON.parse(group.ids) as string[]).map(id => byId.get(id)!),
    });
    result.set(group.alert, windows);
  }
  return result;
}

export function latestPerAlertGroup(
  alerts: Ref[],
  before: Date,
  since: Date,
): HistoryDoc[] {
  if (!alerts.length) return [];
  const ids = alerts.map(alert => normalizeId(String(alert)));
  // sqlite-port: Mongo sort then $group by (alert,group) with $first.
  const rows = getDb()
    .prepare(
      `SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY alert,"group" ORDER BY createdAt DESC,id DESC
      ) AS rownum FROM alerthistories
      WHERE alert IN (${ids.map(() => '?').join(',')})
        AND createdAt<=? AND createdAt>=? AND state<>'ERROR'
    ) WHERE rownum=1`,
    )
    .all(...ids, before.getTime(), since.getTime()) as Record<
    string,
    unknown
  >[];
  return rows.map(row => {
    delete row.rownum;
    return fromRow(row)!;
  });
}

export function listForAlertWindows(
  requests: { alert: Ref; from: Date; to: Date }[],
): HistoryDoc[] {
  if (!requests.length) return [];
  const args = requests.flatMap(request => [
    normalizeId(String(request.alert)),
    request.from.getTime(),
    request.to.getTime(),
  ]);
  // sqlite-port: Mongo per-alert $match/$sort is one bounded join over
  // requested alert windows. ERROR rows are not successful evaluations.
  const rows = getDb()
    .prepare(
      `WITH requests(alert,fromTime,toTime) AS (
      VALUES ${requests.map(() => '(?,?,?)').join(',')}
    ) SELECT h.* FROM requests r JOIN alerthistories h ON h.alert=r.alert
      WHERE h.createdAt>=r.fromTime AND h.createdAt<r.toTime
        AND h.state<>'ERROR'
      ORDER BY h.alert,h."group",h.createdAt DESC`,
    )
    .all(...args) as Record<string, unknown>[];
  return rows.map(row => fromRow(row)!);
}

export function insertBatchAndUpdateAlert(
  histories: HistoryInput[],
  alert: Ref,
  state: AlertState,
  errors: IAlertError[],
): void {
  withTransaction(() => {
    for (const history of histories) create(history);
    getDb()
      .prepare(
        'UPDATE alerts SET state=?,executionErrors=?,updatedAt=? WHERE id=?',
      )
      .run(
        state,
        JSON.stringify(errors),
        Date.now(),
        normalizeId(String(alert)),
      );
  });
}
