import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { departmentService } from '../../services/department.service.js';
import { roleAdminService } from '../../services/role-admin.service.js';
import { roleQueryService } from '../../services/role.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { includeDisabledSchema } from '../requests/user.request.js';

const permissionSchema = z.object({
  id: z.string().min(1),
  enable: z.boolean().optional(),
});

const roleWriteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  dataScope: z.string().optional(),
  description: z.string().max(1000).optional(),
  deptIds: z.array(z.string()).optional(),
  permissions: z.array(permissionSchema).optional(),
});

const roleUpdateSchema = roleWriteSchema.partial().extend({
  id: z.string().min(1),
});

const roleUserPageSchema = z.object({
  roleId: z.string().min(1),
  current: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  keyword: z.string().optional(),
});

const relateSchema = z.object({
  roleId: z.string().min(1),
  userIds: z.array(z.string()).optional(),
  deptIds: z.array(z.string()).optional(),
  roleIds: z.array(z.string()).optional(),
});

export async function registerRoleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/role/list', { preHandler: requirePermission(Permission.SYSTEM_ROLE_READ) }, async (request) => {
    return success(await roleQueryService.list(requireOrganization(request)));
  });

  app.get('/role/permission/setting', { preHandler: requirePermission(Permission.SYSTEM_ROLE_READ) }, async () => {
    return success(roleAdminService.catalog());
  });

  app.get('/role/get/:id', { preHandler: requirePermission(Permission.SYSTEM_ROLE_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await roleAdminService.get(id, requireOrganization(request)));
  });

  app.post('/role/add', { preHandler: requirePermission(Permission.SYSTEM_ROLE_ADD) }, async (request) => {
    const body = roleWriteSchema.parse(request.body);
    return success(await roleAdminService.add(body, requireOrganization(request), requireUser(request).id));
  });

  app.post('/role/update', { preHandler: requirePermission(Permission.SYSTEM_ROLE_UPDATE) }, async (request) => {
    const body = roleUpdateSchema.parse(request.body);
    return success(await roleAdminService.update(body, requireOrganization(request), requireUser(request).id));
  });

  app.get('/role/delete/:id', { preHandler: requirePermission(Permission.SYSTEM_ROLE_DELETE) }, async (request) => {
    const { id } = request.params as { id: string };
    await roleAdminService.remove(id, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/role/user/page', { preHandler: requirePermission(Permission.SYSTEM_ROLE_READ) }, async (request) => {
    const body = roleUserPageSchema.parse(request.body);
    return success(await roleAdminService.userPage(body, requireOrganization(request)));
  });

  app.post('/role/user/relate', { preHandler: requirePermission(Permission.SYSTEM_ROLE_ADD_USER) }, async (request) => {
    const body = relateSchema.parse(request.body);
    await roleAdminService.relate(body, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get('/role/user/delete/:id', { preHandler: requirePermission(Permission.SYSTEM_ROLE_REMOVE_USER) }, async (request) => {
    const { id } = request.params as { id: string };
    await roleAdminService.removeUser(id, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/role/user/batch/delete', { preHandler: requirePermission(Permission.SYSTEM_ROLE_REMOVE_USER) }, async (request) => {
    const body = z.object({ ids: z.array(z.string().min(1)).min(1) }).parse(request.body);
    for (const id of body.ids) {
      await roleAdminService.removeUser(id, requireOrganization(request), requireUser(request).id);
    }
    return success(null);
  });

  app.get('/role/dept/tree', { preHandler: requirePermission(Permission.SYSTEM_ROLE_READ) }, async (request) => {
    return success(await departmentService.tree(requireOrganization(request)));
  });

  app.get('/role/user/dept/tree/:roleId', { preHandler: requirePermission(Permission.SYSTEM_ROLE_ADD_USER) }, async (request) => {
    const { roleId } = request.params as { roleId: string };
    const query = includeDisabledSchema.parse(request.query ?? {});
    return success(await roleAdminService.deptUserTree(requireOrganization(request), roleId, query.includeDisabled === 'true'));
  });

  app.get('/role/user/role/tree/:roleId', { preHandler: requirePermission(Permission.SYSTEM_ROLE_ADD_USER) }, async (request) => {
    const { roleId } = request.params as { roleId: string };
    return success(await roleAdminService.roleUserTree(requireOrganization(request), roleId));
  });

  app.get('/role/user/option/:roleId', { preHandler: requirePermission(Permission.SYSTEM_ROLE_ADD_USER) }, async (request) => {
    const { roleId } = request.params as { roleId: string };
    const query = includeDisabledSchema.parse(request.query ?? {});
    return success(await roleAdminService.userOptions(requireOrganization(request), roleId, query.includeDisabled === 'true'));
  });
}
