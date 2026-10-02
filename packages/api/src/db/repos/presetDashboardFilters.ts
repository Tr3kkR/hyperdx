/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite rows use this repository's fixed columns. */
import type {
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';

import { getDb } from '@/db';
import { newId, normalizeId } from '@/db/ids';
import { rowToDoc } from '@/db/mapper';

export type PresetDashboardFilterDoc = PresetDashboardFilter & {
  _id: string;
  team: string;
  createdAt: Date;
  updatedAt: Date;
};

const spec = { virtuals: true, dates: ['createdAt', 'updatedAt'] } as const;
function fromRow(
  row: Record<string, unknown> | undefined,
): PresetDashboardFilterDoc | null {
  return row ? (rowToDoc(row, spec) as PresetDashboardFilterDoc) : null;
}

export function list(
  teamId: string,
  source: string,
  presetDashboard: PresetDashboard,
): PresetDashboardFilterDoc[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM presetdashboardfilters WHERE team = ? AND source = ? AND presetDashboard = ?',
      )
      .all(normalizeId(teamId), normalizeId(source), presetDashboard) as Record<
      string,
      unknown
    >[]
  ).map(row => fromRow(row)!);
}

export function listByTeam(teamId: string): PresetDashboardFilterDoc[] {
  return (
    getDb()
      .prepare('SELECT * FROM presetdashboardfilters WHERE team = ?')
      .all(normalizeId(teamId)) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function create(
  teamId: string,
  input: PresetDashboardFilter,
): PresetDashboardFilterDoc {
  const id = newId();
  const timestamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO presetdashboardfilters
    (id,name,team,source,sourceMetricType,presetDashboard,type,expression,"where",whereLanguage,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.name,
      normalizeId(teamId),
      normalizeId(input.source),
      input.sourceMetricType ?? null,
      input.presetDashboard,
      input.type,
      input.expression,
      input.where ?? null,
      input.whereLanguage ?? null,
      timestamp,
      timestamp,
    );
  return findById(id)!;
}

export function findById(id: string): PresetDashboardFilterDoc | null {
  return fromRow(
    getDb()
      .prepare('SELECT * FROM presetdashboardfilters WHERE id = ?')
      .get(normalizeId(id)),
  );
}

export function update(
  teamId: string,
  input: PresetDashboardFilter,
): PresetDashboardFilterDoc | null {
  // sqlite-port: findOneAndUpdate with a team-qualified filter.
  return fromRow(
    getDb()
      .prepare(
        `UPDATE presetdashboardfilters SET
    name=?,source=?,sourceMetricType=?,presetDashboard=?,type=?,expression=?,"where"=?,whereLanguage=?,updatedAt=?
    WHERE id=? AND team=? RETURNING *`,
      )
      .get(
        input.name,
        normalizeId(input.source),
        input.sourceMetricType ?? null,
        input.presetDashboard,
        input.type,
        input.expression,
        input.where ?? null,
        input.whereLanguage ?? null,
        Date.now(),
        normalizeId(input.id),
        normalizeId(teamId),
      ),
  );
}

export function remove(
  teamId: string,
  presetDashboard: PresetDashboard,
  id: string,
): PresetDashboardFilterDoc | null {
  return fromRow(
    getDb()
      .prepare(
        'DELETE FROM presetdashboardfilters WHERE id = ? AND team = ? AND presetDashboard = ? RETURNING *',
      )
      .get(normalizeId(id), normalizeId(teamId), presetDashboard),
  );
}
