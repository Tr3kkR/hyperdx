import { z } from 'zod';

import * as config from '@/config';
import { getDashboards } from '@/controllers/dashboard';
import * as dashboardsRepo from '@/db/repos/dashboards';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError, validateObjectId } from '@/mcp/utils/errors';
import { convertToExternalDashboard } from '@/routers/external-api/v2/utils/dashboards';

import { withResolvedFilterVariableNames } from './variables';

export function registerGetDashboard({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_get_dashboard',
    {
      title: 'Get Dashboard(s)',
      annotations: { readOnlyHint: true },
      description:
        'Without an ID: list all dashboards (returns IDs, names, tags). ' +
        'With an ID: get full dashboard detail including all tiles and configuration.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'Dashboard ID. Omit to list all dashboards, provide to get full detail.',
          ),
      }),
    },
    async ({ id }) => {
      if (!id) {
        const dashboards = await getDashboards(teamId);
        const output = dashboards.map(d => ({
          id: d._id.toString(),
          name: d.name,
          tags: d.tags,
          ...(frontendUrl ? { url: `${frontendUrl}/dashboards/${d._id}` } : {}),
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(output, null, 2) },
          ],
        };
      }

      const idError = validateObjectId(id, 'dashboard ID');
      if (idError) return idError;

      const dashboard = dashboardsRepo.findById(id, teamId);
      if (!dashboard) {
        return mcpUserError('Dashboard not found');
      }
      const externalDashboard = convertToExternalDashboard(dashboard);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...externalDashboard,
                filters: withResolvedFilterVariableNames(
                  externalDashboard.filters ?? [],
                ),
                ...(frontendUrl
                  ? { url: `${frontendUrl}/dashboards/${dashboard._id}` }
                  : {}),
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
