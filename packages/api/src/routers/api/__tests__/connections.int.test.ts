import { ObjectId } from 'mongodb';

import * as config from '@/config';
import * as connections from '@/db/repos/connections';
import { getLoggedInAgent, getServer } from '@/fixtures';

describe('connections router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('only returns connections belonging to the current team through GET /connections', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    connections.create(String(team._id), {
      name: 'My Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });
    connections.create(String(new ObjectId()), {
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    const res = await agent.get('/connections').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('My Team Connection');
  });

  it('persists isPrometheusEndpoint through POST /connections', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const res = await agent
      .post('/connections')
      .send({
        name: 'Prom-enabled',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = connections.findById(res.body.id, String(team._id));
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('persists isPrometheusEndpoint through PUT /connections/:id', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = connections.create(String(team._id), {
      name: 'No-prom',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'No-prom',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = connections.findById(created._id, String(team._id));
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('toggles isPrometheusEndpoint back to false through PUT', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = connections.create(String(team._id), {
      name: 'Prom',
      host: 'http://thanos:10902',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'Prom',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        isPrometheusEndpoint: false,
      })
      .expect(200);

    const stored = connections.findById(created._id, String(team._id));
    expect(stored?.host).toBe(config.CLICKHOUSE_HOST);
    expect(stored?.isPrometheusEndpoint).toBe(false);
  });
});
