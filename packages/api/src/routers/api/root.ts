import type { InstallationApiResponse } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { isTeamExisting } from '@/controllers/team';
import { withTransaction } from '@/db';
import { hashPassword } from '@/db/password';
import * as teamInvites from '@/db/repos/teamInvites';
import * as teams from '@/db/repos/teams';
import * as users from '@/db/repos/users';
import { handleAuthError, redirectToDashboard } from '@/middleware/auth';
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';
import passport from '@/utils/passport';
import { isDbReady } from '@/utils/readiness';
import { passwordSchema } from '@/utils/validators';

const registrationSchema = z
  .object({
    email: z.string().email(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const router = express.Router();

// Liveness: 200 whenever the process can serve HTTP. Deliberately checks no
// external dependencies.
router.get('/health', async (req, res) => {
  res.send({
    data: 'OK',
    version: config.CODE_VERSION,
    ip: req.ip,
    env: config.NODE_ENV,
  });
});

// Readiness: a pod without its SQLite database cannot serve requests.
router.get('/ready', async (req, res) => {
  if (isDbReady()) {
    return res.send({
      data: 'OK',
      sqlite: 'ok',
      version: config.CODE_VERSION,
      env: config.NODE_ENV,
    });
  }
  res.status(503).send({
    status: 'unavailable',
    sqlite: 'error',
  });
});

type InstallationEspRes = express.Response<InstallationApiResponse>;
router.get('/installation', async (_, res: InstallationEspRes, next) => {
  try {
    const _isTeamExisting = await isTeamExisting();
    return res.json({
      isTeamExisting: _isTeamExisting,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/login/password',
  passport.authenticate('local', {
    failWithError: true,
    failureMessage: true,
  }),
  redirectToDashboard,
  handleAuthError,
);

router.post(
  '/register/password',
  validateRequest({ body: registrationSchema }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (await isTeamExisting()) {
        return res.status(409).json({ error: 'teamAlreadyExists' });
      }

      const credentials = await hashPassword(password);
      let team;
      try {
        // sqlite-port: the Team save followed by User.register is one write transaction.
        team = withTransaction(() => {
          if (teams.countTeams() > 0) return null;
          const created = teams.create({
            name: `${email}'s Team`,
            collectorAuthenticationEnforced: true,
          });
          users.create({
            email,
            name: email,
            team: created._id,
            ...credentials,
          });
          return created;
        });
      } catch (err) {
        logger.error({ err: serializeError(err) }, 'User registration error');
        return res.status(400).json({ error: 'invalid' });
      }
      if (!team) return res.status(409).json({ error: 'teamAlreadyExists' });

      try {
        await setupTeamDefaults(team._id);
      } catch (error) {
        logger.error(
          { err: serializeError(error) },
          'Failed to setup team defaults',
        );
      }

      return passport.authenticate('local')(req, res, () => {
        if (req?.user?.team) return res.status(200).json({ status: 'success' });
        logger.error(
          { userId: req?.user?._id },
          'Password login for user failed, user or team not found',
        );
        return res.status(400).json({ error: 'invalid' });
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect(`${config.FRONTEND_REDIRECT_BASE}/login`);
  });
});

// TODO: rename this ?
router.post('/team/setup/:token', async (req, res, next) => {
  try {
    const { password } = req.body;
    const { token } = req.params;

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      // Emit one `reason` query param per failed requirement so the Join Team
      // page can render them as a readable list rather than one run-on line.
      const reasonParams = passwordResult.error.issues
        .map(issue => `reason=${encodeURIComponent(issue.message)}`)
        .join('&');
      return res.redirect(
        `${config.FRONTEND_REDIRECT_BASE}/join-team?err=invalid&${reasonParams}&token=${token}`,
      );
    }

    const teamInvite = teamInvites.findByToken(req.params.token);
    if (!teamInvite) {
      return res.status(401).send('Invalid token');
    }

    let user;
    try {
      const credentials = await hashPassword(password);
      user = withTransaction(() => {
        // sqlite-port: User.register plus TeamInvite.findByIdAndRemove is atomic.
        const created = users.create({
          email: teamInvite.email,
          name: teamInvite.email,
          team: teamInvite.teamId,
          ...credentials,
        });
        teamInvites.deleteById(teamInvite._id);
        return created;
      });
    } catch (err) {
      logger.error({ err: serializeError(err) }, 'Team setup error');
      return res.redirect(
        `${config.FRONTEND_REDIRECT_BASE}/join-team?token=${token}&err=500`,
      );
    }
    req.login(user, err => {
      if (err) return next(err);
      redirectToDashboard(req, res);
    });
  } catch (e) {
    next(e);
  }
});

export default router;
