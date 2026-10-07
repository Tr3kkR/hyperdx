import express from 'express';

import { appErrorHandler } from '@/middleware/error';
import { opampController } from '@/opamp/controllers/opampController';
import { isDbReady } from '@/utils/readiness';

// Create Express application
const app = express();

app.disable('x-powered-by');

// Special body parser setup for OpAMP
app.use(
  '/v1/opamp',
  express.raw({
    type: 'application/x-protobuf',
    limit: '10mb',
  }),
);

// OpAMP endpoint
app.post('/v1/opamp', opampController.handleOpampMessage.bind(opampController));

// Liveness: 200 whenever the process can serve HTTP (no dependency checks).
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Readiness: OpAMP configuration needs the SQLite database.
app.get('/ready', (req, res) => {
  if (isDbReady()) {
    return res.status(200).json({ status: 'OK', sqlite: 'ok' });
  }
  res.status(503).json({
    status: 'unavailable',
    sqlite: 'error',
  });
});

// Error handling
app.use(appErrorHandler);

export default app;
