import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { departmentService } from '../../services/department.service.js';
import { homeService, type HomeSearch } from '../../services/home.service.js';
import { opportunityBoard } from '../../services/opportunity-board.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const searchSchema = z.object({
  searchType: z.string().optional(),
  deptIds: z.array(z.string()).optional(),
  userField: z.string().optional(),
  timeField: z.string().optional(),
  priorPeriodEnable: z.boolean().optional(),
});

function searchOf(body: unknown): HomeSearch {
  return searchSchema.parse(body ?? {});
}

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/home/statistic/lead', { preHandler: requirePermission(Permission.CLUE_MANAGEMENT_READ) }, async (request) => {
    const user = requireUser(request);
    const data = await homeService.leadStatistic(searchOf(request.body), requireOrganization(request), user.id);
    return success(data);
  });

  app.post('/home/statistic/opportunity', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_READ) }, async (request) => {
    const user = requireUser(request);
    const data = await homeService.opportunityStatistic(searchOf(request.body), null, requireOrganization(request), user.id);
    return success(data);
  });

  app.post('/home/statistic/opportunity/underway', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_READ) }, async (request) => {
    const user = requireUser(request);
    const data = await homeService.opportunityStatistic(searchOf(request.body), 'UNDERWAY', requireOrganization(request), user.id);
    return success(data);
  });

  app.post('/home/statistic/opportunity/success', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_READ) }, async (request) => {
    const user = requireUser(request);
    const data = await homeService.opportunityStatistic(searchOf(request.body), 'SUCCESS', requireOrganization(request), user.id);
    return success(data);
  });

  const boardSchema = z.object({
    deptIds: z.array(z.string()).optional(),
    start: z.number(),
    end: z.number(),
  });

  app.post('/home/statistic/opportunity/board', { preHandler: requirePermission(Permission.OPPORTUNITY_MANAGEMENT_READ) }, async (request) => {
    const body = boardSchema.parse(request.body ?? {});
    requireUser(request);
    return success(await opportunityBoard(requireOrganization(request), body.start, body.end, body.deptIds ?? []));
  });

  app.get('/home/statistic/department/tree', async (request) => {
    requireUser(request);
    return success(await departmentService.tree(requireOrganization(request)));
  });
}
