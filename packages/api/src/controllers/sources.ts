import {
  SourceSchemaNoId,
  type TSourceNoId,
} from '@hyperdx/common-utils/dist/types';

import * as sources from '@/db/repos/sources';

export function getSources(team: string) {
  return sources.list(team);
}

export function getSource(team: string, sourceId: string) {
  return sources.findById(sourceId, team);
}

export function createSource(team: string, source: TSourceNoId) {
  return sources.create(team, source);
}

export function updateSource(
  team: string,
  sourceId: string,
  source: TSourceNoId,
) {
  const existing = sources.findById(sourceId, team);
  if (!existing) return null;
  if (existing.kind !== source.kind) {
    const parsed = SourceSchemaNoId.safeParse(source);
    if (!parsed.success) {
      throw new Error(
        `Invalid source data: ${parsed.error.errors.map(e => e.message).join(', ')}`,
      );
    }
    return sources.replace(sourceId, team, parsed.data);
  }
  return sources.replace(sourceId, team, source);
}

export function deleteSource(team: string, sourceId: string) {
  return sources.remove(sourceId, team);
}
