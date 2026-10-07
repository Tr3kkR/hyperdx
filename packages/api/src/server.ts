import http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { serializeError } from 'serialize-error';

import app from '@/api-app';
import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { closeDb, openDb } from '@/db';
import { migrate } from '@/db/migrate';
import { runStartupMigrations } from '@/migrations';
import opampApp from '@/opamp/app';
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';
import { verifyTokenEncryption } from '@/utils/tokenEncryption';

export default class Server {
  protected shouldHandleGracefulShutdown = true;

  protected appServer!: http.Server;
  protected opampServer!: http.Server;

  private createAppServer() {
    return http.createServer(app);
  }

  private createOpampServer() {
    return http.createServer(opampApp);
  }

  protected async shutdown(_signal?: string) {
    let hasError = false;
    logger.info('Closing all db clients...');
    try {
      closeDb(true);
    } catch (err) {
      hasError = true;
      logger.error({ err: serializeError(err) }, 'SQLite client close failed');
    }
    if (hasError) {
      throw new Error('Failed to close all clients.');
    }
  }

  async start() {
    this.appServer = this.createAppServer();
    this.appServer.keepAliveTimeout = 61000; // Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
    this.appServer.headersTimeout = 62000; // Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363

    this.opampServer = this.createOpampServer();
    this.opampServer.keepAliveTimeout = 61000;
    this.opampServer.headersTimeout = 62000;

    this.appServer.listen(process.env.JEST_WORKER_ID ? 0 : config.PORT, () => {
      logger.info(
        `API Server listening on port ${config.PORT}, NODE_ENV=${process.env.NODE_ENV}`,
      );
    });

    this.opampServer.listen(
      process.env.JEST_WORKER_ID ? 0 : config.OPAMP_PORT,
      () => {
        logger.info(
          `OpAMP Server listening on port ${config.OPAMP_PORT}, NODE_ENV=${process.env.NODE_ENV}`,
        );
      },
    );

    if (this.shouldHandleGracefulShutdown) {
      [this.appServer, this.opampServer].forEach(server => {
        gracefulShutdown(server, {
          signals: 'SIGINT SIGTERM',
          timeout: 10000, // 10 secs
          development: config.IS_DEV,
          forceExit: true, // triggers process.exit() at the end of shutdown process
          preShutdown: async () => {
            // needed operation before httpConnections are shutted down
          },
          onShutdown: this.shutdown,
          finally: () => {
            logger.info('Server gracefully shut down...');
          }, // finally function (sync) - e.g. for logging
        });
      });
    }

    // Verify encryption before opening application state.
    await verifyTokenEncryption();

    // The HTTP servers above are already listening so `/health` responds
    // while `/ready` stays 503 until SQLite has opened and migrated.
    openDb();
    migrate();

    await runStartupMigrations();

    // Initialize default connections and sources for local app mode
    if (config.IS_LOCAL_APP_MODE) {
      try {
        logger.info(
          'Local app mode detected, setting up default connections and sources...',
        );
        await setupTeamDefaults(LOCAL_APP_TEAM._id.toString());
        logger.info(
          'Default connections and sources setup completed for local app mode',
        );
      } catch (error) {
        logger.error(
          { err: serializeError(error) },
          'Failed to setup team defaults for local app mode',
        );
        // Don't throw - allow server to start even if defaults setup fails
      }
    }
  }
}
