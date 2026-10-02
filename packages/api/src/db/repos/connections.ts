/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns. */
import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { docToRow, rowToDoc } from '@/db/mapper';

export type ConnectionDoc = {
  _id: string;
  id: string;
  team: string;
  name: string;
  host: string;
  username: string;
  password?: string;
  hyperdxSettingPrefix?: string;
  isPrometheusEndpoint?: boolean;
  platformProvisioned?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const spec = {
  virtuals: true,
  dates: ['createdAt', 'updatedAt'],
  booleans: ['isPrometheusEndpoint', 'platformProvisioned'],
} as const;
const publicColumns =
  'id,team,name,host,username,hyperdxSettingPrefix,isPrometheusEndpoint,platformProvisioned,createdAt,updatedAt';

function fromRow(
  row: Record<string, unknown> | undefined,
): ConnectionDoc | null {
  return row ? (rowToDoc(row, spec) as ConnectionDoc) : null;
}

export function list(team?: string): ConnectionDoc[] {
  const rows = team
    ? getDb()
        .prepare(`SELECT ${publicColumns} FROM connections WHERE team = ?`)
        .all(normalizeId(team))
    : getDb().prepare(`SELECT ${publicColumns} FROM connections`).all();
  return (rows as Record<string, unknown>[]).map(row => fromRow(row)!);
}

export function findById(
  id: string,
  team: string,
  withPassword = false,
): ConnectionDoc | null {
  if (!isId(id)) return null;
  const columns = withPassword ? '*' : publicColumns;
  return fromRow(
    getDb()
      .prepare(`SELECT ${columns} FROM connections WHERE id = ? AND team = ?`)
      .get(normalizeId(id), normalizeId(team)),
  );
}

export function findByIdWithPassword(
  id: string,
  team: string,
): ConnectionDoc | null {
  return findById(id, team, true);
}

export function create(
  team: string,
  input: Partial<ConnectionDoc>,
): ConnectionDoc {
  const id = input._id ?? newId();
  const timestamp = Date.now();
  const row = docToRow(
    {
      _id: id,
      team: normalizeId(team),
      name: input.name ?? null,
      host: input.host ?? null,
      username: input.username ?? null,
      password: input.password ?? null,
      hyperdxSettingPrefix: input.hyperdxSettingPrefix ?? null,
      isPrometheusEndpoint: input.isPrometheusEndpoint ?? null,
      platformProvisioned: input.platformProvisioned ?? null,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    },
    spec,
  );
  getDb()
    .prepare(
      `INSERT INTO connections
    (id,team,name,host,username,password,hyperdxSettingPrefix,isPrometheusEndpoint,platformProvisioned,createdAt,updatedAt)
    VALUES (@id,@team,@name,@host,@username,@password,@hyperdxSettingPrefix,@isPrometheusEndpoint,@platformProvisioned,@createdAt,@updatedAt)`,
    )
    .run(row);
  return findById(id, team)!;
}

const updateColumns = new Set([
  'name',
  'host',
  'username',
  'password',
  'hyperdxSettingPrefix',
  'isPrometheusEndpoint',
  'platformProvisioned',
]);

export function update(
  id: string,
  team: string,
  changes: Partial<ConnectionDoc>,
  unsetFields: string[] = [],
): ConnectionDoc | null {
  return withTransaction(() => {
    if (!findById(id, team)) return null;
    const row = docToRow(changes, spec);
    const keys = Object.keys(row).filter(key => updateColumns.has(key));
    for (const field of unsetFields) {
      if (!updateColumns.has(field))
        throw new Error(`Unsupported connection field: ${field}`);
      row[field] = null;
      if (!keys.includes(field)) keys.push(field);
    }
    if (keys.length > 0) {
      // sqlite-port: Mongo $set/$unset pair updates nullable columns atomically.
      const assignments = keys.map(key => `"${key}" = @${key}`).join(', ');
      getDb()
        .prepare(
          `UPDATE connections SET ${assignments}, updatedAt = @updatedAt WHERE id = @id AND team = @team`,
        )
        .run({
          ...row,
          id: normalizeId(id),
          team: normalizeId(team),
          updatedAt: Date.now(),
        });
    }
    return findById(id, team);
  });
}

export function remove(id: string, team: string): ConnectionDoc | null {
  return fromRow(
    getDb()
      .prepare(
        `DELETE FROM connections WHERE id = ? AND team = ? RETURNING ${publicColumns}`,
      )
      .get(normalizeId(id), normalizeId(team)),
  );
}
