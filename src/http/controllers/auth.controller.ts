import type { FastifyInstance } from 'fastify';

import { authService } from '../../services/auth.service.js';
import { unauthorized } from '../../support/errors.js';
import { success } from '../../support/result.js';
import { loginRequestSchema, localeRequestSchema } from '../requests/login.request.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/get-key', async () => success(authService.getPublicKey()));

  app.get('/is-login', async (request) => {
    if (!request.sessionUser) {
      throw unauthorized();
    }
    const user = await authService.refresh(request.sessionUser, request.organizationId);
    return success(user);
  });

  app.get('/get-auth', async (request) => {
    if (!request.sessionUser) {
      throw unauthorized();
    }
    const user = await authService.refresh(request.sessionUser, request.organizationId);
    return success(user);
  });

  app.post('/login', async (request) => {
    const body = loginRequestSchema.parse(request.body);
    const user = await authService.login(
      {
        username: body.username,
        password: body.password,
        platform: body.platform,
        loginAddress: body.loginAddress || request.ip,
        organizationId: request.organizationId,
      },
      request.sessionUser,
    );
    return success(user);
  });

  app.get('/logout', async (request) => {
    return success(authService.logout(request.sessionUser?.sessionId));
  });

  app.post('/locale-language/change', async (request) => {
    if (!request.sessionUser) {
      throw unauthorized();
    }
    const body = localeRequestSchema.parse(request.body);
    await authService.changeLanguage(request.sessionUser.id, body.language);
    return success(null);
  });
}
