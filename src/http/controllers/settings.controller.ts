import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { employeeService } from '../../services/employee.service.js';
import { departmentService } from '../../services/department.service.js';
import { roleAdminService } from '../../services/role-admin.service.js';
import {
  addDict,
  advancedSearchEnabled,
  deleteDict,
  dictConfig,
  listDict,
  listModules,
  operationLogDetail,
  pageLoginLogs,
  pageOperationLogs,
  sortDict,
  sortModule,
  switchAdvancedSearch,
  switchDict,
  switchModule,
  updateDict,
} from '../../services/settings.service.js';
import { addUserKey, deleteUserKey, listUserKeys, setUserKeyEnable, updateUserKey } from '../../services/user-key.service.js';
import { requireOrganization, requireUser } from '../../support/context.js';
import { validateFailed } from '../../support/errors.js';
import { translate } from '../../support/i18n.js';
import { normalizePage } from '../../support/pager.js';
import { Permission } from '../../support/permission.js';
import { success } from '../../support/result.js';
import { requirePermission } from '../middleware/permission.middleware.js';

const dictModule = z.enum(['OPPORTUNITY_FAIL_RS', 'CUSTOMER_POOL_RS', 'CLUE_POOL_RS']);
const pageSchema = z.object({
  current: z.number().optional(),
  pageSize: z.number().optional(),
  keyword: z.string().nullish(),
  operator: z.string().nullish(),
  startTime: z.number().nullish(),
  endTime: z.number().nullish(),
  type: z.string().nullish(),
  module: z.string().nullish(),
}).passthrough();

const sortSchema = z.object({
  start: z.number(),
  end: z.number(),
  dragModuleId: z.string().min(1),
});

function logFilter(body: z.infer<typeof pageSchema>, current: number, pageSize: number) {
  return {
    current,
    pageSize,
    keyword: body.keyword || undefined,
    operator: body.operator || undefined,
    startTime: body.startTime ?? undefined,
    endTime: body.endTime ?? undefined,
    type: body.type || undefined,
    module: body.module || undefined,
  };
}

const FORM_KEYS = ['clue', 'customer', 'contact', 'record', 'plan', 'opportunity', 'product', 'price', 'quotation', 'contract', 'invoice', 'contractPaymentPlan', 'contractPaymentRecord', 'order'];

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dict/get/:module', { preHandler: requirePermission(Permission.MODULE_SETTING_READ) }, async (request) => {
    const module = dictModule.parse((request.params as { module: string }).module);
    return success(await listDict(module, requireOrganization(request)));
  });

  app.get('/dict/config/:module', async (request) => {
    const module = dictModule.parse((request.params as { module: string }).module);
    return success(await dictConfig(module, requireOrganization(request)));
  });

  app.post('/dict/add', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = z.object({ name: z.string().min(1), module: dictModule }).parse(request.body);
    await addDict(body.module, body.name, requireOrganization(request), requireUser(request).id);
    return success(null);
  });

  app.post('/dict/update', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = z.object({ id: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    await updateDict(body.id, body.name, requireUser(request).id);
    return success(null);
  });

  app.get('/dict/delete/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    await deleteDict((request.params as { id: string }).id);
    return success(null);
  });

  app.post('/dict/switch', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = z.object({ module: dictModule, enable: z.boolean() }).parse(request.body);
    await switchDict(body.module, requireOrganization(request), body.enable);
    return success(null);
  });

  app.post('/dict/sort', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = z.object({
      dragDictId: z.string().min(1),
      start: z.number(),
      end: z.number(),
    }).parse(request.body);
    await sortDict(body.dragDictId, body.start, body.end, requireUser(request).id);
    return success(null);
  });

  app.post('/module/list', async (request) => {
    const body = z.object({ organizationId: z.string().optional() }).parse(request.body ?? {});
    const organizationId = body.organizationId || requireOrganization(request);
    if (organizationId !== requireOrganization(request) && requireUser(request).id !== 'admin') {
      throw validateFailed('组织不匹配');
    }
    return success(await listModules(organizationId));
  });

  app.get('/module/form/list', async () => {
    return success(FORM_KEYS.map((key) => ({ id: key, name: translate(key, key) })));
  });

  app.get('/module/switch/:id', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    await switchModule((request.params as { id: string }).id, requireUser(request).id);
    return success(null);
  });

  app.post('/module/sort', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async (request) => {
    const body = sortSchema.parse(request.body);
    await sortModule(body.dragModuleId, body.start, body.end, requireUser(request).id);
    return success(null);
  });

  app.get('/module/role/tree', { preHandler: requirePermission(Permission.MODULE_SETTING_READ) }, async (request) => {
    return success(await roleAdminService.roleTree(requireOrganization(request)));
  });

  app.get('/module/advanced-search/settings', async () => success(await advancedSearchEnabled()));

  app.get('/module/advanced-search/switch', { preHandler: requirePermission(Permission.MODULE_SETTING_UPDATE) }, async () => {
    await switchAdvancedSearch();
    return success(null);
  });

  app.get('/module/user/dept/tree', { preHandler: requirePermission(Permission.MODULE_SETTING_READ) }, async (request) => {
    const includeDisabled = (request.query as { includeDisabled?: string }).includeDisabled === 'true';
    return success(await employeeService.deptUserTree(requireOrganization(request), includeDisabled));
  });

  app.get('/field/dept/tree', async (request) => {
    return success(await departmentService.tree(requireOrganization(request)));
  });

  app.get('/field/user/dept/tree', async (request) => {
    const includeDisabled = (request.query as { includeDisabled?: string }).includeDisabled === 'true';
    return success(await employeeService.deptUserTree(requireOrganization(request), includeDisabled));
  });

  app.post('/login/log/list', { preHandler: requirePermission(Permission.OPERATION_LOG_READ) }, async (request) => {
    const body = pageSchema.parse(request.body ?? {});
    const page = normalizePage(body.current, body.pageSize);
    const result = await pageLoginLogs(requireOrganization(request), logFilter(body, page.current, page.pageSize));
    return success({ ...result, current: page.current, pageSize: page.pageSize });
  });

  app.post('/operation/log/list', { preHandler: requirePermission(Permission.OPERATION_LOG_READ) }, async (request) => {
    const body = pageSchema.parse(request.body ?? {});
    const page = normalizePage(body.current, body.pageSize);
    const result = await pageOperationLogs(requireOrganization(request), logFilter(body, page.current, page.pageSize));
    return success({ ...result, current: page.current, pageSize: page.pageSize });
  });

  app.get('/operation/log/detail/:id', { preHandler: requirePermission(Permission.OPERATION_LOG_READ) }, async (request) => {
    return success(await operationLogDetail((request.params as { id: string }).id, requireOrganization(request)));
  });

  app.get('/user/api/key/list', async (request) => success(await listUserKeys(requireUser(request).id)));

  app.get('/user/api/key/add', async (request) => success(await addUserKey(requireUser(request).id)));

  app.get('/user/api/key/delete/:id', async (request) => {
    await deleteUserKey((request.params as { id: string }).id, requireUser(request).id);
    return success(null);
  });

  app.get('/user/api/key/enable/:id', async (request) => {
    await setUserKeyEnable((request.params as { id: string }).id, requireUser(request).id, true);
    return success(null);
  });

  app.get('/user/api/key/disable/:id', async (request) => {
    await setUserKeyEnable((request.params as { id: string }).id, requireUser(request).id, false);
    return success(null);
  });

  app.post('/user/api/key/update', async (request) => {
    const body = z.object({
      id: z.string().min(1),
      forever: z.boolean(),
      expireTime: z.number().optional(),
      description: z.string().max(1000).optional(),
    }).parse(request.body);
    await updateUserKey({ ...body, userId: requireUser(request).id });
    return success(null);
  });
}
