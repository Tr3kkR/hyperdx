import { isTileAlertUnaddressable } from '@hyperdx/common-utils/dist/iac';
import { serializeError } from 'serialize-error';

import * as dashboardsRepo from '@/db/repos/dashboards';
import { AlertSource } from '@/models/alert';
import type { ObjectId } from '@/models/ids';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const tileAlertLookupFailures = getCounter(
  'hyperdx.iac.tile_alert_lookup_failed',
  {
    description:
      "Failures to read the dashboards a team's tile alerts point at, each of which withholds every tile alert from Terraform export.",
  },
);

type TileAlertRow = {
  _id: ObjectId;
  source?: AlertSource;
  dashboard?: ObjectId | null;
  tileId?: string | null;
};

/**
 * Which of these alerts the Terraform provider cannot address, by alert id.
 *
 * A tile alert's eligibility depends on its dashboard — whether Terraform
 * could own it at all, and whether the tile has a unique, non-blank name for
 * the provider's `tile_ids` map. The manifest's own dashboards listing cannot
 * answer that: it drops provisioned dashboards and caps at
 * IAC_MANIFEST_LIMIT. Hence this separate, narrower read, keyed on the
 * dashboards the tile alerts actually point at.
 *
 * Bounded by the ids from the alerts listing, itself capped at
 * IAC_MANIFEST_LIMIT. If the caller's request budget is already spent or the
 * SQLite lookup fails, every tile alert is reported unaddressable rather than
 * failing the manifest.
 */
export async function unaddressableTileAlertIds({
  teamId,
  alerts,
  maxTimeMS,
}: {
  teamId: ObjectId | string;
  alerts: readonly TileAlertRow[];
  maxTimeMS: number;
}): Promise<Set<string>> {
  const tileAlerts = alerts.filter(a => a.source === AlertSource.TILE);
  const dashboardIds = [
    ...new Set(
      tileAlerts
        .map(a => a.dashboard?.toString())
        .filter((id): id is string => !!id),
    ),
  ];

  const allTileAlertIds = () => new Set(tileAlerts.map(a => a._id.toString()));
  if (!dashboardIds.length) return allTileAlertIds();

  // This read decides one optional marker, so it must not take the whole
  // manifest with it — the other six listings are the export. It runs last on
  // what is left of the request's budget, so it is the leg most likely to be
  // short of time.
  //
  // One request withholds one export, so count a lookup failure only once.
  let counted = false;
  const withhold = (message: string, error?: unknown) => {
    logger.warn({
      message,
      error: error == null ? undefined : serializeError(error),
      teamId: teamId.toString(),
      tileAlerts: tileAlerts.length,
    });
    if (counted) return;
    counted = true;
    tileAlertLookupFailures.add(1);
  };

  // A spent request budget withholds all tile alerts.
  if (maxTimeMS <= 0) {
    withhold(
      'No budget left to resolve tile-alert addressability; withholding all',
    );
    return allTileAlertIds();
  }

  let dashboards: ReturnType<typeof dashboardsRepo.findManyByIds>;
  try {
    dashboards = dashboardsRepo
      .findManyByIds(dashboardIds)
      .filter(d => d.team === String(teamId));
  } catch (e) {
    withhold('Failed to resolve tile-alert addressability; withholding all', e);
    return allTileAlertIds();
  }

  const byId = new Map(dashboards.map(d => [d._id.toString(), d]));

  return new Set(
    tileAlerts
      .filter(a =>
        // A dangling dashboard or tile reference lands here too, which is the
        // right answer: importing that alert would fail.
        isTileAlertUnaddressable(
          byId.get(a.dashboard?.toString() ?? ''),
          a.tileId,
        ),
      )
      .map(a => a._id.toString()),
  );
}
