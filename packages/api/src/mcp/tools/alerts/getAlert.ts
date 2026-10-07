import { type AlertInterval } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import * as config from '@/config';
import { getRecentAlertHistories } from '@/controllers/alertHistory';
import { getAlertById } from '@/controllers/alerts';
import { withDisplayRefs } from '@/controllers/alerts';
import * as alertsRepo from '@/db/repos/alerts';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError, validateObjectId } from '@/mcp/utils/errors';
import { AlertState } from '@/models/alert';
import { translateAlertDocumentToExternalAlertWithChartConfig } from '@/routers/external-api/v2/utils/alertChartConfig';
import { resolveAlertDisplayFields } from '@/utils/alerts';

export function registerGetAlert({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_get_alert',
    {
      title: 'Get Alert(s)',
      annotations: { readOnlyHint: true },
      description:
        'Without an ID: list all alerts as a high-level summary ' +
        '(id, name, displayName, tags, state, source, interval). Optionally ' +
        'filter by state ' +
        '(e.g. state="ALERT" for firing alerts). ' +
        'With an ID: get full alert detail including configuration, ' +
        'displayName, tags, and recent evaluation history.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Alert ID. Omit to list all alerts, provide to get full detail.',
          ),
        state: z
          .enum(['ALERT', 'OK', 'DISABLED', 'INSUFFICIENT_DATA'])
          .optional()
          .describe(
            'Filter list by alert state (only applies when id is omitted). ' +
              'Use "ALERT" to find currently firing alerts.',
          ),
      }),
    },
    async ({ id, state }) => {
      // ── List all alerts (slim summary) ──
      if (!id) {
        const alerts = alertsRepo
          .list(teamId)
          .filter(alert => !state || alert.state === (state as AlertState))
          .map(withDisplayRefs);

        const output = alerts.map(alert => {
          const { displayName, tags } = resolveAlertDisplayFields(alert, {
            savedSearch:
              alert.savedSearch &&
              typeof alert.savedSearch === 'object' &&
              'name' in alert.savedSearch
                ? alert.savedSearch
                : null,
            dashboard:
              alert.dashboard &&
              typeof alert.dashboard === 'object' &&
              'name' in alert.dashboard
                ? alert.dashboard
                : null,
          });
          return {
            id: alert._id.toString(),
            name: alert.name ?? undefined,
            displayName,
            tags,
            state: alert.state,
            source: alert.source,
            interval: alert.interval,
            ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
          };
        });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      // ── Get single alert (full detail) ──
      const idError = validateObjectId(id, 'alert ID');
      if (idError) return idError;

      const alert = await getAlertById(id, teamId);
      if (!alert) {
        return mcpUserError('Alert not found');
      }

      // Populate the refs the display name/tags derive from, so alerts written
      // before those fields existed still resolve to something meaningful.
      const populated = withDisplayRefs(alert);

      const external =
        translateAlertDocumentToExternalAlertWithChartConfig(populated);

      const history = await getRecentAlertHistories({
        alertId: alert._id,
        interval: alert.interval as AlertInterval,
        limit: 20,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...external,
                history,
                ...(frontendUrl ? { url: `${frontendUrl}/alerts` } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
