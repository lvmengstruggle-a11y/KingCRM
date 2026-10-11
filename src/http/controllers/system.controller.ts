import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { demoDataService } from '../../services/demo-data.service.js';
import { systemService } from '../../services/system.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/system/version', async () => success(systemService.getVersion()));

  app.get('/navigation/list', async (request) => {
    requireUser(request);
    const list = await systemService.listNavigation(requireOrganization(request));
    return success(list);
  });

  app.get('/system/demo-data', { preHandler: requirePermission(Permission.SYSTEM_SETTING_READ) }, async (request) => {
    return success(await demoDataService.status(requireOrganization(request)));
  });

  app.post('/system/demo-data', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    const user = requireUser(request);
    return success(await demoDataService.create(requireOrganization(request), user.id));
  });

  app.post('/system/demo-data/clear', { preHandler: requirePermission(Permission.SYSTEM_SETTING_UPDATE) }, async (request) => {
    return success(await demoDataService.clear(requireOrganization(request)));
  });

  app.post('/navigation/sort', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = z.object({
      start: z.number(),
      end: z.number(),
      dragModuleId: z.string().min(1),
    }).parse(request.body);
    await systemService.sortNavigation(body.dragModuleId, requireOrganization(request), body.start, body.end, requireUser(request).id);
    return success(null);
  });
}
