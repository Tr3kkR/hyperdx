import { MAX_ALERT_DISPLAY_NAME_LENGTH } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { type AlertPageRefs, withDisplayRefs } from '@/controllers/alerts';
import * as alertsRepo from '@/db/repos/alerts';
import { hydrateUsers } from '@/db/repos/users';
import { AlertSource, AlertState } from '@/models/alert';
import type { ObjectId } from '@/models/ids';
import { decodeCursor, encodeCursor } from '@/utils/pagination';
import { objectIdSchema, stringListQueryParam, tagsSchema } from '@/utils/zod';

const MAX_PAGE_LIMIT = 500;
const alertsPageCursorSchema = z.object({
  n: z.string().nullable(),
  id: objectIdSchema,
});

export const alertsPageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
    cursor: z.string().optional(),
    createdBy: objectIdSchema.optional(),
    tag: stringListQueryParam.pipe(tagsSchema).optional(),
    source: stringListQueryParam
      .pipe(z.array(z.nativeEnum(AlertSource)).optional())
      .optional(),
    state: stringListQueryParam
      .pipe(z.array(z.nativeEnum(AlertState)).optional())
      .optional(),
    search: z.string().trim().max(MAX_ALERT_DISPLAY_NAME_LENGTH).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.cursor == null) return;
    if (query.limit == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'cursor requires limit',
      });
    }
    if (decodeCursor(query.cursor, alertsPageCursorSchema) == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'invalid cursor',
      });
    }
  });

export type AlertsPageParams = z.infer<typeof alertsPageQuerySchema>;

export async function getAlertsPage(
  teamId: ObjectId,
  params: AlertsPageParams,
) {
  const cursor = params.cursor
    ? decodeCursor(params.cursor, alertsPageCursorSchema)
    : null;
  // sqlite-port: Mongo $or keyset filter and {_id:1} tie-breaker. SQLite's
  // default byte-wise ordering is used for mixed-case display names.
  const docs = alertsRepo.page(teamId, {
    createdBy: params.createdBy,
    tags: params.tag,
    sources: params.source,
    states: params.state,
    search: params.search,
    cursor: cursor ? { name: cursor.n, id: cursor.id } : undefined,
    limit: params.limit == null ? undefined : params.limit + 1,
  });
  const hasMore = params.limit != null && docs.length > params.limit;
  const data = (hasMore ? docs.slice(0, params.limit) : docs).map(
    doc =>
      hydrateUsers(
        [withDisplayRefs(doc)],
        ['createdBy', 'silenced.by'],
      )[0] as typeof doc & AlertPageRefs,
  );
  const last = data.at(-1);
  const nextCursor =
    hasMore && last != null
      ? encodeCursor({ n: last.displayName ?? null, id: last._id.toString() })
      : undefined;
  return { data, hasMore, nextCursor };
}
