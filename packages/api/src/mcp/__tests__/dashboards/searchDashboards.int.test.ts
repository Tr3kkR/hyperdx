import mongoose from 'mongoose';

import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import { createDashboardFixture } from '@/test/sqliteMetadata';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_search_dashboards', () => {
  const ctx = setupDashboardTests();

  it('should find dashboards by name (case-insensitive)', async () => {
    createDashboardFixture({
      name: 'Service Overview',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    });
    createDashboardFixture({
      name: 'Error Dashboard',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    });
    createDashboardFixture({
      name: 'service metrics',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: 'service',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(2);
    expect(output.map((d: { name: string }) => d.name).sort()).toEqual([
      'Service Overview',
      'service metrics',
    ]);
  });

  it('should find dashboards by tags', async () => {
    createDashboardFixture({
      name: 'Dashboard A',
      tiles: [],
      team: ctx.team._id,
      tags: ['production', 'backend'],
    });
    createDashboardFixture({
      name: 'Dashboard B',
      tiles: [],
      team: ctx.team._id,
      tags: ['production', 'frontend'],
    });
    createDashboardFixture({
      name: 'Dashboard C',
      tiles: [],
      team: ctx.team._id,
      tags: ['staging'],
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      tags: ['production'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(2);

    // Search with multiple tags (AND)
    const result2 = await callTool(
      ctx.client!,
      'clickstack_search_dashboards',
      {
        tags: ['production', 'backend'],
      },
    );

    const output2 = JSON.parse(getFirstText(result2));
    expect(output2).toHaveLength(1);
    expect(output2[0].name).toBe('Dashboard A');
  });

  it('should combine name and tags filters', async () => {
    createDashboardFixture({
      name: 'API Service',
      tiles: [],
      team: ctx.team._id,
      tags: ['production'],
    });
    createDashboardFixture({
      name: 'API Errors',
      tiles: [],
      team: ctx.team._id,
      tags: ['staging'],
    });
    createDashboardFixture({
      name: 'Web Service',
      tiles: [],
      team: ctx.team._id,
      tags: ['production'],
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: 'API',
      tags: ['production'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe('API Service');
  });

  it('should return empty array when no dashboards match', async () => {
    createDashboardFixture({
      name: 'Unrelated',
      tiles: [],
      team: ctx.team._id,
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: 'nonexistent-dashboard-name',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(0);
  });

  it('should treat regex metacharacters as literal substrings', async () => {
    createDashboardFixture({
      name: 'API (v2) Service',
      tiles: [],
      team: ctx.team._id,
    });
    createDashboardFixture({
      name: 'API v2 Service',
      tiles: [],
      team: ctx.team._id,
    });

    // Parentheses are regex metacharacters — without escaping, "(v2)"
    // would be treated as a capture group and match "v2" anywhere.
    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: '(v2)',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    // Only the dashboard with literal "(v2)" should match
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe('API (v2) Service');
  });

  it('should not throw on regex-invalid characters like [', async () => {
    createDashboardFixture({
      name: 'Test Dashboard',
      tiles: [],
      team: ctx.team._id,
    });

    // An unescaped "[" would throw a MongoDB BadValue error
    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: '[invalid',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(0);
  });

  it('should match literal dots, not arbitrary characters', async () => {
    createDashboardFixture({
      name: 'api.v2.service',
      tiles: [],
      team: ctx.team._id,
    });
    createDashboardFixture({
      name: 'apiXv2Xservice',
      tiles: [],
      team: ctx.team._id,
    });

    // Unescaped "." in regex matches any character, so ".v2." would
    // match "Xv2X". With escaping, only the literal dot matches.
    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: '.v2.',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe('api.v2.service');
  });

  it('should reject empty query string', async () => {
    createDashboardFixture({
      name: 'Should Not Appear',
      tiles: [],
      team: ctx.team._id,
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: '',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('at least one');
  });

  it('should reject empty tags array', async () => {
    createDashboardFixture({
      name: 'Should Not Appear',
      tiles: [],
      team: ctx.team._id,
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      tags: [],
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('at least one');
  });

  it('should reject empty query with empty tags', async () => {
    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: '',
      tags: [],
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('at least one');
  });

  it('should only return dashboards for the current team', async () => {
    createDashboardFixture({
      name: 'My Dashboard',
      tiles: [],
      team: ctx.team._id,
    });
    // Create a dashboard for a different team
    const otherTeamId = new mongoose.Types.ObjectId();
    createDashboardFixture({
      name: 'My Dashboard',
      tiles: [],
      team: otherTeamId,
    });

    const result = await callTool(ctx.client!, 'clickstack_search_dashboards', {
      query: 'My Dashboard',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(1);
  });
});
