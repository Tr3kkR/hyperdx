import request from 'supertest';

import { closeDb } from '@/db';
import { getAgent, getServer, openTestDb } from '@/fixtures';
import opampApp from '@/opamp/app';

// Covers https://github.com/hyperdxio/hyperdx/issues/2966: `/health` is pure
// liveness and must stay 200 while the process serves HTTP, whereas `/ready`
// must reflect SQLite availability so Kubernetes readiness probes can pull a
// pod that cannot serve requests out of rotation.
describe('health and readiness endpoints', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /health returns 200 on the API server', async () => {
    const resp = await getAgent(server).get('/health').expect(200);
    expect(resp.body.data).toEqual('OK');
  });

  it('GET /health returns 200 on the OpAMP server', async () => {
    const resp = await request(opampApp).get('/health').expect(200);
    expect(resp.body).toEqual({ status: 'OK' });
  });

  it('GET /ready reflects SQLite availability on both servers', async () => {
    const agent = getAgent(server);

    // Connected: both readiness endpoints pass.
    const apiReady = await agent.get('/ready').expect(200);
    expect(apiReady.body.data).toEqual('OK');
    expect(apiReady.body.sqlite).toEqual('ok');
    await request(opampApp)
      .get('/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body.sqlite).toEqual('ok');
      });

    closeDb();
    try {
      // Closed: readiness fails with the SQLite state ...
      const apiNotReady = await agent.get('/ready').expect(503);
      expect(apiNotReady.body).toEqual({
        status: 'unavailable',
        sqlite: 'error',
      });
      const opampNotReady = await request(opampApp).get('/ready').expect(503);
      expect(opampNotReady.body).toEqual({
        status: 'unavailable',
        sqlite: 'error',
      });

      // ... while liveness stays green.
      await agent.get('/health').expect(200);
      await request(opampApp).get('/health').expect(200);
    } finally {
      // Restore the database for teardown.
      openTestDb();
    }

    await agent.get('/ready').expect(200);
    await request(opampApp).get('/ready').expect(200);
  });
});
