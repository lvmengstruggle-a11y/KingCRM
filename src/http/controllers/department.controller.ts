import type { FastifyInstance } from 'fastify';

import { departmentService } from '../../services/department.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import {
  departmentAddSchema,
  departmentCommanderSchema,
  departmentIdsSchema,
  departmentRenameSchema,
  departmentSortSchema,
} from '../requests/department.request.js';

export async function registerDepartmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/department/tree', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async (request) => {
    return success(await departmentService.tree(requireOrganization(request)));
  });

  app.post('/department/add', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_ADD) }, async (request) => {
    const body = departmentAddSchema.parse(request.body);
    const user = requireUser(request);
    const department = await departmentService.add({
      ...body,
      organizationId: requireOrganization(request),
      userId: user.id,
    });
    return success(department);
  });

  app.post('/department/rename', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = departmentRenameSchema.parse(request.body);
    await departmentService.rename({
      ...body,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });

  app.post('/department/set-commander', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = departmentCommanderSchema.parse(request.body);
    await departmentService.setCommander({
      ...body,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });

  app.post('/department/delete/check', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_DELETE) }, async (request) => {
    const ids = departmentIdsSchema.parse(request.body);
    return success(await departmentService.deleteCheck(ids, requireOrganization(request)));
  });

  app.post('/department/delete', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_DELETE) }, async (request) => {
    const ids = departmentIdsSchema.parse(request.body);
    await departmentService.remove(ids, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/department/sort', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = departmentSortSchema.parse(request.body);
    await departmentService.sort({
      ...body,
      organizationId: requireOrganization(request),
      userId: requireUser(request).id,
    });
    return success(null);
  });
}
