import Fastify from 'fastify';

import { errorHandler } from './http/middleware/error-handler.js';
import { authenticate } from './http/middleware/auth.middleware.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  app.addContentTypeParser(/^multipart\/form-data/i, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler(errorHandler);
  app.addHook('onRequest', authenticate);
  await registerRoutes(app);

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      code: 100404,
      message: '接口尚未迁移到 Node 后端',
      messageDetail: null,
      data: null,
    });
  });

  return app;
}
