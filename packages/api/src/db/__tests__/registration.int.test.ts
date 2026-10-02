import * as teams from '@/db/repos/teams';
import * as users from '@/db/repos/users';
import { getAgent, getServer } from '@/fixtures';

test('failed user registration rolls back the new team', async () => {
  const server = getServer();
  await server.start();
  try {
    users.create({ email: 'duplicate@example.com' });
    await getAgent(server)
      .post('/register/password')
      .send({
        email: 'duplicate@example.com',
        password: 'StrongP@ssw0rd!23',
        confirmPassword: 'StrongP@ssw0rd!23',
      })
      .expect(400);
    expect(teams.countTeams()).toBe(0);
  } finally {
    await server.clearDBs();
    await server.stop();
  }
});
