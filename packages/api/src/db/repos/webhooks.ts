/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows have the fixed schema mapped below. */
import { WebhookService } from '@hyperdx/common-utils/dist/types';

import { getDb } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export { WebhookService };

export type WebhookDoc = {
  _id: string;
  id: string;
  team: string;
  name: string;
  service: WebhookService;
  url?: string;
  description?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WebhookLike = Pick<
  WebhookDoc,
  | '_id'
  | 'team'
  | 'name'
  | 'service'
  | 'url'
  | 'description'
  | 'body'
  | 'headers'
  | 'queryParams'
>;

export type WebhookFields = Pick<WebhookDoc, 'name' | 'service' | 'url'> &
  Partial<Pick<WebhookDoc, 'description' | 'queryParams' | 'headers' | 'body'>>;

const spec = {
  virtuals: true,
  dates: ['createdAt', 'updatedAt'],
  json: ['queryParams', 'headers'],
} as const;

function fromRow(row: Record<string, unknown> | undefined): WebhookDoc | null {
  return row ? (rowToDoc(row, spec) as WebhookDoc) : null;
}

export function list(
  team: string,
  service?: WebhookService | WebhookService[],
): WebhookDoc[] {
  const services =
    service == null ? [] : Array.isArray(service) ? service : [service];
  const predicate = services.length
    ? ` AND service IN (${services.map(() => '?').join(',')})`
    : '';
  return (
    getDb()
      .prepare(`SELECT * FROM webhooks WHERE team=?${predicate} ORDER BY id`)
      .all(normalizeId(team), ...services) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function page(
  team: string,
  limit: number,
  offset: number,
): WebhookDoc[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM webhooks WHERE team=? ORDER BY id LIMIT ? OFFSET ?',
      )
      .all(normalizeId(team), limit, offset) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function count(team: string): number {
  return (
    getDb()
      .prepare('SELECT count(*) AS n FROM webhooks WHERE team=?')
      .get(normalizeId(team)) as { n: number }
  ).n;
}

export function countIds(team: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return (
    getDb()
      .prepare(
        `SELECT count(*) AS n FROM webhooks WHERE team=? AND id IN (${placeholders})`,
      )
      .get(normalizeId(team), ...ids.map(normalizeId)) as { n: number }
  ).n;
}

export function findById(id: string, team: string): WebhookDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare('SELECT * FROM webhooks WHERE id=? AND team=?')
      .get(normalizeId(id), normalizeId(team)),
  );
}

export function findByName(
  team: string,
  service: WebhookService,
  name: string,
  excludingId?: string,
): WebhookDoc | null {
  return fromRow(
    getDb()
      .prepare(
        'SELECT * FROM webhooks WHERE team=? AND service=? AND name=? AND id<>?',
      )
      .get(normalizeId(team), service, name, excludingId ?? ''),
  );
}

export function create(
  team: string,
  fields: WebhookFields,
  id = newId(),
): WebhookDoc {
  const stamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO webhooks
    (id,team,name,service,url,description,queryParams,headers,body,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      normalizeId(id),
      normalizeId(team),
      fields.name,
      fields.service,
      fields.url ?? null,
      fields.description ?? null,
      fields.queryParams ? JSON.stringify(fields.queryParams) : null,
      fields.headers ? JSON.stringify(fields.headers) : null,
      fields.body ?? null,
      stamp,
      stamp,
    );
  return findById(id, team)!;
}

export function updateIfDestinationMatches(
  id: string,
  team: string,
  expectedUrl: string | undefined,
  expectedService: WebhookService,
  fields: WebhookFields,
): WebhookDoc | null {
  // sqlite-port: findOneAndUpdate's url/service filter is an optimistic compare-and-swap.
  return fromRow(
    getDb()
      .prepare(
        `UPDATE webhooks SET
    name=?,service=?,url=?,description=?,queryParams=?,headers=?,body=?,updatedAt=?
    WHERE id=? AND team=? AND url IS ? AND service=? RETURNING *`,
      )
      .get(
        fields.name,
        fields.service,
        fields.url ?? null,
        fields.description ?? null,
        fields.queryParams ? JSON.stringify(fields.queryParams) : null,
        fields.headers ? JSON.stringify(fields.headers) : null,
        fields.body ?? null,
        Date.now(),
        normalizeId(id),
        normalizeId(team),
        expectedUrl ?? null,
        expectedService,
      ),
  );
}

export function remove(id: string, team: string): WebhookDoc | null {
  if (!isId(id)) return null;
  return fromRow(
    getDb()
      .prepare('DELETE FROM webhooks WHERE id=? AND team=? RETURNING *')
      .get(normalizeId(id), normalizeId(team)),
  );
}
