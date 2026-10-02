import type { TSourceNoId } from '@hyperdx/common-utils/dist/types';

import { getDb } from '@/db';
import * as connections from '@/db/repos/connections';
import * as sources from '@/db/repos/sources';

// Test setup inserts rows directly so route tests can exercise reads without
// coupling their fixtures to the endpoint that writes the same table.
export function createConnectionFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, ...row } = input;
  const created = connections.create(
    String(team),
    row as Partial<connections.ConnectionDoc>,
  );
  return connections.findByIdWithPassword(created.id, String(team))!;
}

export function createSourceFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, ...row } = input;
  return sources.create(String(team), {
    ...row,
    connection: String(row.connection),
    ...(row._id == null ? {} : { _id: String(row._id) }),
  } as TSourceNoId);
}

export function findSourceFixture(id: { toString(): string }) {
  return sources.findById(String(id));
}

export function findConnectionFixture(
  id: { toString(): string },
  withPassword = false,
) {
  const row = getDb()
    .prepare('SELECT team FROM connections WHERE id = ?')
    .get(String(id)) as { team: string } | undefined;
  return row ? connections.findById(String(id), row.team, withPassword) : null;
}

export function deleteSourceFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM sources WHERE id = ?').run(String(id));
}

export function deleteConnectionFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(String(id));
}

export function setSourceKindFixture(id: { toString(): string }, kind: string) {
  // sqlite-port: raw Source.collection.updateOne bypassed discriminator validation.
  getDb()
    .prepare('UPDATE sources SET kind = ? WHERE id = ?')
    .run(kind, String(id));
}

export function setSourceConnectionFixture(
  id: { toString(): string },
  connection: { toString(): string },
) {
  getDb()
    .prepare('UPDATE sources SET connection = ? WHERE id = ?')
    .run(String(connection), String(id));
}

export function setSourceTableFilterFixture(
  id: { toString(): string },
  expression: string,
) {
  // sqlite-port: LogSource.updateOne changed a discriminator-specific field.
  getDb()
    .prepare(
      "UPDATE sources SET config = json_set(config, '$.tableFilterExpression', ?) WHERE id = ?",
    )
    .run(expression, String(id));
}
