import { getLoggedInAgent, getServer } from '@/fixtures';

function stableResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableResponse);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '__v')
        .map(([key, item]) => [key, stableResponse(item)]),
    );
  }
  if (typeof value === 'string') {
    if (/^[0-9a-f]{24}$/i.test(value)) return '<id>';
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      return '<uuid>';
    }
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
      return '<date>';
    }
  }
  return value;
}

test('Phase 1 routes retain their response bodies', async () => {
  const server = getServer();
  await server.start();
  try {
    const { agent, user } = await getLoggedInAgent(server);
    const routes = [
      '/me',
      '/team',
      '/team/members',
      '/api/v2',
      '/api/v2/team',
      '/api/v2/team/members',
    ];
    const responses: Record<string, unknown> = {};
    for (const route of routes) {
      const request = agent.get(route);
      if (route.startsWith('/api/v2')) {
        void request.set('Authorization', `Bearer ${user.accessKey}`);
      }
      responses[route] = stableResponse((await request.expect(200)).body);
    }
    expect(responses).toMatchSnapshot();
  } finally {
    await server.clearDBs();
    await server.stop();
  }
});
