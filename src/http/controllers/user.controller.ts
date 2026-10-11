import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { employeeService } from '../../services/employee.service.js';
import { consumeMailCode } from '../../services/organization-config.service.js';
import { organizationUserService } from '../../services/organization-user.service.js';
import { roleQueryService } from '../../services/role.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import {
  batchEnableSchema,
  batchIdsSchema,
  employeeSchema,
  employeeUpdateSchema,
  includeDisabledSchema,
  personalInfoSchema,
  personalPasswordSchema,
  renameSchema,
  userPageSchema,
} from '../requests/user.request.js';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.post('/user/list', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async (request) => {
    const body = userPageSchema.parse(request.body ?? {});
    return success(await organizationUserService.list({ ...body, organizationId: requireOrganization(request) }));
  });

  app.post('/user/add', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_ADD) }, async (request) => {
    const body = employeeSchema.parse(request.body);
    await employeeService.add(body, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get('/user/detail/:id', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await employeeService.detail(id, requireOrganization(request)));
  });

  app.post('/user/update', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = employeeUpdateSchema.parse(request.body);
    await employeeService.update(body.id, body, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get('/user/reset-password/:userId', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_USER_RESET_PASSWORD) }, async (request) => {
    const { userId } = request.params as { userId: string };
    await employeeService.resetPassword(userId, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/user/batch-enable', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = batchEnableSchema.parse(request.body);
    await employeeService.batchEnable(body.ids, body.enable, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/user/batch/reset-password', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_USER_RESET_PASSWORD) }, async (request) => {
    const body = batchIdsSchema.parse(request.body);
    await employeeService.batchReset(body.ids, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/user/update/name', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = renameSchema.parse(request.body);
    await employeeService.rename(body.userId, body.name, requireUser(request).id);
    return success(null);
  });

  app.get('/user/delete/check/:id', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_DELETE) }, async (request) => {
    const { id } = request.params as { id: string };
    return success(await employeeService.deleteCheck(id, requireOrganization(request)));
  });

  app.get('/user/delete/:id', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_DELETE) }, async (request) => {
    const { id } = request.params as { id: string };
    await employeeService.remove(id, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.get('/user/get/:departmentId', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async (request) => {
    const { departmentId } = request.params as { departmentId: string };
    return success(await employeeService.deptUserTree(requireOrganization(request), false, departmentId));
  });

  app.get('/user/sync-check', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ) }, async () => success(false));

  app.get('/user/option', async (request) => {
    const query = includeDisabledSchema.parse(request.query ?? {});
    return success(await organizationUserService.options(requireOrganization(request), query.includeDisabled === 'true'));
  });

  app.get('/user/admin/option', { preHandler: requirePermission(Permission.PROCESS_SETTING_READ) }, async (request) => {
    const query = includeDisabledSchema.parse(request.query ?? {});
    return success(await organizationUserService.adminOptions(requireOrganization(request), query.includeDisabled === 'true'));
  });

  app.post('/user/batch/edit', { preHandler: requirePermission(Permission.SYS_ORGANIZATION_UPDATE) }, async (request) => {
    const body = z.object({
      ids: z.array(z.string().min(1)).min(1),
      departmentId: z.string().min(1).optional(),
      supervisorId: z.string().optional(),
      workCity: z.string().optional(),
      onboardingDate: z.union([z.number(), z.string()]).optional(),
    }).parse(request.body);
    const onboardingDate = body.onboardingDate == null || body.onboardingDate === ''
      ? body.onboardingDate === '' ? null : undefined
      : Number(body.onboardingDate);
    await employeeService.batchEdit({
      ids: body.ids,
      organizationId: requireOrganization(request),
      operatorId: requireUser(request).id,
      departmentId: body.departmentId,
      supervisorId: body.supervisorId,
      workCity: body.workCity,
      onboardingDate: onboardingDate == null ? onboardingDate : (Number.isFinite(onboardingDate) ? onboardingDate : undefined),
    });
    return success(null);
  });

  app.get('/user/role/option', {
    preHandler: requirePermission(Permission.SYS_ORGANIZATION_READ, Permission.PROCESS_SETTING_READ),
  }, async (request) => {
    const roles = await roleQueryService.list(requireOrganization(request));
    return success(roles.map((role) => ({ id: role.id, name: role.name })));
  });

  app.get('/personal/center/info', async (request) => {
    const user = requireUser(request);
    return success(await employeeService.personal(user.id, requireOrganization(request)));
  });

  app.post('/personal/center/update', async (request) => {
    const body = personalInfoSchema.parse(request.body);
    const user = requireUser(request);
    const organizationId = requireOrganization(request);
    const current = await employeeService.personal(user.id, organizationId);
    if (current && (current.email ?? '') !== body.email) {
      consumeMailCode(user.id, body.email, body.code ?? '');
    }
    await employeeService.updatePersonal(user.id, organizationId, body.phone, body.email);
    return success(await employeeService.personal(user.id, requireOrganization(request)));
  });

  app.post('/personal/center/info/reset', async (request) => {
    const body = personalPasswordSchema.parse(request.body);
    await employeeService.changePassword(requireUser(request).id, body.originPassword, body.password);
    return success(null);
  });
}
