import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import { createDashboardFixture } from '@/test/sqliteMetadata';
import { findDashboardFixture } from '@/test/sqliteMetadata';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_delete_dashboard', () => {
  const ctx = setupDashboardTests();

  it('should delete an existing dashboard', async () => {
    const dashboard = createDashboardFixture({
      name: 'To Delete',
      tiles: [],
      team: ctx.team._id,
    });

    const result = await callTool(ctx.client!, 'clickstack_delete_dashboard', {
      id: dashboard._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.deleted).toBe(true);
    expect(output.id).toBe(dashboard._id.toString());

    // Verify deleted from database
    const found = await findDashboardFixture(dashboard._id);
    expect(found).toBeNull();
  });

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'clickstack_delete_dashboard', {
      id: '000000000000000000000000',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });
});
